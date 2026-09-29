import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeDeck, newPlayer, newRoom, applyAction, viewFor } from '../server/game.js';
import { beats, combination, flipHand, legalShows } from '../shared/rules.js';

const cards = (...values) => values.map((value, i) => ({ id: `c${i}`, value, other: value === 9 ? 2 : 9 }));
function fixture(count = 3) {
  const players = Array.from({ length: count }, (_, i) => newPlayer(`P${i}`, `secret-${i}`));
  const room = newRoom('ABC234', players[0]);
  room.players = players;
  return room;
}
function started(count = 3) {
  let room = fixture(count);
  room = applyAction(room, room.hostId, 'start');
  for (const p of room.players) room = applyAction(room, p.id, 'ready');
  return room;
}

test('deck configuration, uniqueness and deal sizes for 2–5 players', () => {
  for (const [count, size] of [[2, 44], [3, 36], [4, 44], [5, 45]]) {
    const deck = makeDeck(count);
    assert.equal(deck.length, size);
    assert.equal(new Set(deck.map(c => c.id)).size, size);
    const room = started(count);
    assert.ok(room.players.every(p => p.hand.length === (count === 2 ? 11 : size / count)));
    assert.equal(room.reserved.length, count === 2 ? 22 : 0);
  }
});
test('strict combination ranking: count, kind, value; descending runs', () => {
  assert.ok(beats(cards(1, 2, 3), cards(9, 9)));
  assert.ok(beats(cards(1, 1), cards(9, 10)));
  assert.ok(beats(cards(8, 7, 6), cards(3, 4, 5)));
  assert.ok(!beats(cards(8, 9), cards(1, 1)));
  assert.ok(!beats(cards(5, 6), cards(5, 6)));
  assert.equal(combination(cards(1, 3, 2)), null);
  assert.equal(combination(cards(10, 1, 2)), null);
  assert.equal(combination(cards()), null);
});
test('whole hand rotation reverses positions and values, twice restores hand', () => {
  const hand = [{ id: '1', value: 1, other: 7 }, { id: '2', value: 3, other: 9 }];
  assert.deepEqual(flipHand(hand).map(c => c.value), [9, 7]);
  assert.deepEqual(flipHand(flipHand(hand)), hand);
  let room = fixture();
  room = applyAction(room, room.hostId, 'start');
  room = applyAction(room, room.hostId, 'ready');
  assert.throws(() => applyAction(room, room.hostId, 'flip'));
});
test('out-of-turn, malformed selection and non-adjacent fake card IDs rejected', () => {
  const room = started();
  assert.throws(() => applyAction(room, room.players[1].id, 'show', { start: 0, count: 1 }));
  for (const payload of [{ start: -1, count: 1 }, { start: 0, count: 99 }, { start: 0.5, count: 1 }, { ids: ['c1', 'c8'] }]) {
    assert.throws(() => applyAction(room, room.hostId, 'show', payload));
  }
});
test('show captures previous cards, leaves new active set unscored', () => {
  let room = started();
  room.players[0].hand = cards(5, 5, 1);
  room.active = { ownerId: room.players[2].id, cards: cards(3, 4) };
  room = applyAction(room, room.hostId, 'show', { start: 0, count: 2 });
  assert.equal(room.players[0].captured, 2);
  assert.equal(room.active.cards.length, 2);
  assert.equal(room.turn, 1);
});
test('scout inserts either orientation and rewards owner; can empty active set', () => {
  let room = started();
  room.players[0].hand = cards(3, 5);
  room.active = { ownerId: room.players[2].id, cards: [{ id: 'scouted', value: 9, other: 4 }] };
  room = applyAction(room, room.hostId, 'scout', { edge: 'right', flip: true, insertAt: 1 });
  assert.deepEqual(room.players[0].hand.map(c => c.value), [3, 4, 5]);
  assert.equal(room.players[2].chips, 1);
  assert.equal(room.active, null);
  assert.equal(room.turn, 1);
  room = applyAction(room, room.players[1].id, 'show', { start: 0, count: 1 });
  assert.equal(room.scoutStreak, 0);
});
test('failed scout-and-show is fully atomic; successful one compares reduced set', () => {
  const room = started();
  room.players[0].hand = cards(1, 1, 8);
  room.active = { ownerId: room.players[2].id, cards: cards(4, 5, 6) };
  const before = structuredClone(room);
  assert.throws(() => applyAction(room, room.hostId, 'combo', { edge: 'left', flip: false, insertAt: 3, show: { start: 0, count: 1 } }));
  assert.deepEqual(room, before);
  const after = applyAction(room, room.hostId, 'combo', { edge: 'left', flip: false, insertAt: 3, show: { start: 0, count: 2 } });
  assert.equal(after.players[0].captured, 2);
  assert.equal(after.players[0].special, false);
  assert.equal(after.players[2].chips, 1);
  assert.equal(after.scoutStreak, 0);
});
test('consecutive scouts end round and exempt last show owner, even when set empties', () => {
  let room = started();
  room.players[0].hand = cards(2, 2, 1);
  room = applyAction(room, room.players[0].id, 'show', { start: 0, count: 2 });
  for (const i of [1, 2]) room = applyAction(room, room.players[i].id, 'scout', { edge: 'left', flip: false, insertAt: 0 });
  assert.equal(room.phase, 'roundEnd');
  assert.equal(room.active, null);
  assert.equal(room.history[0].rows[0].penalty, 0);
  assert.equal(room.history[0].rows[0].delta, 2);
});
test('empty hand ends round immediately and scores remaining hands', () => {
  let room = started();
  room.players[0].hand = cards(1);
  room = applyAction(room, room.hostId, 'show', { start: 0, count: 1 });
  assert.equal(room.phase, 'roundEnd');
  assert.equal(room.history[0].reason, 'empty');
  assert.equal(room.history[0].rows[1].delta, -12);
  assert.throws(() => applyAction(room, room.players[1].id, 'scout', { edge: 'left', flip: false, insertAt: 0 }));
});
test('duel scout spends own chip, does not advance turn or reward opponent', () => {
  let room = started(2);
  room.active = { ownerId: room.players[1].id, cards: cards(3, 4) };
  room = applyAction(room, room.hostId, 'scout', { edge: 'left', flip: false, insertAt: 0 });
  assert.equal(room.turn, 0);
  assert.equal(room.players[0].chips, 2);
  assert.equal(room.players[1].chips, 3);
  assert.throws(() => applyAction(room, room.hostId, 'combo', { edge: 'left', flip: false, insertAt: 0, show: { start: 0, count: 1 } }));
});
test('duel ends automatically when no chip and no legal show; reserve used next round', () => {
  let room = started(2);
  const reserved = room.reserved.map(c => c.id).sort();
  room.players[0].hand = cards(8, 8, 1);
  room.players[1].hand = cards(1, 2);
  room.players[1].chips = 0;
  room = applyAction(room, room.hostId, 'show', { start: 0, count: 2 });
  assert.equal(room.phase, 'roundEnd');
  assert.equal(room.history[0].rows[0].penalty, 0);
  room = applyAction(room, room.hostId, 'next');
  assert.deepEqual(room.players.flatMap(p => p.hand.map(c => c.id)).sort(), reserved);
  assert.equal(room.starter, 1);
});
test('private projection never exposes other hands, sessions or reserved deck', () => {
  const room = started(2);
  const view = viewFor(room, room.hostId);
  assert.ok(view.players[0].hand.length);
  assert.equal(view.players[1].hand, undefined);
  assert.equal(view.reserved, undefined);
  assert.ok(!JSON.stringify(view).includes('secret-'));
});
test('random complete games terminate with unique cards, valid scores and rotating starters', () => {
  for (const count of [2, 3, 4, 5]) {
    for (let iteration = 0; iteration < 5; iteration++) {
      let room = started(count);
      let steps = 0;
      while (room.phase !== 'finished') {
        assert.ok(++steps < 3000, 'game should terminate');
        if (room.phase === 'roundEnd') {
          room = applyAction(room, room.hostId, 'next');
          assert.equal(room.starter, room.round - 1);
          for (const p of room.players) room = applyAction(room, p.id, 'ready');
          continue;
        }
        const p = room.players[room.turn];
        const shows = legalShows(p.hand, room.active?.cards ?? []);
        if (shows.length) room = applyAction(room, p.id, 'show', shows.at(-1));
        else room = applyAction(room, p.id, 'scout', { edge: 'left', flip: false, insertAt: 0 });
        const ids = [...room.players.flatMap(p => p.hand), ...(room.active?.cards ?? []), ...room.reserved].map(c => c.id);
        assert.equal(ids.length, new Set(ids).size);
      }
      assert.equal(room.history.length, count);
      for (const p of room.players) assert.equal(p.score, room.history.reduce((sum, h) => sum + h.rows.find(r => r.id === p.id).delta, 0));
    }
  }
});
