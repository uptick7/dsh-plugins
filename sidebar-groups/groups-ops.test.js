import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  SCHEMA_VERSION,
  OpError,
  applyOps,
  cleanupOps,
  coerceState,
  emptyState,
  normalizeName,
  orphans,
  parseMemberKey,
  validateOp,
} from './groups-ops.js';

const WS = 'ws-1';
const SESSION = 's-1';

function base() {
  let state = emptyState();
  state = applyOps(state, [
    { op: 'group.create', id: 'gw', name: 'Работа', kind: 'workspace' },
    { op: 'group.create', id: 'gw-sub', name: 'Клиентские', kind: 'workspace', parent: 'gw' },
    { op: 'group.create', id: 'gs', name: 'Багфикс', kind: 'session', scope: WS },
    { op: 'group.create', id: 'gs-sub', name: 'Срочное', kind: 'session', scope: WS, parent: 'gs' },
    { op: 'member.assign', key: `workspace:${WS}`, group: 'gw' },
    { op: 'member.assign', key: `session:${SESSION}`, group: 'gs' },
  ]);
  return state;
}

test('normalizeName trims, collapses whitespace, and enforces length', () => {
  assert.equal(normalizeName('  Багфикс   v2 '), 'Багфикс v2');
  assert.equal(normalizeName('   '), undefined);
  assert.equal(normalizeName(''), undefined);
  assert.equal(normalizeName(undefined), undefined);
  assert.equal(normalizeName(42), undefined);
  assert.ok(normalizeName('x'.repeat(200)) !== undefined);
  assert.equal(normalizeName('x'.repeat(201)), undefined);
});

test('parseMemberKey splits well-formed keys only', () => {
  assert.deepEqual(parseMemberKey('workspace:abc'), { kind: 'workspace', id: 'abc' });
  assert.deepEqual(parseMemberKey('session:xyz'), { kind: 'session', id: 'xyz' });
  assert.equal(parseMemberKey('workspace:'), undefined);
  assert.equal(parseMemberKey('folder:abc'), undefined);
  assert.equal(parseMemberKey('workspace'), undefined);
});

test('coerceState keeps a valid document and drops legacy junk', () => {
  const state = base();
  assert.deepEqual(coerceState(JSON.parse(JSON.stringify(state))), state);
  assert.deepEqual(coerceState(undefined), emptyState());
  assert.deepEqual(coerceState({ version: 99, groups: {}, membership: {} }), emptyState());
  const junk = coerceState({
    version: SCHEMA_VERSION,
    rev: 5,
    groups: {
      good: { id: 'good', name: '  A  ', kind: 'workspace', parent: null },
      badKind: { id: 'badKind', name: 'B', kind: 'folder', parent: null },
      badName: { id: 'badName', name: '   ', kind: 'workspace', parent: null },
      danglingParent: { id: 'danglingParent', name: 'C', kind: 'workspace', parent: 'missing' },
    },
    membership: { 'workspace:w': 'good', 'session:s': 'gone', 'junk-key': 'good', 'session:': 'good' },
  });
  assert.equal(junk.rev, 5);
  assert.deepEqual(Object.keys(junk.groups).sort(), ['danglingParent', 'good']);
  assert.equal(junk.groups.good.name, 'A');
  assert.equal(junk.groups.danglingParent.parent, null); // missing parent falls back to the root
  assert.deepEqual(junk.membership, { 'workspace:w': 'good' }); // stale group refs are dropped
});

test('group.create validates kind, name, scope, and parent domain', () => {
  const state = emptyState();
  const made = validateOp(state, { op: 'group.create', name: 'Работа', kind: 'workspace' });
  assert.equal(made.scope, '');
  assert.equal(made.parent, null);
  assert.equal(typeof made.id, 'string');
  assert.ok(made.id.length >= 8); // minted fallback id when the client sent none

  assert.throws(() => validateOp(state, { op: 'group.create', name: 'X', kind: 'folder' }), (e) => e.reason === 'bad-kind');
  assert.throws(() => validateOp(state, { op: 'group.create', name: '   ', kind: 'workspace' }), (e) => e.reason === 'bad-name');
  assert.throws(() => validateOp(state, { op: 'group.create', name: 'X', kind: 'workspace', scope: 'ws-9' }), (e) => e.reason === 'bad-scope');
  assert.throws(() => validateOp(state, { op: 'group.create', name: 'X', kind: 'workspace', parent: 'nope' }), (e) => e.reason === 'no-parent');
  const ungrouped = validateOp(state, { op: 'group.create', name: 'X', kind: 'session' });
  assert.equal(ungrouped.scope, ''); // a root session group without scope lands in the Ungrouped bucket
  const withState = base();
  assert.throws(() => validateOp(withState, { op: 'group.create', name: 'X', kind: 'session', scope: 'ws-2', parent: 'gs' }), (e) => e.reason === 'domain-mismatch');
  assert.throws(() => validateOp(withState, { op: 'group.create', name: 'X', kind: 'session', parent: 'gw' }), (e) => e.reason === 'domain-mismatch');
  assert.throws(() => validateOp(withState, { op: 'group.create', id: 'gw', name: 'X', kind: 'workspace' }), (e) => e.reason === 'bad-id');
});

test('session subgroup inherits the parent scope when omitted', () => {
  const state = base();
  const made = validateOp(state, { op: 'group.create', name: 'Новая', kind: 'session', parent: 'gs' });
  assert.equal(made.scope, WS);
});

test('group.rename and group.delete validate existence and names', () => {
  const state = base();
  assert.deepEqual(validateOp(state, { op: 'group.rename', id: 'gw', name: ' Работа! ' }), { op: 'group.rename', id: 'gw', name: 'Работа!' });
  assert.throws(() => validateOp(state, { op: 'group.rename', id: 'nope', name: 'X' }), (e) => e.reason === 'no-group');
  assert.throws(() => validateOp(state, { op: 'group.rename', id: 'gw', name: '' }), (e) => e.reason === 'bad-name');
  assert.deepEqual(validateOp(state, { op: 'group.delete', id: 'gw' }), { op: 'group.delete', id: 'gw' });
  assert.throws(() => validateOp(state, { op: 'group.delete', id: 'nope' }), (e) => e.reason === 'no-group');
});

test('group.move reparents, rejects cycles and cross-domain moves', () => {
  const state = base();
  assert.deepEqual(validateOp(state, { op: 'group.move', id: 'gw-sub', parent: null }), { op: 'group.move', id: 'gw-sub', parent: null });
  assert.throws(() => validateOp(state, { op: 'group.move', id: 'gw', parent: 'gw' }), (e) => e.reason === 'cycle');
  assert.throws(() => validateOp(state, { op: 'group.move', id: 'gw', parent: 'gw-sub' }), (e) => e.reason === 'cycle');
  assert.throws(() => validateOp(state, { op: 'group.move', id: 'gw', parent: 'gs' }), (e) => e.reason === 'domain-mismatch');
  assert.throws(() => validateOp(state, { op: 'group.move', id: 'gs-sub', parent: 'gs', scope: 'other' }), (e) => e.reason === 'unknown-field');
  assert.throws(() => validateOp(state, { op: 'group.move', id: 'gs-sub', parent: 'nope' }), (e) => e.reason === 'no-parent');
});

test('member.assign enforces domains; member.unassign tolerates absence', () => {
  const state = base();
  assert.deepEqual(validateOp(state, { op: 'member.assign', key: `workspace:${WS}`, group: 'gw-sub' }), { op: 'member.assign', key: `workspace:${WS}`, group: 'gw-sub' });
  assert.throws(() => validateOp(state, { op: 'member.assign', key: `session:${SESSION}`, group: 'gw' }), (e) => e.reason === 'domain-mismatch');
  assert.throws(() => validateOp(state, { op: 'member.assign', key: `workspace:${WS}`, group: 'gs' }), (e) => e.reason === 'domain-mismatch');
  assert.throws(() => validateOp(state, { op: 'member.assign', key: `workspace:${WS}`, group: 'nope' }), (e) => e.reason === 'no-group');
  assert.throws(() => validateOp(state, { op: 'member.assign', key: 'workspace:', group: 'gw' }), (e) => e.reason === 'bad-key');
  assert.deepEqual(validateOp(state, { op: 'member.unassign', key: 'session:absent' }), { op: 'member.unassign', key: 'session:absent' });
});

test('unknown ops and unknown fields fail loudly', () => {
  const state = emptyState();
  assert.throws(() => validateOp(state, { op: 'group.explode' }), (e) => e.reason === 'unknown-op');
  assert.throws(() => validateOp(state, { op: 'group.rename', id: 'x', name: 'X', surprise: 1 }), (e) => e.reason === 'unknown-field');
  assert.throws(() => validateOp(state, 'group.rename'), (e) => e.reason === 'bad-op');
  assert.throws(() => applyOps(state, 'ops'), (e) => e.reason === 'bad-ops');
});

test('applyOps increments rev, applies batches atomically, never mutates input', () => {
  const state = base();
  const frozen = JSON.stringify(state);
  const next = applyOps(state, [
    { op: 'group.create', id: 'gs2', name: 'Рефакторинг', kind: 'session', scope: WS },
    { op: 'member.assign', key: `session:${SESSION}`, group: 'gs2' },
  ]);
  assert.equal(next.rev, state.rev + 1);
  assert.equal(next.groups.gs2.name, 'Рефакторинг');
  assert.equal(next.membership[`session:${SESSION}`], 'gs2');
  assert.equal(JSON.stringify(state), frozen);
  assert.throws(() => applyOps(state, [{ op: 'group.create', id: 'ok', name: 'Ok', kind: 'workspace' }, { op: 'group.delete', id: 'missing' }]), OpError);
  assert.equal(JSON.stringify(state), frozen);
});

test('group.delete lifts subgroups (with their members) and unassigns the group own members', () => {
  let state = base();
  state = applyOps(state, [{ op: 'member.assign', key: 'workspace:ws-2', group: 'gw-sub' }]);
  state = applyOps(state, [{ op: 'group.delete', id: 'gw' }]);
  assert.equal(state.groups.gw, undefined);
  assert.equal(state.groups['gw-sub'].parent, null); // lifted to gw's parent (root)
  assert.equal(state.membership['workspace:ws-2'], 'gw-sub'); // members of the lifted subgroup survive
  assert.equal(state.membership[`workspace:${WS}`], undefined); // gw's own members drop with it
  assert.equal(state.membership[`session:${SESSION}`], 'gs'); // session tree untouched
  assert.ok(state.groups['gs-sub']);
});

test('orphans reports references to missing groups and dead members', () => {
  const state = base();
  const live = orphans(state, [WS], [SESSION, 's-2']);
  assert.deepEqual(live, { staleKeys: [], staleGroups: [] });
  const withDeadSession = orphans(state, [WS], []);
  assert.deepEqual(withDeadSession.staleKeys, [`session:${SESSION}`]);
  assert.deepEqual(withDeadSession.staleGroups, ['gs']);
  const withDeadGroup = orphans(state, [WS], [SESSION]);
  const mutated = JSON.parse(JSON.stringify(state));
  delete mutated.groups.gs;
  assert.deepEqual(orphans(mutated, [WS], [SESSION]).staleKeys, [`session:${SESSION}`]);
});

test('cleanupOps unassigns stale keys and deletes emptied husk groups', () => {
  const state = base();
  const ops = cleanupOps(state, [WS], []);
  assert.deepEqual(ops, [{ op: 'member.unassign', key: `session:${SESSION}` }]);
  // After applying the cleanup the husk group "gs" remains (parentless empty groups render
  // by design); removing it needs an explicit group.delete, which cleanup keeps out.
  const cleaned = applyOps(state, ops);
  assert.equal(cleaned.membership[`session:${SESSION}`], undefined);
  assert.ok(cleaned.groups.gs);
});
