import express from 'express';
import { createServer } from 'node:http';
import { createHash, randomBytes, randomInt } from 'node:crypto';
import { resolve } from 'node:path';
import { Server } from 'socket.io';
import { GameError, newPlayer, newRoom, applyAction, viewFor } from './game.js';
import { RoomStore } from './store.js';

const COOKIE = 'scout_session';
const MAX_AGE = 24 * 60 * 60 * 1000;
const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
function sessionFrom(req) {
  const value = req.headers.cookie?.split(';').map(s => s.trim()).find(s => s.startsWith(`${COOKIE}=`))?.slice(COOKIE.length + 1);
  return /^[a-f0-9]{64}$/.test(value ?? '') ? value : null;
}
const hash = value => createHash('sha256').update(value).digest('hex');
const assert = (condition, message) => { if (!condition) throw new GameError(message); };
function nameFrom(value) {
  assert(typeof value === 'string', '请填写昵称。');
  const name = value.trim().replace(/[\u0000-\u001f\u007f]/g, '');
  assert(name.length >= 1 && name.length <= 16, '昵称需要 1～16 个字符。');
  return name;
}

export function createGameServer({ dataDir = './data', publicOrigin = '', maxRooms = 200, distDir = resolve('dist'), rateLimit = true, hostGraceMs = 30_000 } = {}) {
  if (publicOrigin && new URL(publicOrigin).origin !== publicOrigin) throw new Error('PUBLIC_ORIGIN must be an exact origin, without a trailing slash.');
  const store = new RoomStore(dataDir);
  const app = express();
  app.disable('x-powered-by');
  const http = createServer(app);
  const buckets = new Map();
  const hostTimers = new Map();
  let closing = false;
  function limit(key, max, windowMs) {
    if (!rateLimit) return true;
    const now = Date.now();
    let bucket = buckets.get(key);
    if (!bucket || now - bucket.time > windowMs) { bucket = { time: now, count: 0 }; buckets.set(key, bucket); }
    return ++bucket.count <= max;
  }
  function validOrigin(req) {
    const origin = req.headers.origin;
    if (!origin) return true;
    try { return publicOrigin ? origin === publicOrigin : new URL(origin).host === req.headers.host; }
    catch { return false; }
  }
  app.use((req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'same-origin');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self' ws: wss:; frame-ancestors 'none'; base-uri 'self'; form-action 'self'");
    next();
  });
  app.get('/api/health', (_req, res) => res.json({ ok: true }));
  app.get('/api/session', (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    if (!validOrigin(req)) return res.status(403).json({ error: '请求来源无效。' });
    if (!sessionFrom(req)) {
      if (!limit(`session:${req.socket.remoteAddress}`, 120, 60_000)) return res.status(429).json({ error: '请求过于频繁，请稍后再试。' });
      res.cookie(COOKIE, randomBytes(32).toString('hex'), {
        httpOnly: true, sameSite: 'strict', secure: publicOrigin.startsWith('https:'),
        maxAge: 30 * MAX_AGE, path: '/',
      });
    }
    return res.json({ ok: true });
  });
  app.use(express.static(distDir, { index: 'index.html', maxAge: 0 }));
  const io = new Server(http, {
    maxHttpBufferSize: 16_384,
    allowRequest: (req, callback) => callback(null, validOrigin(req) && limit(`connect:${req.socket.remoteAddress}`, 120, 60_000)),
  });
  io.use((socket, next) => {
    const token = sessionFrom(socket.request);
    if (!token) return next(new Error('请刷新页面以恢复会话。'));
    socket.data.sessionHash = hash(token);
    const sameSession = [...io.sockets.sockets.values()].filter(s => s.data.sessionHash === socket.data.sessionHash);
    if (sameSession.length >= 6) return next(new Error('打开的游戏页面过多，请关闭其他标签页。'));
    next();
  });
  function membership(sessionHash) {
    for (const room of store.rooms.values()) {
      const player = room.players.find(p => p.sessionHash === sessionHash);
      if (player) return { room, player };
    }
    return null;
  }
  function online(room, id) {
    const sessionHash = room.players.find(p => p.id === id)?.sessionHash;
    return [...io.sockets.sockets.values()].some(s => s.data.sessionHash === sessionHash && s.connected);
  }
  function broadcast(room) {
    for (const socket of io.sockets.sockets.values()) {
      const player = room.players.find(p => p.sessionHash === socket.data.sessionHash);
      if (player) socket.emit('room:state', viewFor(room, player.id, id => online(room, id)));
    }
  }
  function commit(room) {
    room.version++;
    room.updatedAt = Date.now();
    store.set(room);
    maintainHost(room);
    broadcast(room);
  }
  function cancelHostTimer(code) {
    clearTimeout(hostTimers.get(code)?.timer);
    hostTimers.delete(code);
  }
  function maintainHost(room) {
    if (closing) return;
    const pending = hostTimers.get(room.code);
    if (online(room, room.hostId) || !room.players.some(p => online(room, p.id))) {
      cancelHostTimer(room.code);
      return;
    }
    if (pending?.hostId === room.hostId) return;
    cancelHostTimer(room.code);
    // Keep ownership during refreshes; joining or reconnecting must not skip the grace period.
    const timer = setTimeout(() => {
      hostTimers.delete(room.code);
      if (closing) return;
      const current = store.rooms.get(room.code);
      if (!current || current.hostId !== room.hostId || online(current, current.hostId)) return;
      const next = current.players.find(p => online(current, p.id));
      if (!next) return;
      const updated = structuredClone(current);
      updated.hostId = next.id;
      try { commit(updated); } catch (error) { console.error('Host transfer failed:', error); }
    }, hostGraceMs);
    timer.unref();
    hostTimers.set(room.code, { hostId: room.hostId, timer });
  }
  io.on('connection', socket => {
    const existing = membership(socket.data.sessionHash);
    if (existing) { maintainHost(existing.room); broadcast(existing.room); }
    else socket.emit('room:state', null);
    socket.on('room:command', (message, ack) => {
      if (typeof ack !== 'function') return;
      try {
        assert(limit(`action:${socket.data.sessionHash}`, 100, 10_000), '操作过快，请稍等再试。');
        assert(message && typeof message === 'object' && !Array.isArray(message), '请求格式无效。');
        const { type, payload = {}, version } = message;
        assert(payload && typeof payload === 'object' && !Array.isArray(payload), '操作参数无效。');
        const current = membership(socket.data.sessionHash);
        if (type === 'create' || type === 'join') {
          assert(!current, '你已经在一个房间中，请先返回大厅并离开。');
          assert(limit(`room:${socket.data.sessionHash}`, 20, 60_000), '建房或加入过于频繁，请稍后再试。');
          const name = nameFrom(payload.name);
          const player = newPlayer(name, socket.data.sessionHash);
          if (type === 'create') {
            assert(store.rooms.size < maxRooms, '房间已满，请稍后重试。');
            let code;
            do { code = Array.from({ length: 6 }, () => alphabet[randomInt(alphabet.length)]).join(''); } while (store.rooms.has(code));
            commit(newRoom(code, player));
          } else {
            assert(typeof payload.code === 'string' && /^[A-Z2-9]{6}$/.test(payload.code), '请输入 6 位房间码。');
            const room = store.rooms.get(payload.code);
            assert(room, '找不到这个房间，可能已过期。');
            assert(room.phase === 'lobby', '这桌已经开局，请等待下一场。');
            assert(room.players.length < 5, '房间已满（最多 5 人）。');
            assert(!room.players.some(p => p.name === name), '这个昵称已被使用，请换一个。');
            const updated = structuredClone(room);
            updated.players.push(player);
            commit(updated);
          }
        } else {
          assert(current, '请先创建或加入房间。');
          assert(version === current.room.version, '牌局已更新，请按最新状态重试。');
          const { room, player } = current;
          if (type === 'leave') {
            assert(room.phase === 'lobby', '请房主先返回大厅，再离开房间。');
            const updated = structuredClone(room);
            updated.players = updated.players.filter(p => p.id !== player.id);
            if (!updated.players.length) { store.delete(room.code); cancelHostTimer(room.code); }
            else {
              if (updated.hostId === player.id) updated.hostId = (updated.players.find(p => online(updated, p.id)) ?? updated.players[0]).id;
              commit(updated);
            }
            for (const s of io.sockets.sockets.values()) if (s.data.sessionHash === player.sessionHash) s.emit('room:state', null);
          } else if (type === 'remove') {
            assert(room.hostId === player.id && room.phase === 'lobby', '只有房主可以在大厅移除离线玩家。');
            const target = room.players.find(p => p.id === payload.playerId);
            assert(target && target.id !== player.id && !online(room, target.id), '只能移除离线玩家。');
            const updated = structuredClone(room);
            updated.players = updated.players.filter(p => p.id !== target.id);
            commit(updated);
          } else {
            if (['start', 'next'].includes(type)) assert(room.players.every(p => online(room, p.id)), '有玩家离线，等待重连后再开始。');
            commit(applyAction(room, player.id, type, payload));
          }
        }
        ack({ ok: true });
      } catch (error) {
        if (!(error instanceof GameError)) console.error('Room command failed:', error);
        ack({ ok: false, error: error instanceof GameError ? error.message : '保存牌局失败，请稍后再试。' });
        const current = membership(socket.data.sessionHash);
        if (current) socket.emit('room:state', viewFor(current.room, current.player.id, id => online(current.room, id)));
      }
    });
    socket.on('disconnect', () => {
      const current = membership(socket.data.sessionHash);
      if (current) {
        try { maintainHost(current.room); broadcast(current.room); } catch (error) { console.error('Presence update failed:', error); }
      }
    });
  });
  const sweep = setInterval(() => {
    try {
      for (const room of store.rooms.values()) {
        if (Date.now() - room.updatedAt > MAX_AGE && !room.players.some(p => online(room, p.id))) {
          store.delete(room.code);
          cancelHostTimer(room.code);
        }
      }
      for (const [key, value] of buckets) if (Date.now() - value.time > 60_000) buckets.delete(key);
    } catch (error) { console.error('Room cleanup failed:', error); }
  }, 60_000);
  sweep.unref();
  return { app, http, io, store, close: () => new Promise(resolveClose => {
    closing = true;
    clearInterval(sweep);
    for (const code of hostTimers.keys()) cancelHostTimer(code);
    io.close(() => resolveClose());
  }) };
}
