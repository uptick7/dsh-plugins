import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { EventEmitter } from 'node:events';
import { apply } from './index.js';

/** Minimal Node-like request for the route handlers. */
function fakeRequest(method) {
  const emitter = new EventEmitter();
  emitter.method = method;
  emitter.headers = { 'content-type': 'application/json' };
  emitter.url = '/';
  emitter.destroy = () => emitter;
  return emitter;
}

function fakeResponse() {
  const res = { statusCode: 0, headers: {}, body: '' };
  res.setHeader = (k, v) => {
    res.headers[k] = v;
  };
  res.end = (data) => {
    res.body = String(data ?? '');
    res.finished = true;
  };
  return res;
}

async function waitFor(predicate, ms = 2000) {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  assert.ok(predicate(), 'condition not reached in time');
}

test('bridge syncs commands, serves inventory, and persists toggles', async () => {
  const root = mkdtempSync(path.join(tmpdir(), 'cmdb-test-'));
  const globalDir = path.join(root, 'shared');
  const agentDir = path.join(root, 'agent');
  const projectDir = path.join(root, 'project');
  const stateFile = path.join(root, 'state.json');
  mkdirSync(globalDir);
  mkdirSync(agentDir);
  mkdirSync(projectDir);
  mkdirSync(path.join(projectDir, '.agents'));
  mkdirSync(path.join(projectDir, '.agents', 'commands'));
  writeFileSync(
    path.join(globalDir, 'analyse_ticket.md'),
    '---\ndescription: Анализ тикета\nargument-hint: KEY\n---\nТело $ARGUMENTS',
  );
  writeFileSync(path.join(agentDir, 'analyse_ticket.md'), 'Агентная версия $ARGUMENTS');
  writeFileSync(
    path.join(projectDir, '.agents', 'commands', 'deploy.md'),
    '---\nargument-hint: ENV\n---\nДеплой на $ARGUMENTS',
  );
  writeFileSync(path.join(globalDir, 'Bad Name.md'), 'не регистрируется');

  try {
    const registrations = [];
    const routes = new Map();
    const steered = [];
    let projectScoped = [];

    const commandCtx = {
      commands: {
        register: (definition) => {
          registrations.push(definition);
          return () => {
            const index = registrations.indexOf(definition);
            if (index !== -1) registrations.splice(index, 1);
          };
        },
      },
    };

    const agents = [
      {
        session: { id: 's1' },
        ctx: {
          inject: (_names, cb) => {
            cb(commandCtx);
          },
        },
      },
    ];

    const ctx = {
      commands: commandCtx.commands,
      on: () => {},
      effect: (fn, _label) => {
        fn();
        return () => {};
      },
      get: (name) => {
        if (name === 'agents') return { list: () => agents };
        if (name === 'workingDirectory') return { get: () => projectDir };
        if (name === 'webServer') {
          return { register: (route) => routes.set(route.path, route.handler) };
        }
        return undefined;
      },
    };

    apply(ctx, {
      globalDirs: [globalDir],
      agentDirs: [agentDir],
      projectSubdir: '.agents/commands',
      stateFile,
    });

    await waitFor(() => registrations.length === 2);

    // Agent-install dir shadows the machine-shared dir for the same name;
    // the invalid name is skipped.
    const names = registrations.map((d) => d.name).sort();
    assert.deepEqual(names, ['analyse_ticket', 'deploy']);
    const analyse = registrations.find((d) => d.name === 'analyse_ticket');
    assert.equal(analyse.definitionId.includes(':agent:'), true);
    // The winning file (agent dir) has no frontmatter: no hint, fallback description.
    assert.equal(analyse.input, undefined);
    assert.equal(analyse.description, 'Команда агента (без описания)');
    const deploy = registrations.find((d) => d.name === 'deploy');
    assert.equal(deploy.definitionId.includes('project'), true);
    assert.equal(deploy.input.hint, 'ENV');

    // Handler expands arguments and steers a user message.
    let steer;
    const handlerResult = await analyse.handler({
      agent: { steer: (message) => steer = message },
      rawInput: '  QA-123  ',
    });
    assert.equal(handlerResult.kind, 'success');
    assert.equal(steer.role, 'user');
    assert.equal(steer.content[0].text, 'Агентная версия QA-123');
    const missing = await deploy.handler({ agent: { steer: () => {} }, rawInput: '   ' });
    assert.equal(missing.kind, 'error');

    // Inventory route reflects sources, enabled state, and plugin rows.
    const inventoryHandler = routes.get('/commands-bridge/inventory');
    assert.ok(inventoryHandler);
    const res1 = fakeResponse();
    await inventoryHandler(fakeRequest('GET'), res1);
    const inventory = JSON.parse(res1.body);
    assert.equal(res1.statusCode, 200);
    const kinds = Object.fromEntries(inventory.sources.map((source) => [source.kind, source]));
    const analyseRow = kinds.global.commands.find((command) => command.name === 'analyse_ticket');
    assert.equal(analyseRow.enabled, true);
    assert.equal(analyseRow.warning, undefined);
    const invalidRow = kinds.global.commands.find((command) => command.name === 'bad name');
    assert.match(invalidRow.warning, /недопустимое имя/);
    assert.equal(kinds.project.cwd, projectDir);
    assert.equal(kinds.project.commands[0].name, 'deploy');
    assert.equal(inventory.plugins.available, true);

    // Toggle persists and hides the command.
    const toggleHandler = routes.get('/commands-bridge/toggle');
    const res2 = fakeResponse();
    const post = fakeRequest('POST');
    process.nextTick(() => {
      post.emit('data', JSON.stringify({ key: 'agent:analyse_ticket', enabled: false }));
      post.emit('end');
    });
    await toggleHandler(post, res2);
    assert.equal(res2.statusCode, 200);
    assert.deepEqual(JSON.parse(readFileSync(stateFile, 'utf8')), { disabled: { 'agent:analyse_ticket': true } });
    await waitFor(() => registrations.length === 1);
    assert.equal(registrations.some((d) => d.name === 'deploy'), true);

    const res3 = fakeResponse();
    await inventoryHandler(fakeRequest('GET'), res3);
    const after = JSON.parse(res3.body);
    assert.equal(after.sources.find((s) => s.kind === 'agent').commands[0].enabled, false);

    // Invalid toggle key is rejected.
    const res4 = fakeResponse();
    const bad = fakeRequest('POST');
    process.nextTick(() => {
      bad.emit('data', JSON.stringify({ key: 'evil:;drop', enabled: true }));
      bad.emit('end');
    });
    await toggleHandler(bad, res4);
    assert.equal(res4.statusCode, 400);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
