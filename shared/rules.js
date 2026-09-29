/** Pure rules shared by the UI and the authoritative server. */
export function combination(cards) {
  if (!Array.isArray(cards) || !cards.length) return null;
  const values = cards.map(c => c.value);
  if (values.some(n => !Number.isInteger(n) || n < 1 || n > 10)) return null;
  const matching = values.every(n => n === values[0]);
  const direction = values.length > 1 ? values[1] - values[0] : 0;
  const run = Math.abs(direction) === 1 && values.every((n, i) => i === 0 || n - values[i - 1] === direction);
  if (!matching && !run) return null;
  return { count: values.length, type: matching ? 'match' : 'run', low: Math.min(...values) };
}

export function beats(cards, active = []) {
  const a = combination(cards);
  const b = combination(active);
  if (!a) return false;
  if (!active.length) return true;
  if (!b) return false;
  if (a.count !== b.count) return a.count > b.count;
  if (a.type !== b.type) return a.type === 'match';
  return a.low > b.low;
}

export function legalShows(hand, active = []) {
  const options = [];
  for (let start = 0; start < hand.length; start++) {
    for (let count = 1; count <= hand.length - start; count++) {
      if (beats(hand.slice(start, start + count), active)) options.push({ start, count });
    }
  }
  return options;
}

export function flipHand(hand) {
  return [...hand].reverse().map(c => ({ ...c, value: c.other, other: c.value }));
}

export function describeSet(cards) {
  const set = combination(cards);
  if (!set) return '选择相邻的同数或顺子';
  return set.count === 1 ? `单张 ${set.low}` : `${set.count} 张${set.type === 'match' ? '同数' : '顺子'}`;
}
