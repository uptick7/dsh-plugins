import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));

test('client module declares the loader entry and settings slots', () => {
  const source = readFileSync(path.join(here, 'client.js'), 'utf8');
  assert.match(source, /window\.__ModuleLoader__\.load\(/);
  assert.match(source, /id: '@local\/commands-bridge'/);
  assert.match(source, /'settings\.section'/);
  assert.match(source, /'settings\.section\.icon'/);
  assert.match(source, /role: 'switch'/);
});

test('client dictionaries cover ru and en for every used key', () => {
  const source = readFileSync(path.join(here, 'client.js'), 'utf8');
  const keys = [...source.matchAll(/t\('([\w.]+)'\)/g)].map((match) => match[1]);
  assert.ok(keys.length > 0);
  for (const lang of ['en', 'ru']) {
    const block = source.slice(source.indexOf(`${lang}: {`));
    for (const key of new Set(keys)) {
      assert.match(block, new RegExp(`'${key.replace('.', '\\.')}'`), `${lang} lacks ${key}`);
    }
  }
});
