import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { join } from 'node:path';
import { apply } from './index.js';

// Exercise the real installed Session fold AND durable V4 codec, not a mock
// validator: Session.append alone does not catch all persistence errors.
const root = process.env.DSH_ROOT || join(execFileSync('npm', ['root', '-g'], { encoding: 'utf8' }).trim(), '@deepseek-ai/dsh');
const requireDsh = createRequire(join(root, 'package.json'));
const { Session } = await import(pathToFileURL(requireDsh.resolve('@deepseek-ai/dsh-session')));
const { releasedV4SessionFormatCodec: codec } = await import(pathToFileURL(requireDsh.resolve('@deepseek-ai/dsh-session-format-v3-to-v4')));
let id = 0;
const text = (value) => ({ type: 'text', text: value });
const user = (value) => ({ id: 'user-' + ++id, role: 'user', source: { kind: 'user' }, content: [text(value)] });
const marked = (seq, value = 'edited') => user('\u2063' + JSON.stringify({ s: seq }) + '\n' + value);
const opts = { surfaceOp: 'append' };

function fixture() {
  const session = Session.create('message-edit-test-' + ++id);
  session.append('system/message', { turn: 1, step: 1, message: { id: 'system', role: 'system', source: { kind: 'system-prompt' }, content: [text('system')] } }, opts);
  const addUser = (value) => session.append('user/message', user(value), opts);
  const addAnswer = (value) => session.append('assistant/message', {
    turn: 1, step: 1, stream: [], message: { id: 'answer-' + ++id, role: 'assistant', source: { kind: 'model', provider: 'test', model: 'test' }, content: [text(value)] },
  }, opts);
  const early = addUser('keep user');
  addAnswer('keep answer');
  const target = addUser('remove original');
  addAnswer('remove answer');
  addUser('remove later user');
  addAnswer('remove later answer');
  const handlers = new Map();
  const agent = { session, ctx: { effect: (fn) => fn(), on: (name, fn) => { handlers.set(name, fn); return () => handlers.delete(name); } } };
  const lifecycle = new Map();
  let cleanup;
  apply({ agents: { list: () => [agent] }, on: (name, fn) => lifecycle.set(name, fn), effect: (fn) => { cleanup = fn(); } });
  const invoke = (messages, extra = {}, decision = { kind: 'enter', messages }) => handlers.get('agent/pre-step')({ agent, messages, turn: 4, step: 1, signal: new AbortController().signal, ...extra }, async () => decision);
  const commit = (decision) => decision.messages.map((message) => session.append('user/message', message, opts));
  return { session, early, target, addUser, addAnswer, invoke, commit, handlers, lifecycle, cleanup };
}
const contents = (session) => session.deriveMessages().map((m) => m.content.map((b) => b.text ?? b.type).join(''));

test('original marker reproduces screenshot at V4 persistence boundary', () => {
  const f = fixture();
  const event = f.session.append('developer/message', { message: { role: 'developer', id: 'edited-old', content: [] } }, {
    surfaceOp: { op: 'replace', startSeq: f.target.seq, endSeq: f.session.surface.nodes.at(-1) },
    sourceEventSeqs: f.session.surface.nodes.slice(3),
  });
  assert.throws(() => codec.encodeEvent(event), /developer\/message turn must be a non-negative safe integer/);
});

test('edit removes the full suffix from model context and survives V4 encoding + reload', async () => {
  const f = fixture();
  const previousEvents = f.session.snapshotEvents();
  const decision = await f.invoke([marked(f.target.seq, 'replacement')]);
  assert.equal(decision.startsRequestSeries, true);
  const marker = f.session.snapshotEvents().at(-1);
  assert.equal(marker.data.turn, 4);
  assert.equal(marker.data.step, 1);
  assert.equal(marker.data.message.source.kind, 'message-edit');
  assert.deepEqual(marker.sourceEventSeqs, previousEvents.slice(3).map((e) => e.seq));
  assert.doesNotThrow(() => codec.encodeEvent(marker));
  f.commit(decision);
  assert.deepEqual(contents(f.session), ['system', 'keep user', 'keep answer', 'replacement']);
  const events = f.session.snapshotEvents();
  for (const event of events) assert.doesNotThrow(() => codec.encodeEvent(event));
  const reloaded = Session.create('restored', JSON.parse(JSON.stringify(events)));
  assert.deepEqual(contents(reloaded), contents(f.session));
  assert.equal(events[f.target.seq].data.content[0].text, 'remove original', 'audit log intentionally remains');
});

test('re-edit latest replacement, then edit an earlier retained message', async () => {
  const f = fixture();
  const [edited] = f.commit(await f.invoke([marked(f.target.seq, 'first edit')]));
  f.addAnswer('first edit answer');
  f.commit(await f.invoke([marked(edited.seq, 'second edit')]));
  assert.deepEqual(contents(f.session), ['system', 'keep user', 'keep answer', 'second edit']);
  f.commit(await f.invoke([marked(f.early.seq, 'earlier edit')]));
  assert.deepEqual(contents(f.session), ['system', 'earlier edit']);
});

test('preserves attachments, block order and exact edited whitespace', async () => {
  const f = fixture();
  const image = { type: 'image', attachment: { id: 'test-image', mediaType: 'image/png' } };
  const file = { type: 'file', attachment: { id: 'test-file', name: 'test.txt' } };
  const original = { ...user('unused'), content: [image, text('old'), file, text('more old')] };
  const event = f.session.append('user/message', original, opts);
  const decision = await f.invoke([marked(event.seq, '  new\ntext  ')]);
  assert.deepEqual(decision.messages[0].content, [image, text('  new\ntext  '), file]);
  assert.deepEqual(event.data.content, original.content);
});

test('ordinary messages and downstream rejection are unchanged', async () => {
  const f = fixture();
  const messages = [user('normal')];
  const decision = { kind: 'enter', messages };
  assert.equal(await f.invoke(messages, {}, decision), decision);
  const rejected = { kind: 'reject' };
  assert.equal(await f.invoke([marked(f.target.seq)], {}, rejected), rejected);
});

test('abort leaves the existing history untouched', async () => {
  const f = fixture();
  const before = f.session.snapshotEvents();
  const controller = new AbortController();
  controller.abort();
  assert.deepEqual(await f.invoke([marked(f.target.seq)], { signal: controller.signal }), { kind: 'reject' });
  assert.deepEqual(f.session.snapshotEvents(), before);
});

for (const raw of ['\u2063bad\ntext', '\u2063{"s":3}', '\u2063{"s":-1}\ntext', '\u2063{"s":-0}\ntext', '\u2063{"s":1.2}\ntext', '\u2063{"s":9007199254740992}\ntext', '\u2063{"s":3}\n  ']) {
  test('invalid edit fails closed: ' + JSON.stringify(raw), async () => {
    const f = fixture();
    const before = f.session.snapshotEvents();
    await assert.rejects(f.invoke([user(raw)]), /\[message-edit\]/);
    assert.deepEqual(f.session.snapshotEvents(), before);
  });
}

test('stale, non-user and concurrent edits cannot silently enter the model', async () => {
  const f = fixture();
  for (const messages of [[marked(999)], [marked(0)], [marked(2)], [marked(f.target.seq), marked(f.early.seq)]]) {
    const before = f.session.snapshotEvents();
    await assert.rejects(f.invoke(messages), /\[message-edit\]/);
    assert.deepEqual(f.session.snapshotEvents(), before);
  }
  f.commit(await f.invoke([marked(f.target.seq)]));
  await assert.rejects(f.invoke([marked(f.target.seq)]), /no longer in context/);
});

test('invalid turn/step or failed append does not degrade to a normal prompt', async () => {
  const f = fixture();
  const before = f.session.snapshotEvents();
  for (const extra of [{ turn: undefined }, { step: 0 }, { turn: -1 }, { step: 1.5 }]) {
    await assert.rejects(f.invoke([marked(f.target.seq)], extra), /turn\/step/);
  }
  assert.deepEqual(f.session.snapshotEvents(), before);
  f.session.append = () => { throw new Error('storage refused'); };
  await assert.rejects(f.invoke([marked(f.target.seq)]), /storage refused/);
});

test('tool calls and results in the removed suffix do not leak into model context', async () => {
  const f = fixture();
  f.session.append('assistant/message', {
    turn: 3, step: 1, stream: [],
    message: { id: 'tool-request', role: 'assistant', source: { kind: 'model', provider: 'test', model: 'test' },
      content: [{ type: 'tool-call', id: 'call-1', name: 'test', arguments: '{}' }] },
  }, opts);
  f.session.append('tool/result', {
    turn: 3, step: 1,
    message: { id: 'tool-result', role: 'tool', source: { kind: 'tool', callId: 'call-1' }, toolCallId: 'call-1', content: [text('secret old tool result')] },
  }, opts);
  f.commit(await f.invoke([marked(f.target.seq, 'clean edit')]));
  assert.deepEqual(contents(f.session), ['system', 'keep user', 'keep answer', 'clean edit']);
  assert.equal(f.session.deriveMessages().some((m) => m.role === 'tool'), false);
});

test('all required developer fields survive durable encoding', async () => {
  const f = fixture();
  await f.invoke([marked(f.target.seq)]);
  const event = f.session.snapshotEvents().at(-1);
  assert.doesNotThrow(() => codec.encodeEvent(event));
  for (const field of ['turn', 'step']) {
    const broken = structuredClone(event);
    delete broken.data[field];
    assert.throws(() => codec.encodeEvent(broken));
  }
  const broken = structuredClone(event);
  delete broken.data.message.source;
  assert.throws(() => codec.encodeEvent(broken), /producer-owned source/);
});

test('unrelated batch messages are retained and bindings are disposed', async () => {
  const f = fixture();
  const normal = user('queued independently');
  const decision = await f.invoke([normal, marked(f.target.seq)]);
  assert.equal(decision.messages[0], normal);
  f.cleanup();
  assert.equal(f.handlers.size, 0);
});
