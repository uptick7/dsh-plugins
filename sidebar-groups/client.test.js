import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));

const clientSource = readFileSync(path.join(here, 'client.js'), 'utf8');
const opsSource = readFileSync(path.join(here, 'groups-ops.js'), 'utf8');
const indexSource = readFileSync(path.join(here, 'index.js'), 'utf8');

test('client module declares the loader entry under the package id', () => {
  assert.match(clientSource, /window\.__ModuleLoader__\.load\(/);
  assert.match(clientSource, /id: '@uptick7\/dsh-sidebar-groups'/);
});

test('client replaces the shipped browser without re-declaring its seats', () => {
  assert.match(clientSource, /'sidebar\.workspaces'/);
  // The shipped browser entry stays registered (shadowed) and keeps declaring the
  // seats; re-declaring them fails the registry's duplicate check at activation.
  const registration = clientSource.slice(clientSource.indexOf("name: 'sidebar.workspaces'"));
  const spec = registration.slice(0, registration.indexOf('makeGroupedBrowser'));
  assert.doesNotMatch(spec, /children:\s*{/, 'registration must not declare children');
  // A single slot rejects two entries at the same priority: the grouped browser
  // must shadow the shipped one (priority 0) with a lower priority (lowest renders).
  assert.match(spec, /priority:\s*-1/, 'registration must shadow with priority -1');
});

test('client icons come from the shipped primitives package', () => {
  // The loader only exposes a package to `require` when it is declared in
  // `dsh.client.inject`, so the manifest must carry the primitives package.
  assert.match(clientSource, /require\('@deepseek-ai\/dsh-client-ui-primitives'\)/);
  const pkg = JSON.parse(readFileSync(path.join(here, 'package.json'), 'utf8'));
  assert.ok(pkg.dsh.client.inject.includes('@deepseek-ai/dsh-client-ui-primitives'), 'primitives package must be injected');
  // No hand-drawn glyphs left behind: the custom svgIcon factory is gone.
  assert.doesNotMatch(clientSource, /function svgIcon/);
});

test('running sessions render the native ongoing StateDot', () => {
  // The shipped StateDot("ongoing") is the spinning circle; the grouped
  // sidebar must reuse it rather than a custom dot or spinner.
  assert.match(clientSource, /const STATUS_DOT = \{ running: 'ongoing', pending: 'warning', done: 'done' \};/);
  assert.match(clientSource, /h\(StateDot, \{ state: STATUS_DOT\[dotKind\] \}\)/);
  assert.doesNotMatch(clientSource, /@keyframes sbg-spin/);
});

test('presentation preferences expose indent and count toggles', () => {
  // Settings page controls: a level-indent selector and a count-badge switch,
  // persisted browser-local under the prefs key with sane clamping.
  assert.match(clientSource, /const PREFS_KEY = 'dsh\.sbg\.prefs\.v1';/);
  assert.match(clientSource, /const PREFS_DEFAULTS = \{ indent: 12, showCounts: true \};/);
  assert.match(clientSource, /const INDENT_CHOICES = \[0, 4, 8, 12, 16, 20\];/);
  assert.match(clientSource, /prefsStore\.set\(\{ indent: Number\(e\.target\.value\) \}\)/);
  assert.match(clientSource, /prefsStore\.set\(\{ showCounts: next \}\)/);
  // Rows honor both prefs: padding per level, badges behind the switch.
  assert.match(clientSource, /paddingLeft: 6 \+ row\.depth \* indent/);
  assert.match(clientSource, /showCounts && row\.count > 0 \? h\('span', \{ className: 'sbg-count' \}/);
});

test('grouped browser only uses renderSlot inside the ownership guard', () => {
  // The renderer injects `renderSlot` only for entries that declare the child
  // slots themselves; this entry shadows the shipped browser without declaring
  // its seats, so the prop is absent in practice.
  assert.match(clientSource, /const sharedDirectoryFlow = typeof renderSlot === 'function';/);
  const call = clientSource.indexOf("renderSlot('sidebar.workspaces.directoryFlow'");
  assert.ok(call > 0, 'shared directory-flow seat is not rendered any more');
  const guard = clientSource.slice(Math.max(0, call - 120), call);
  assert.match(guard, /sharedDirectoryFlow && directoryFlowReady/, 'renderSlot call must be guarded');
});

test('context menu providers receive the captured value object', () => {
  // contextMenus.register resolves with target.value, so the callbacks must not
  // unwrap a second ".value" (the registry silently drops a throwing provider).
  assert.doesNotMatch(clientSource, /(?<!request\.)target\.value\.sessionId/);
  assert.doesNotMatch(clientSource, /(?<!request\.)target\.value\.workspaceId/);
  assert.match(clientSource, /resolve: \(value\) => \{\s*const sessionId = value\.sessionId;/);
  assert.match(clientSource, /resolve: \(value\) => \{\s*const workspaceId = value\.workspaceId;/);
});

test('client registers settings section, overlays, and context menu contributions', () => {
  for (const slot of ['settings.section', 'settings.section.icon', 'shell.overlay', 'contextMenu.icon', 'sidebar.session.row.trailing']) {
    assert.match(clientSource, new RegExp(`'${slot.replace(/\./g, '\\.')}'`), `missing slot ${slot}`);
  }
  assert.match(clientSource, /id: 'sidebar-groups\.session-group'/);
  assert.match(clientSource, /id: 'sidebar-groups\.workspace-group'/);
});

test('client and host halves share the same route paths', () => {
  const clientState = clientSource.match(/const ROUTE_STATE = '([^']+)'/)?.[1];
  const clientApply = clientSource.match(/const ROUTE_APPLY = '([^']+)'/)?.[1];
  assert.match(indexSource, new RegExp(`const STATE_ROUTE = '${clientState?.replace(/\//g, '\\/')}'`));
  assert.match(indexSource, new RegExp(`const APPLY_ROUTE = '${clientApply?.replace(/\//g, '\\/')}'`));
});

test('client ops vocabulary matches the host model', () => {
  const used = new Set([...clientSource.matchAll(/op: '(group\.[a-z]+|member\.[a-z]+)'/g)].map((m) => m[1]));
  assert.ok(used.size > 0, 'no ops referenced from the client');
  for (const op of used) {
    assert.match(opsSource, new RegExp(`'${op}'`), `host model lacks ${op}`);
  }
  const known = [...opsSource.matchAll(/'(group\.[a-z]+|member\.[a-z]+)'/g)].map((m) => m[1]);
  assert.deepEqual(new Set(known), new Set(['group.create', 'group.rename', 'group.delete', 'group.move', 'member.assign', 'member.unassign']));
});

test('client only requires react and the shipped primitives', () => {
  const requires = [...clientSource.matchAll(/require\((['"])([^'"]+)\1\)/g)].map((m) => m[2]);
  assert.deepEqual(requires, ['react', '@deepseek-ai/dsh-client-ui-primitives']);
});

test('client dictionaries cover ru and en for every used key', () => {
  const keys = [...clientSource.matchAll(/\bt\('([\w.]+)'/g)].map((match) => match[1]);
  assert.ok(keys.length > 20, `too few dictionary keys found: ${keys.length}`);
  for (const lang of ['en', 'ru']) {
    const block = clientSource.slice(clientSource.indexOf(`${lang}: {`));
    for (const key of new Set(keys)) {
      assert.match(block, new RegExp(`'${key.replace('.', '\\.')}'`), `${lang} lacks ${key}`);
    }
  }
});

test('membership key prefixes agree across client and model', () => {
  assert.match(clientSource, /const WORKSPACE_PREFIX = 'workspace:';/);
  assert.match(clientSource, /const SESSION_PREFIX = 'session:';/);
  assert.match(opsSource, /\^\(workspace\|session\):/);
});

test('indent default matches the shipped density', () => {
  const defaults = clientSource.match(/const PREFS_DEFAULTS = \{ indent: (\d+), showCounts: (true|false) \};/);
  const indent = Number(defaults?.[1]);
  assert.ok(indent >= 8 && indent <= 14, `indent default ${indent} outside the 8–14px window`);
  assert.equal(defaults?.[2], 'true', 'count badges default to visible');
});
