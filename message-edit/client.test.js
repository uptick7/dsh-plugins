import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const source = readFileSync(new URL('./client.js', import.meta.url), 'utf8');

// Minimal DOM with real parent traversal, not a closest() stub returning a root.
class Element {
  constructor(tag = 'div', attrs = {}, parent = null) {
    this.tagName = tag;
    this.attrs = new Map(Object.entries(attrs));
    this.children = [];
    this.style = {};
    if (parent) parent.appendChild(this);
  }
  appendChild(child) { child.parentElement = this; this.children.push(child); return child; }
  getAttribute(name) { return this.attrs.get(name) ?? null; }
  setAttribute(name, value) { this.attrs.set(name, String(value)); }
  removeAttribute(name) { this.attrs.delete(name); }
  remove() {
    if (this.parentElement) this.parentElement.children = this.parentElement.children.filter((child) => child !== this);
    this.parentElement = null;
  }
  matches(selector) {
    return [...selector.matchAll(/\[([^=\]~]+)(?:(~?=)"([^"]*)")?\]/g)].every(([, attr, op, value]) => {
      const actual = this.getAttribute(attr);
      return op === '=' ? actual === value : op === '~=' ? (actual ?? '').split(' ').includes(value) : actual !== null;
    });
  }
  closest(selector) {
    for (let node = this; node; node = node.parentElement) if (node.matches(selector)) return node;
    return null;
  }
}

function harness(sessionOverrides = {}) {
  let current;
  let nextId = 0;
  const effect = (run, deps) => {
    const instance = current;
    const index = instance.cursor++;
    const previous = instance.hooks[index];
    if (!previous || deps.some((value, i) => !Object.is(value, previous.deps[i]))) {
      instance.pending.push(() => {
        previous?.cleanup?.();
        instance.hooks[index] = { deps, cleanup: run() };
      });
    }
  };
  const React = {
    createElement: (type, props, ...children) => ({ type, props: props ?? {}, children: children.flat(Infinity) }),
    memo: (component) => component,
    useState(initial) {
      const instance = current;
      const index = instance.cursor++;
      if (!(index in instance.hooks)) instance.hooks[index] = { value: initial };
      return [instance.hooks[index].value, (value) => { instance.hooks[index].value = value; }];
    },
    useRef(initial) {
      const index = current.cursor++;
      return current.hooks[index] ??= { current: initial };
    },
    useId() {
      const index = current.cursor++;
      return current.hooks[index] ??= ':mock-' + ++nextId + ':';
    },
    useMemo: (compute) => compute(),
    useEffect: effect,
    useLayoutEffect: effect,
  };
  const document = { head: new Element('head'), body: new Element('body'), createElement: (tag) => new Element(tag) };
  const renderers = new Map();
  const disposers = [];
  const calls = [];
  let definition;
  let plugin;
  const session = {
    cancel: async () => { calls.push('cancel'); return { ok: true, value: { accepted: true } }; },
    prompt: async (content, mode) => { calls.push({ content, mode }); return { ok: true }; },
    ...sessionOverrides,
  };
  vm.runInNewContext(source, {
    window: { __ModuleLoader__: { load: (loaded) => { plugin = loaded.factory((name) => { assert.equal(name, 'react'); return React; }); } } },
    document, navigator: {}, setTimeout, clearTimeout, Error,
  }, { filename: 'client.js' });
  plugin.apply({
    effect(run) { const dispose = run(); if (typeof dispose === 'function') disposers.push(dispose); },
    locale: { register: () => () => {} },
    sessions: { using: async (sessionId, options, run) => {
      calls.push({ sessionId, source: options.source });
      return run({ binding: { session } });
    } },
    uiConversation: { events: { register: (value) => { definition = value; } } },
    slots: { inject: (_name, run) => run(), register: (options, component) => renderers.set(options.key, component) },
  });
  function instance(component, props, mount = null) {
    const state = { hooks: [], cursor: 0, pending: [] };
    return {
      render(nextProps = props, nextMount = mount) {
        props = nextProps;
        mount = nextMount;
        state.cursor = 0;
        current = state;
        this.tree = component(props);
        current = null;
        if (this.tree?.props.ref) this.tree.props.ref.current = mount;
        for (const run of state.pending.splice(0)) run();
        return this.tree;
      },
      unmount() { for (const hook of state.hooks) hook?.cleanup?.(); },
    };
  }
  return { document, renderers, calls, instance, definition, dispose: () => disposers.reverse().forEach((dispose) => dispose()) };
}

function find(tree, predicate) {
  if (!tree || typeof tree !== 'object') return undefined;
  if (predicate(tree)) return tree;
  for (const child of tree.children ?? []) { const found = find(child, predicate); if (found) return found; }
}
const byClass = (tree, className) => find(tree, (node) => node.props.className === className);
const editButton = (tree) => find(tree, (node) => node.type === 'button' && node.props.key === 'edit');
const userProps = (seq = 3, text = 'original') => ({ sessionId: 'session-a', node: { anchorSeq: seq, data: { seq, content: [{ type: 'text', text }], time: 0 } } });
function editor(h, props = userProps()) {
  const user = h.instance(h.renderers.get('user'), props);
  editButton(user.render()).props.onClick();
  const card = user.render();
  return h.instance(card.type, card.props);
}
function markerEvent(seq, startSeq, endSeq, type = 'developer/message') {
  return { type, seq, time: 0, surfaceOp: { op: 'replace', startSeq, endSeq }, data: type === 'developer/message'
    ? { message: { id: 'edited-' + endSeq, role: 'developer', content: [] } }
    : { id: 'edited-' + endSeq, content: [{ type: 'text', text: 'legacy text' }] } };
}
function replay(definition) {
  let previous;
  const instances = new Map();
  return (event) => {
    const match = definition.match[event.type]?.(event);
    if (!match) return null;
    if (match.role === 'update') {
      const instance = instances.get(match.id);
      instance.state = definition.update(instance, { event });
      return instance;
    }
    const instance = { key: match.id, id: match.id, start: { location: { kind: 'turn', turn: event.data.turn } } };
    instance.state = definition.start(instance, { ...match, event }, { previous: () => previous });
    instances.set(match.id, instance);
    previous = instance;
    return instance;
  };
}
const turn = (type, seq, number) => ({ type: 'turn/' + type, seq, data: { turn: number } });

test('replacement markers retain prev chain across repeated edits of earlier history', () => {
  const h = harness();
  const add = replay(h.definition);
  add(turn('start', 1, 1)); add(turn('end', 10, 1));
  add(turn('start', 11, 2)); add(turn('end', 20, 2));
  add(turn('start', 21, 3));
  const first = add(markerEvent(22, 12, 20));
  assert.deepEqual([...first.state.turns], [2]);
  assert.equal(first.state.prev.turn, 3);
  add(turn('end', 30, 3)); add(turn('start', 31, 4));
  const second = add(markerEvent(32, 2, 30));
  assert.deepEqual([...second.state.turns], [3, 2, 1]);
  const view = h.definition.buildViewNode(second);
  assert.equal(view.anchorSeq, 32);
  assert.deepEqual([...view.data.turns], [3, 2, 1]);
});

test('snapshot of an open earlier edit-turn does not hide it when editing a later turn', () => {
  const h = harness();
  const add = replay(h.definition);
  add(turn('start', 1, 1)); add(turn('end', 10, 1));
  add(turn('start', 11, 2)); add(turn('end', 20, 2));
  add(turn('start', 21, 3)); const first = add(markerEvent(22, 12, 20));
  add(turn('end', 30, 3));
  assert.equal(first.state.prev.endSeq, null, 'prev retains the pre-turn/end snapshot');
  add(turn('start', 31, 4)); add(turn('end', 40, 4));
  add(turn('start', 41, 5));
  const second = add(markerEvent(42, 32, 40));
  assert.deepEqual([...second.state.turns], [4]);
});

test('only plugin-owned empty developer replacements are markers', () => {
  const { definition } = harness();
  const match = definition.match['developer/message'];
  const event = markerEvent(30, 2, 20);
  assert.ok(match(event));
  assert.equal(match({ ...event, data: { message: { id: 'other', content: [] } } }), null);
  assert.equal(match({ ...event, data: { message: { content: [] } } }), null);
  assert.equal(match({ ...event, data: { message: { id: 'edited-20', content: [{ type: 'text', text: 'ordinary' }] } } }), null);
  for (const surfaceOp of [null, 'append', { op: 'append', startSeq: 2, endSeq: 20 }, { op: 'replace', startSeq: 21, endSeq: 20 }]) {
    assert.equal(match({ ...event, surfaceOp }), null);
  }
  assert.ok(definition.match['user/message'](markerEvent(30, 2, 20, 'user/message')));
});

// Mirrors installed DOM: [data-chat-flow] column > flow slot > group seat >
// [data-chat-flow] nested process body > flow row > node slot > plugin DOM.
function flow() {
  const column = new Element('div', { 'data-chat-flow': '' });
  const root = new Element('div', { 'data-slot': 'conversation.chat.flow' }, column);
  const group = new Element('div', { 'data-chat-flow-key': 'group', 'data-chat-turn': '1' }, root);
  const nested = new Element('div', { 'data-chat-flow': '' }, group);
  const row = new Element('div', { 'data-chat-flow-key': 'row', 'data-chat-turn': '1' }, nested);
  const slot = new Element('div', { 'data-slot': 'conversation.chat.node' }, row);
  const mount = new Element('div', {}, slot);
  return { root, column, group, nested, row, mount };
}
function shadowStyles(h) { return h.document.head.children.filter((style) => style.id !== 'dsh-message-edit-style'); }
function hiddenByShadow(h, row) {
  return shadowStyles(h).some((style) => [...style.textContent.matchAll(/([^{}]+){display:none!important}/g)].some(([, selector]) => {
    // Generated CSS is an ancestor scope selector followed by the turn row.
    const [ancestor, target] = selector.split(' ');
    return row.matches(target) && row.parentElement.closest(ancestor) !== null;
  }));
}
const markerProps = (sessionId = 'a', turns = [1], text = '') => ({ sessionId, node: { anchorSeq: 22, data: { turns, text, startSeq: 12, time: 0 } } });

test('CSS scopes actual flow slot, including nested groups, without leaking to another session', () => {
  const h = harness();
  const a = flow(); const b = flow();
  const props = markerProps('session-"unsafe]');
  const marker = h.instance(h.renderers.get('message-edit-shadow'), props, a.mount);
  const tree = marker.render();
  assert.equal(tree.props.hidden, true);
  assert.ok(a.root.getAttribute('data-message-edit-scope'));
  assert.equal(a.nested.getAttribute('data-message-edit-scope'), null);
  assert.equal(a.column.getAttribute('data-message-edit-scope'), null);
  assert.equal(hiddenByShadow(h, a.row), true);
  assert.equal(hiddenByShadow(h, a.group), true);
  assert.equal(hiddenByShadow(h, b.row), false);
  assert.doesNotMatch(shadowStyles(h)[0].textContent, /unsafe/);
  marker.unmount();
  assert.equal(a.root.getAttribute('data-message-edit-scope'), null);
  assert.equal(shadowStyles(h).length, 0);
  h.dispose();
  assert.equal(h.document.head.children.length, 0);
});

test('CSS updates on turns and session changes and cleans up only its own scope token', () => {
  const h = harness(); const a = flow(); const b = flow();
  const Component = h.renderers.get('message-edit-shadow');
  const first = h.instance(Component, markerProps('a', [1]), a.mount);
  const second = h.instance(Component, markerProps('a', [2]), a.mount);
  first.render(); second.render();
  assert.equal(a.root.getAttribute('data-message-edit-scope').split(' ').length, 2);
  first.render(markerProps('a', [3]));
  assert.equal(hiddenByShadow(h, a.row), false);
  a.row.setAttribute('data-chat-turn', '3');
  assert.equal(hiddenByShadow(h, a.row), true);
  first.render(markerProps('b', [1]), b.mount);
  assert.equal(a.root.getAttribute('data-message-edit-scope').split(' ').length, 1);
  assert.equal(hiddenByShadow(h, a.row), false);
  assert.equal(hiddenByShadow(h, b.row), true);
  second.unmount();
  assert.equal(a.root.getAttribute('data-message-edit-scope'), null);
  assert.equal(shadowStyles(h).length, 1);
  first.unmount();
  assert.equal(b.root.getAttribute('data-message-edit-scope'), null);
  assert.equal(shadowStyles(h).length, 0);
});

test('CSS fails closed without a flow slot/session and filters unsafe turn values', () => {
  const h = harness(); const Component = h.renderers.get('message-edit-shadow');
  h.instance(Component, markerProps(), new Element()).render();
  h.instance(Component, markerProps(''), flow().mount).render();
  assert.equal(shadowStyles(h).length, 0);
  const a = flow();
  const marker = h.instance(Component, markerProps('a', [1, 1, -1, 1.2, Infinity, NaN, Number.MAX_SAFE_INTEGER + 1, '1"]{}']), a.mount);
  marker.render();
  assert.equal(shadowStyles(h)[0].textContent.match(/display:none/g).length, 1);
  marker.unmount();
});

test('legacy re-edit uses the replacement event.seq, not the replaced startSeq', () => {
  const h = harness(); const add = replay(h.definition);
  add(turn('start', 1, 1)); add(turn('end', 10, 1)); add(turn('start', 11, 2));
  const replacement = add(markerEvent(12, 2, 10, 'user/message'));
  const node = h.definition.buildViewNode(replacement);
  const marker = h.instance(h.renderers.get('message-edit-shadow'), { node, sessionId: 'a' }, flow().mount);
  editButton(marker.render()).props.onClick();
  const card = find(marker.render(), (child) => typeof child.type === 'function' && child.props.initialText === 'legacy text');
  assert.equal(card.props.startSeq, 12);
  marker.unmount();
});

test('arbitrary pencil-prefixed user messages remain visible', () => {
  const h = harness();
  for (const text of ['✎', '✎ this is my actual message']) {
    let renderedText;
    const props = { ...userProps(3, text), renderFactorySlot: (_slot, props) => { renderedText = props.content.text; return null; } };
    const user = h.instance(h.renderers.get('user'), props);
    assert.ok(user.render());
    assert.equal(renderedText, text);
  }
});

test('submission preserves whitespace and sends only after successful cancellation', async () => {
  const h = harness(); const card = editor(h); let tree = card.render();
  const text = '  line one\n\tline two  \n';
  byClass(tree, 'dshmsg-edit-input').props.onChange({ target: { value: text } });
  tree = card.render();
  await byClass(tree, 'dshmsg-edit-submit').props.onClick();
  assert.equal(h.calls[1], 'cancel');
  const sent = h.calls[3];
  assert.equal(sent.mode, 'queue');
  assert.equal(sent.content[0].text, '\u2063{"s":3}\n' + text);
});

for (const failure of ['result', 'throw']) {
  test('cancel ' + failure + ' surfaces an error and prevents prompt', async () => {
    let prompts = 0;
    const h = harness({ cancel: async () => {
      if (failure === 'throw') throw new Error('offline');
      return { ok: false, error: { code: 'offline', message: 'cannot cancel' } };
    }, prompt: async () => { prompts++; return { ok: true }; } });
    const card = editor(h); const tree = card.render();
    await byClass(tree, 'dshmsg-edit-submit').props.onClick();
    const after = card.render();
    assert.equal(prompts, 0);
    assert.match(byClass(after, 'dshmsg-edit-error').children.join(''), /offline/);
    assert.equal(byClass(after, 'dshmsg-edit-submit').props.disabled, false);
  });
}

test('unsafe sequences disable edit and are rejected again at submit', async () => {
  for (const seq of [-1, -0, 1.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1]) {
    const h = harness(); const props = userProps(seq);
    const user = h.instance(h.renderers.get('user'), props);
    assert.equal(editButton(user.render()).props.disabled, true);
    const card = editor(h, props);
    await byClass(card.render(), 'dshmsg-edit-submit').props.onClick();
    assert.equal(h.calls.length, 0);
    assert.ok(byClass(card.render(), 'dshmsg-edit-error'));
  }
  for (const seq of [0, 1, Number.MAX_SAFE_INTEGER]) {
    const h = harness(); const user = h.instance(h.renderers.get('user'), userProps(seq));
    assert.equal(editButton(user.render()).props.disabled, undefined);
    const card = editor(h, userProps(seq));
    await byClass(card.render(), 'dshmsg-edit-submit').props.onClick();
    assert.equal(h.calls[3].content[0].text, '⁣' + JSON.stringify({ s: seq }) + '\noriginal');
  }
});

test('whitespace-only drafts stay disabled and are not sent', async () => {
  const h = harness(); const card = editor(h, userProps(3, ' \n\t ')); const tree = card.render();
  assert.equal(byClass(tree, 'dshmsg-edit-submit').props.disabled, true);
  await byClass(tree, 'dshmsg-edit-submit').props.onClick();
  assert.equal(h.calls.length, 0);
});
