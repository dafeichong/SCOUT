import { randomInt, randomUUID } from 'node:crypto';
import { beats, flipHand, legalShows } from '../shared/rules.js';

export class GameError extends Error {}
const requireRule = (condition, message) => { if (!condition) throw new GameError(message); };
const integer = (n, low, high) => Number.isInteger(n) && n >= low && n <= high;

export function makeDeck(count, rand = randomInt) {
  const deck = [];
  for (let a = 1; a <= 9; a++) {
    for (let b = a + 1; b <= 10; b++) {
      if (count === 3 && b === 10) continue;
      if ((count === 2 || count === 4) && a === 9 && b === 10) continue;
      const flipped = rand(2) === 1;
      deck.push({ id: `${a}-${b}`, value: flipped ? b : a, other: flipped ? a : b });
    }
  }
  for (let i = deck.length - 1; i > 0; i--) {
    const j = rand(i + 1);
    [deck[i], deck[j]] = [deck[j], deck[i]];
  }
  return deck;
}

export function newPlayer(name, sessionHash) {
  return { id: randomUUID(), sessionHash, name, hand: [], score: 0, captured: 0, chips: 0, special: true, ready: false };
}

export function newRoom(code, player) {
  return { code, version: 0, hostId: player.id, players: [player], phase: 'lobby', round: 0,
    turn: 0, starter: 0, active: null, scoutStreak: 0, reserved: [], history: [], logs: [], updatedAt: Date.now() };
}

function log(room, text) {
  room.logs.unshift({ id: randomUUID(), text });
  room.logs = room.logs.slice(0, 40);
}

export function beginRound(room) {
  const count = room.players.length;
  const deck = count === 2 && room.round === 2 ? room.reserved : makeDeck(count);
  const size = count === 2 ? 11 : deck.length / count;
  room.players.forEach((p, i) => {
    p.hand = deck.slice(i * size, (i + 1) * size);
    p.captured = 0;
    p.chips = count === 2 ? 3 : 0;
    p.special = count !== 2;
    p.ready = false;
  });
  room.reserved = count === 2 && room.round === 1 ? deck.slice(22) : [];
  room.active = null;
  room.scoutStreak = 0;
  room.turn = room.starter;
  room.phase = 'orient';
  log(room, `第 ${room.round} 轮发牌，请选择手牌方向。`);
}

function finishRound(room, reason, winnerId) {
  const rows = room.players.map(p => {
    const exempt = reason === 'unbeaten' && p.id === winnerId;
    const penalty = exempt ? 0 : p.hand.length;
    const delta = p.captured + p.chips - penalty;
    p.score += delta;
    return { id: p.id, name: p.name, captured: p.captured, chips: p.chips, remaining: p.hand.length,
      exempt, penalty, delta, total: p.score };
  });
  room.history.push({ round: room.round, reason, winnerId, rows });
  room.phase = room.round === room.players.length ? 'finished' : 'roundEnd';
  log(room, `${room.players.find(p => p.id === winnerId).name}${reason === 'empty' ? '出完手牌' : '的表演无人压过'}，第 ${room.round} 轮结束。`);
}

function nextTurn(room) {
  room.turn = (room.turn + 1) % room.players.length;
}

function checkDuelEnd(room) {
  if (room.players.length !== 2 || room.phase !== 'playing') return;
  const p = room.players[room.turn];
  if (p.chips === 0 && !legalShows(p.hand, room.active?.cards ?? []).length) {
    finishRound(room, 'unbeaten', room.active.ownerId);
  }
}

function show(room, player, payload) {
  const { start, count } = payload;
  requireRule(integer(start, 0, player.hand.length - 1) && integer(count, 1, player.hand.length - start), '请选择手中相邻的一组牌。');
  const cards = player.hand.slice(start, start + count);
  requireRule(beats(cards, room.active?.cards ?? []), '这组牌不是有效组合，或无法压过桌面组合。');
  player.captured += room.active?.cards.length ?? 0;
  player.hand.splice(start, count);
  room.active = { cards, ownerId: player.id };
  room.scoutStreak = 0;
  log(room, `${player.name} 出牌：${cards.map(c => c.value).join(' · ')}`);
  if (!player.hand.length) finishRound(room, 'empty', player.id);
  else { nextTurn(room); checkDuelEnd(room); }
}

function scout(room, player, payload, combined = false) {
  requireRule(room.active?.cards.length > 0, '桌面没有可招募的牌，请出牌。');
  requireRule(room.active.ownerId !== player.id, '不能招募自己的牌。');
  requireRule(payload.edge === 'left' || payload.edge === 'right', '只能招募桌面最左或最右的牌。');
  requireRule(typeof payload.flip === 'boolean', '请选择招募牌的方向。');
  requireRule(integer(payload.insertAt, 0, player.hand.length), '插入位置无效。');
  if (room.players.length === 2) requireRule(player.chips > 0, '本轮招募次数已用完。');
  const ownerId = room.active.ownerId;
  const card = payload.edge === 'left' ? room.active.cards.shift() : room.active.cards.pop();
  player.hand.splice(payload.insertAt, 0, payload.flip ? { ...card, value: card.other, other: card.value } : card);
  if (room.players.length === 2) player.chips--;
  else room.players.find(p => p.id === ownerId).chips++;
  log(room, `${player.name} 招募了 ${payload.flip ? card.other : card.value}。`);
  if (!room.active.cards.length) room.active = null;
  if (combined) return;
  if (room.players.length === 2) { checkDuelEnd(room); return; }
  room.scoutStreak++;
  if (room.scoutStreak === room.players.length - 1) finishRound(room, 'unbeaten', ownerId);
  else nextTurn(room);
}

/** Returns a new room. Invalid actions never partly apply, including Scout & Show. */
export function applyAction(original, playerId, action, payload = {}) {
  const room = structuredClone(original);
  const player = room.players.find(p => p.id === playerId);
  requireRule(player, '你不在这个房间。');
  requireRule(payload && typeof payload === 'object' && !Array.isArray(payload), '操作参数无效。');
  if (action === 'start') {
    requireRule(room.hostId === playerId, '只有房主可以开始游戏。');
    requireRule(room.phase === 'lobby', '游戏已经开始。');
    requireRule(room.players.length >= 2 && room.players.length <= 5, '需要 2～5 位玩家。');
    room.players.forEach(p => { p.score = 0; });
    room.round = 1;
    room.starter = 0;
    room.history = [];
    beginRound(room);
  } else if (action === 'flip' || action === 'ready') {
    requireRule(room.phase === 'orient' && !player.ready, '确认方向后不能再旋转手牌。');
    if (action === 'flip') player.hand = flipHand(player.hand);
    else player.ready = true;
    if (room.players.every(p => p.ready)) { room.phase = 'playing'; log(room, '全员就绪，好戏开场。'); }
  } else if (action === 'next') {
    requireRule(room.hostId === playerId && room.phase === 'roundEnd', '等待房主开始下一轮。');
    room.round++;
    room.starter = (room.starter + 1) % room.players.length;
    beginRound(room);
  } else if (action === 'reset') {
    requireRule(room.hostId === playerId, '只有房主可以返回大厅。');
    requireRule(room.phase !== 'lobby', '当前已在大厅。');
    const reset = newRoom(room.code, room.players[0]);
    reset.players = room.players.map(p => newPlayer(p.name, p.sessionHash)).map((p, i) => ({ ...p, id: room.players[i].id }));
    reset.hostId = room.hostId;
    reset.version = room.version;
    return reset;
  } else {
    requireRule(room.phase === 'playing', '当前不能出牌或招募。');
    requireRule(room.players[room.turn].id === playerId, '还没有轮到你。');
    if (action === 'show') show(room, player, payload);
    else if (action === 'scout') scout(room, player, payload);
    else if (action === 'combo') {
      requireRule(player.special && room.players.length > 2, '本轮的招募＋出牌已用完。');
      scout(room, player, payload, true);
      player.special = false;
      show(room, player, payload.show ?? {});
    } else throw new GameError('未知操作。');
  }
  return room;
}

/** Only this projection may leave the server. No other hands or session hashes. */
export function viewFor(room, playerId, online = () => true) {
  return {
    code: room.code, version: room.version, hostId: room.hostId, phase: room.phase,
    round: room.round, rounds: room.players.length, turnId: room.players[room.turn]?.id,
    starterId: room.players[room.starter]?.id, active: room.active, scoutStreak: room.scoutStreak,
    history: room.history, logs: room.logs, you: playerId,
    players: room.players.map(({ id, name, score, captured, chips, special, ready, hand }) => ({
      id, name, score, captured, chips, special, ready, handCount: hand.length, online: online(id),
      ...(id === playerId ? { hand } : {}),
    })),
  };
}
