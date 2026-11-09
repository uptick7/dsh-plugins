import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { EventEmitter } from 'node:events';
import { apply } from './index.js';

/** Minimal Node-like request for the route handlers. */
function fakeRequest(method, bodyChunks = []) {
  const emitter = new EventEmitter();
  emitter.method = method;
  emitter.headers = { 'content-type': 'application/json' };
  emitter.url = '/';
  emitter.destroy = () => emitter;
  queueMicrotask(() => {
    for (const chunk of bodyChunks) emitter.emit('data', chunk);
    emitter.emit('end');
  });
  return emitter;
}

function fakeResponse() {
  const res = { statusCode: 0, headers: {}, body: '' };
  res.setHeader = (k, v) => {
    res.headers[k] = v;
  };
  res.end = (data) => {
    res.body = String(data ?? '');
  };
  return res;
}

async function applyOpsViaRoute(routes, ops) {
  const res = fakeResponse();
  await routes.get('/sidebar-groups/apply')(fakeRequest('POST', [JSON.stringify({ ops })]), res);
  return { status: res.statusCode, payload: JSON.parse(res.body) };
}

async function getState(routes) {
  const res = fakeResponse();
  await routes.get('/sidebar-groups/state')(fakeRequest('GET'), res);
  return { status: res.statusCode, payload: JSON.parse(res.body) };
}

test('state route serves an empty document and reports the store path', async () => {
  const root = mkdtempSync(path.join(tmpdir(), 'sbg-test-'));
  const stateFile = path.join(root, 'groups.json');
  const routes = new Map();
  const ctx = {
    on: () => {},
    inject: (_names, cb) => cb(ctx),
    effect: (fn) => {
      fn();
      return () => {};
    },
    get: (name) => (name === 'webServer' ? { register: (route) => routes.set(route.path, route.handler) } : undefined),
  };
  try {
    apply(ctx, { stateFile });
    const { status, payload } = await getState(routes);
    assert.equal(status, 200);
    assert.equal(payload.ok, true);
    assert.equal(payload.stateFile, stateFile);
    assert.deepEqual(payload.state, { version: 1, rev: 0, groups: {}, membership: {} });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('apply route validates, persists, and answers with the authoritative state', async () => {
  const root = mkdtempSync(path.join(tmpdir(), 'sbg-test-'));
  const stateFile = path.join(root, 'groups.json');
  const routes = new Map();
  const ctx = {
    on: () => {},
    inject: (_names, cb) => cb(ctx),
    effect: (fn) => {
      fn();
      return () => {};
    },
    get: (name) => (name === 'webServer' ? { register: (route) => routes.set(route.path, route.handler) } : undefined),
  };
  try {
    apply(ctx, { stateFile });

    const created = await applyOpsViaRoute(routes, [
      { op: 'group.create', id: 'gw', name: 'Работа', kind: 'workspace' },
      { op: 'group.create', id: 'gs', name: 'Багфикс', kind: 'session', scope: 'ws-1' },
      { op: 'member.assign', key: 'workspace:ws-1', group: 'gw' },
    ]);
    assert.equal(created.status, 200);
    assert.equal(created.payload.state.rev, 1);
    assert.equal(created.payload.state.groups.gw.name, 'Работа');
    assert.equal(created.payload.state.membership['workspace:ws-1'], 'gw');

    // The store file is on disk in the same shape, pretty-printed.
    const persisted = JSON.parse(readFileSync(stateFile, 'utf8'));
    assert.deepEqual(persisted, created.payload.state);

    // A second hit sees the persisted state.
    const again = await getState(routes);
    assert.equal(again.payload.state.rev, 1);

    // An invalid op answers 400 without a partial write.
    const failed = await applyOpsViaRoute(routes, [
      { op: 'group.rename', id: 'gw', name: 'Переименованы' },
      { op: 'group.delete', id: 'missing' },
    ]);
    assert.equal(failed.status, 400);
    assert.equal(failed.payload.reason, 'no-group');
    const after = await getState(routes);
    assert.equal(after.payload.state.rev, 1);
    assert.equal(after.payload.state.groups.gw.name, 'Работа');
    assert.equal(JSON.parse(readFileSync(stateFile, 'utf8')).rev, 1);

    // A malformed body answers 400.
    const bad = fakeResponse();
    await routes.get('/sidebar-groups/apply')(fakeRequest('POST', ['{"ops": 5}']), bad);
    assert.equal(bad.statusCode, 400);

    // Wrong methods answer 405.
    const wrongGet = fakeResponse();
    await routes.get('/sidebar-groups/apply')(fakeRequest('GET'), wrongGet);
    assert.equal(wrongGet.statusCode, 405);
    const wrongPost = fakeResponse();
    await routes.get('/sidebar-groups/state')(fakeRequest('POST', ['{}']), wrongPost);
    assert.equal(wrongPost.statusCode, 405);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('a corrupted store file degrades to an empty document, not an error', async () => {
  const root = mkdtempSync(path.join(tmpdir(), 'sbg-test-'));
  const stateFile = path.join(root, 'groups.json');
  writeFileSync(stateFile, '{ this is not json');
  const routes = new Map();
  const ctx = {
    on: () => {},
    inject: (_names, cb) => cb(ctx),
    effect: (fn) => {
      fn();
      return () => {};
    },
    get: (name) => (name === 'webServer' ? { register: (route) => routes.set(route.path, route.handler) } : undefined),
  };
  try {
    apply(ctx, { stateFile });
    const { status, payload } = await getState(routes);
    assert.equal(status, 200);
    assert.equal(payload.state.rev, 0);
    // And the next write heals the file.
    const healed = await applyOpsViaRoute(routes, [{ op: 'group.create', name: 'Новая', kind: 'workspace' }]);
    assert.equal(healed.status, 200);
    assert.equal(Object.keys(JSON.parse(readFileSync(stateFile, 'utf8')).groups).length, 1);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('external edits to the store file are picked up by the next read', async () => {
  const root = mkdtempSync(path.join(tmpdir(), 'sbg-test-'));
  const stateFile = path.join(root, 'groups.json');
  const routes = new Map();
  const ctx = {
    on: () => {},
    inject: (_names, cb) => cb(ctx),
    effect: (fn) => {
      fn();
      return () => {};
    },
    get: (name) => (name === 'webServer' ? { register: (route) => routes.set(route.path, route.handler) } : undefined),
  };
  try {
    apply(ctx, { stateFile });
    writeFileSync(
      stateFile,
      JSON.stringify({ version: 1, rev: 7, groups: { g: { id: 'g', name: 'Внешняя', kind: 'workspace', parent: null, scope: '' } }, membership: {} }),
    );
    const { payload } = await getState(routes);
    assert.equal(payload.state.rev, 7);
    assert.equal(payload.state.groups.g.name, 'Внешняя');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('unknown config keys fail loud', () => {
  const ctx = { on: () => {}, inject: () => {}, effect: () => () => {}, get: () => undefined };
  assert.throws(() => apply(ctx, { stateFile: '/tmp/x.json', surprise: 1 }), /unknown config key/);
});
