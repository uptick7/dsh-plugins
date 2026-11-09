/**
 * Local activation harness for client.js: materializes the Loader module with
 * stubs and runs apply(ctx) against fake services, printing the first throw.
 * Not part of the package — a development tool for debugging boot failures.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const source = readFileSync(path.join(here, 'client.js'), 'utf8');

let captured;
globalThis.window = {
  __ModuleLoader__: { load(def) { captured = def; } },
  localStorage: { getItem: () => null, setItem: () => {}, removeItem: () => {} },
  innerWidth: 1400,
  innerHeight: 900,
  addEventListener: () => {},
  removeEventListener: () => {},
};
globalThis.document = {
  createElement: () => ({ set textContent(v) {} , remove() {} }),
  head: { appendChild() {} },
  addEventListener() {},
  removeEventListener() {},
  visibilityState: 'visible',
};
globalThis.fetch = async () => { throw new Error('no network in harness'); };

const reactStub = Object.fromEntries(
  ['useState', 'useEffect', 'useMemo', 'useRef', 'useCallback', 'useSyncExternalStore', 'createElement'].map((k) => [k, () => null]),
);
const require = (id) => {
  if (id === 'react') return reactStub;
  throw new Error(`unexpected require: ${id}`);
};

new Function('window', source)(globalThis.window);
if (captured === undefined) throw new Error('client.js never called __ModuleLoader__.load');

const module = captured.factory(require);
console.log('factory OK; inject =', module.inject);

const registered = [];
const declarations = [];
const effects = [];
const slots = {
  register(spec, component) {
    registered.push(spec.name);
    return () => {};
  },
  inject(key, cb) {
    declarations.push(key);
    const dispose = cb();
    return () => (typeof dispose === 'function' ? dispose() : dispose?.());
  },
  entries: () => [],
  subscribe: () => () => {},
};
const observable = { getSnapshot: () => ({}), subscribe: () => () => {} };
const ctx = {
  slots,
  get(name) {
    if (name === 'slots') return slots;
    if (name === 'locale') return { bind: () => (key, params) => key, register: () => () => {} };
    if (name === 'sessions') return { list: observable, search: async () => ({ ok: true, value: { items: [], hasMore: false } }), searchResultLimit: 20, using: async () => ({}) };
    if (name === 'workspaces') return { list: observable, rename: async () => {}, delete: async () => {}, create: async () => ({}) };
    if (name === 'uiWorkspace') return { openSession() {}, openWorkspace() {}, startSession() {}, pinSession: async () => {}, unpinSession: async () => {}, archiveSession: async () => {}, unarchiveSession: async () => {} };
    if (name === 'contextMenus') return { register: () => () => {}, open() {}, close() {}, resolve: () => ({ source: observable, ready: Promise.resolve(), select() {}, dispose() {} }), active: observable };
    if (name === 'remoteAccess') return { source: () => ({ getSnapshot: () => true }) };
    return undefined;
  },
  effect(fn, label) {
    effects.push(label);
    const dispose = fn();
    if (typeof dispose === 'function') effects.push(dispose);
    return dispose;
  },
  inject(_names, cb) {
    cb(ctx);
  },
  on() {},
};

try {
  module.apply(ctx);
  console.log('apply OK');
  console.log('slots registered:', registered.join(', '));
  console.log('slot injects waited on:', declarations.join(', '));
} catch (error) {
  console.error('apply FAILED:', error);
  process.exitCode = 1;
}
