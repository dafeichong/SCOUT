import { test } from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { mkdtempSync, rmSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { io } from 'socket.io-client';
import { createGameServer } from '../server/app.js';
import { legalShows } from '../shared/rules.js';

async function boot(options = {}) {
  const server = createGameServer({ dataDir: null, rateLimit: false, ...options });
  server.http.listen(0, '127.0.0.1');
  await once(server.http, 'listening');
  server.url = `http://127.0.0.1:${server.http.address().port}`;
  return server;
}
async function client(server, cookie, transports = ['websocket']) {
  if (!cookie) {
    const response = await fetch(`${server.url}/api/session`);
    cookie = response.headers.get('set-cookie').split(';')[0];
  }
  const socket = io(server.url, { extraHeaders: { Cookie: cookie }, transports, forceNew: true, reconnection: false, autoConnect: false });
  const state = { socket, cookie, room: null };
  socket.on('room:state', room => { state.room = room; });
  socket.connect();
  await once(socket, 'connect');
  state.command = (type, payload = {}, version = state.room?.version) => socket.timeout(2000).emitWithAck('room:command', { type, payload, version });
  return state;
}
async function waitFor(predicate) {
  const end = Date.now() + 3000;
  while (!predicate()) {
    if (Date.now() > end) throw new Error('Timed out waiting for state');
    await new Promise(resolve => setTimeout(resolve, 10));
  }
}

test('real sockets: room join, private hands, turn validation, duplicate actions and reconnect', async t => {
  const server = await boot();
  t.after(() => server.close());
  const clients = await Promise.all(Array.from({ length: 3 }, () => client(server)));
  t.after(() => clients.forEach(c => c.socket.disconnect()));
  const [a, b, c] = clients;
  assert.ok((await a.command('create', { name: 'A' })).ok);
  const code = a.room.code;
  assert.ok((await b.command('join', { name: 'B', code })).ok);
  assert.ok((await c.command('join', { name: 'C', code })).ok);
  await waitFor(() => a.room.players.length === 3);
  assert.equal((await b.command('start')).ok, false);
  assert.ok((await a.command('start')).ok);
  await waitFor(() => clients.every(p => p.room.phase === 'orient'));
  for (const p of clients) {
    assert.equal(p.room.players.filter(row => row.hand).length, 1);
    assert.equal(p.room.players.find(row => row.id === p.room.you).hand.length, 12);
    assert.ok(!JSON.stringify(p.room).includes('sessionHash'));
    await waitFor(() => p.room.version === a.room.version);
    assert.ok((await p.command('ready')).ok);
  }
  await waitFor(() => clients.every(p => p.room.phase === 'playing'));
  assert.equal((await b.command('show', { start: 0, count: 1 })).ok, false);
  const v = a.room.version;
  const responses = await Promise.all([a.command('show', { start: 0, count: 1 }, v), a.command('show', { start: 0, count: 1 }, v)]);
  assert.equal(responses.filter(r => r.ok).length, 1);
  await waitFor(() => b.room.turnId === b.room.you);
  const bId = b.room.you;
  const bHand = b.room.players.find(p => p.id === bId).hand;
  b.socket.disconnect();
  const rejoined = await client(server, b.cookie, ['polling']);
  t.after(() => rejoined.socket.disconnect());
  await waitFor(() => rejoined.room?.you === bId);
  assert.deepEqual(rejoined.room.players.find(p => p.id === bId).hand, bHand);
  assert.equal(rejoined.room.turnId, bId);
  assert.ok((await rejoined.command('scout', { edge: 'left', flip: false, insertAt: 0 })).ok);
  const outsider = await client(server);
  t.after(() => outsider.socket.disconnect());
  assert.equal((await outsider.command('join', { code, name: 'D' })).ok, false);
  assert.equal((await outsider.command('show', { start: 0, count: 1 })).ok, false);
});

test('full two-player network match, automatic scoring and rematch', async t => {
  const server = await boot();
  t.after(() => server.close());
  const players = await Promise.all([client(server), client(server)]);
  t.after(() => players.forEach(c => c.socket.disconnect()));
  assert.ok((await players[0].command('create', { name: 'Alpha' })).ok);
  assert.ok((await players[1].command('join', { name: 'Beta', code: players[0].room.code })).ok);
  await waitFor(() => players[0].room.players.length === 2);
  assert.ok((await players[0].command('start')).ok);
  let steps = 0;
  while (players[0].room.phase !== 'finished') {
    assert.ok(++steps < 800);
    await waitFor(() => players[0].room.version === players[1].room.version);
    const view = players[0].room;
    if (view.phase === 'orient') {
      for (const p of players) {
        await waitFor(() => p.room.version === players[0].room.version);
        if (!p.room.players.find(row => row.id === p.room.you).ready) assert.ok((await p.command('ready')).ok);
      }
    } else if (view.phase === 'roundEnd') assert.ok((await players[0].command('next')).ok);
    else {
      const player = players.find(p => p.room.you === view.turnId);
      const hand = player.room.players.find(p => p.id === player.room.you).hand;
      const choices = legalShows(hand, view.active?.cards ?? []);
      const result = choices.length ? await player.command('show', choices.at(-1)) : await player.command('scout', { edge: 'left', flip: false, insertAt: 0 });
      assert.ok(result.ok, result.error);
    }
  }
  assert.equal(players[0].room.history.length, 2);
  assert.ok((await players[0].command('reset')).ok);
  assert.equal(players[0].room.phase, 'lobby');
  assert.ok(players[0].room.players.every(p => p.score === 0));
});

test('persistent room survives process restart and resumes same private hand', async t => {
  const dir = mkdtempSync(join(tmpdir(), 'scout-store-'));
  let server = await boot({ dataDir: dir });
  t.after(async () => {
    await server.close();
    const target = realpathSync(dir);
    assert.ok(target.startsWith(join(realpathSync(tmpdir()), 'scout-store-')));
    rmSync(target, { recursive: true, force: true });
  });
  const a = await client(server);
  const b = await client(server);
  assert.ok((await a.command('create', { name: 'A' })).ok);
  assert.ok((await b.command('join', { code: a.room.code, name: 'B' })).ok);
  await waitFor(() => a.room.players.length === 2);
  assert.ok((await a.command('start')).ok);
  const hand = a.room.players.find(p => p.id === a.room.you).hand;
  const code = a.room.code;
  a.socket.disconnect(); b.socket.disconnect();
  await server.close();
  server = await boot({ dataDir: dir });
  const resumed = await client(server, a.cookie);
  t.after(() => resumed.socket.disconnect());
  await waitFor(() => resumed.room?.code === code);
  assert.deepEqual(resumed.room.players.find(p => p.id === resumed.room.you).hand, hand);
  assert.equal(resumed.room.phase, 'orient');
});

test('host transfers on disconnect, lobby removal and full-room rejection', async t => {
  const server = await boot();
  t.after(() => server.close());
  const clients = await Promise.all(Array.from({ length: 6 }, () => client(server)));
  t.after(() => clients.forEach(p => p.socket.disconnect()));
  assert.ok((await clients[0].command('create', { name: 'P0' })).ok);
  const code = clients[0].room.code;
  for (let i = 1; i < 5; i++) assert.ok((await clients[i].command('join', { name: `P${i}`, code })).ok);
  assert.equal((await clients[5].command('join', { name: 'P5', code })).ok, false);
  const oldHost = clients[0].room.you;
  clients[0].socket.disconnect();
  await waitFor(() => clients[1].room.hostId === clients[1].room.you);
  assert.ok((await clients[1].command('remove', { playerId: oldHost })).ok);
  assert.ok((await clients[5].command('join', { name: 'P5', code })).ok);
});

test('cross-origin and missing-session connections are rejected', async t => {
  const server = await boot();
  t.after(() => server.close());
  const response = await fetch(`${server.url}/api/session`, { headers: { Origin: 'https://untrusted.example' } });
  assert.equal(response.status, 403);
  for (const headers of [{}, { Origin: 'https://untrusted.example', Cookie: `scout_session=${'a'.repeat(64)}` }]) {
    const socket = io(server.url, { transports: ['websocket'], extraHeaders: headers, autoConnect: false, reconnection: false });
    const failed = once(socket, 'connect_error');
    socket.connect();
    await failed;
    socket.disconnect();
  }
});
