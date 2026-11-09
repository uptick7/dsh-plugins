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

test('client replaces the shipped browser and re-declares its child seats', () => {
  assert.match(clientSource, /'sidebar\.workspaces'/);
  for (const seat of [
    'sidebar.workspaces.directoryFlow',
    'sidebar.workspaces.session.row.action',
    'sidebar.session.row.leading',
    'sidebar.session.row.trailing',
    'sidebar.session.row.hover',
  ]) {
    assert.match(clientSource, new RegExp(`'${seat.replace(/\./g, '\\.')}'`), `missing seat ${seat}`);
  }
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

test('client never imports harness client packages (self-contained factory)', () => {
  const requires = [...clientSource.matchAll(/require\((['"])([^'"]+)\1\)/g)].map((m) => m[2]);
  assert.deepEqual(requires, ['react']);
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

test('indentation stays compact per the sidebar constraint', () => {
  const indent = Number(clientSource.match(/const INDENT_PX = (\d+);/)?.[1]);
  assert.ok(indent >= 12 && indent <= 14, `indent step ${indent} outside the 12–14px window`);
});
