import { test } from 'node:test';
import assert from 'node:assert/strict';
import { copyText } from '../src/clipboard.js';

const link = 'http://203.0.113.10:8080/?room=ABC234';
function browser({ secure = false, modern, legacy = true, modal = false } = {}) {
  const state = { attached: null, copied: '', focused: null };
  const original = { focus() { state.focused = original; } };
  const parent = { appendChild(input) { state.attached = input; } };
  const doc = {
    activeElement: original,
    body: modal ? { appendChild() { throw new Error('Background is inert'); } } : parent,
    querySelector: () => modal ? parent : null,
    createElement: () => ({
      style: {}, focus() { state.focused = this; },
      select() { state.selected = this.value; }, setSelectionRange() {},
      remove() { state.attached = null; },
    }),
    execCommand() {
      if (legacy === 'throws') throw new Error('Clipboard blocked');
      if (legacy) state.copied = state.selected;
      return legacy;
    },
  };
  return { environment: { isSecureContext: secure, navigator: modern ? { clipboard: { writeText: modern } } : {}, document: doc }, state, original };
}

test('HTTP without Clipboard API copies exact public origin, port and room code', async () => {
  const { environment, state, original } = browser();
  assert.equal(await copyText(link, environment), true);
  assert.equal(state.copied, link);
  assert.equal(state.attached, null);
  assert.equal(state.focused, original);
});
test('HTTPS uses modern clipboard when available', async () => {
  let copied;
  const { environment, state } = browser({ secure: true, modern: async value => { copied = value; } });
  assert.equal(await copyText(link, environment), true);
  assert.equal(copied, link);
  assert.equal(state.copied, '');
});
test('denied modern clipboard falls back to compatible copy', async () => {
  const { environment, state } = browser({ secure: true, modern: async () => { throw new Error('NotAllowedError'); } });
  assert.equal(await copyText(link, environment), true);
  assert.equal(state.copied, link);
});
test('blocked copying returns failure for manual dialog without false success', async () => {
  for (const legacy of [false, 'throws']) {
    const { environment, state, original } = browser({ legacy });
    assert.equal(await copyText(link, environment), false);
    assert.equal(state.copied, '');
    assert.equal(state.attached, null);
    assert.equal(state.focused, original);
  }
  assert.equal(await copyText(link, { navigator: {}, document: {} }), false);
});
test('copy retry inside a modal does not focus the inert background', async () => {
  const { environment, state } = browser({ modal: true });
  assert.equal(await copyText(link, environment), true);
  assert.equal(state.copied, link);
});
