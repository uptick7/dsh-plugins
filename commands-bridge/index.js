/**
 * Host half of the commands bridge bundle.
 *
 * Bridges markdown slash-commands from three kinds of directories into the
 * shared human-command registry (`ctx.commands`):
 *
 * - `agentDirs`   — this harness install, default `~/.dsh/commands`;
 * - `globalDirs`  — shared by every agent, default `~/.agents/commands`;
 * - project dirs  — `<agent working directory>/.agents/commands`, registered
 *   on each live agent's scoped layer so they shadow same-named globals
 *   only for that agent.
 *
 * Command files are markdown, optionally with a YAML frontmatter carrying
 * `description` and `argument-hint`. Invoking a command reads the file fresh,
 * substitutes `$ARGUMENTS` (or appends the arguments), and steers the prompt
 * to the agent as an ordinary user message — the registry logs the command
 * run and the UI renders the steering like any prompt.
 *
 * A Settings → Commands page (client half) lists every discovered command
 * with its description, argument hint, and an enable/disable toggle. Disabled
 * commands stay on disk but are not registered. Toggle state persists in a
 * JSON file beside the shared commands directory (default
 * `~/.agents/commands-bridge.json`) and never restarts the plugin.
 *
 * Commands from other plugins are listed read-only in the settings page: the
 * registry already carries them (first-party `/plan`, `/compact`, …) and the
 * composer slash menu shows them; their lifecycle belongs to their plugins.
 *
 * This module deliberately imports no harness packages: profile-installed
 * workspace bundles are linked, and their imports resolve from the workspace,
 * where harness packages are absent.
 */
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { watch as fsWatch } from 'node:fs';
import { readFile, rename, writeFile } from 'node:fs/promises';
import { dshHome, expandHome, expandBody, parseCommandFile, scanCommandDir } from './commands-md.js';

const BRAND = '@local/commands-bridge';
const INVENTORY_ROUTE = '/commands-bridge/inventory';
const TOGGLE_ROUTE = '/commands-bridge/toggle';

export const inject = ['commands'];

/**
 * Create one identified, frozen user message (the only piece of
 * `@deepseek-ai/dsh-llm` this plugin needs; replicated to stay import-free).
 */
function createUserMessage(input) {
  const freeze = (value) => {
    if (value !== null && typeof value === 'object') for (const key of Object.keys(value)) freeze(value[key]);
    Object.freeze(value);
    return value;
  };
  return freeze({ ...input, role: 'user', id: randomUUID() });
}

/** Normalize the raw row config; unknown keys fail loud. */
function resolveConfig(config) {
  const raw = config !== null && typeof config === 'object' ? config : {};
  const unknown = Object.keys(raw).filter((key) => !['globalDirs', 'agentDirs', 'projectSubdir', 'stateFile'].includes(key));
  if (unknown.length > 0) throw new Error(`[commands-bridge] unknown config key(s): ${unknown.join(', ')}`);
  const stringArray = (value, fallback) =>
    value === undefined ? fallback : Array.isArray(value) && value.every((item) => typeof item === 'string') ? value : fallback;
  const projectSubdir = typeof raw.projectSubdir === 'string' && raw.projectSubdir.trim() !== '' ? raw.projectSubdir : '.agents/commands';
  const stateFile =
    typeof raw.stateFile === 'string' && raw.stateFile.trim() !== ''
      ? expandHome(raw.stateFile.trim())
      : path.join(os.homedir(), '.agents', 'commands-bridge.json');
  return {
    globalDirs: stringArray(raw.globalDirs, ['~/.agents/commands']).map(expandHome),
    agentDirs: stringArray(raw.agentDirs, ['~/.dsh/commands']).map((p) => (p === '~/.dsh/commands' ? path.join(dshHome(), 'commands') : expandHome(p))),
    projectSubdir,
    stateFile,
  };
}

export function apply(ctx, config) {
  const cfg = resolveConfig(config);

  /** Disabled keys from the state file, cached; rewritten on every toggle. */
  let disabledState = {};
  let stateLoaded = false;

  const readState = async () => {
    try {
      const text = await readFile(cfg.stateFile, 'utf8');
      const parsed = JSON.parse(text);
      disabledState = parsed !== null && typeof parsed.disabled === 'object' && parsed.disabled !== null ? parsed.disabled : {};
    } catch {
      disabledState = {};
    }
    stateLoaded = true;
  };

  const writeState = async () => {
    const payload = JSON.stringify({ disabled: disabledState }, null, 2) + '\n';
    const tmp = `${cfg.stateFile}.tmp-${process.pid}-${randomUUID()}`;
    await writeFile(tmp, payload, { mode: 0o644 });
    await rename(tmp, cfg.stateFile);
  };

  const disabledNow = () => {
    if (!stateLoaded) return {};
    return disabledState;
  };

  /** name -> { key, dispose } for the global registry layer. */
  const globalRegs = new Map();
  /** sessionId -> { agent, cwd, regs: Map<name, dispose> } for project scopes. */
  const tracked = new Map();
  /** dir -> fs watcher. */
  const watchers = new Map();
  /** key -> last registration error, surfaced by the inventory. */
  const registerErrors = new Map();
  const timers = new Set();
  let syncChain = Promise.resolve();
  let syncTimer;

  const disposeSafe = (dispose) => {
    try {
      dispose?.();
    } catch {
      // A registration whose owner already collapsed needs no cleanup.
    }
  };

  const buildDefinition = (entry, kind, cwd) => {
    const fallback =
      kind === 'global' ? 'Общая команда (без описания)' : kind === 'agent' ? 'Команда агента (без описания)' : `Команда проекта ${path.basename(cwd ?? '')} (без описания)`;
    return {
      definitionId: `${BRAND}:${kind}${kind === 'project' ? `:${cwd}` : ''}:${entry.name}`,
      name: entry.name,
      description: entry.description !== '' ? entry.description : fallback,
      ...(entry.argumentHint !== '' ? { input: { hint: entry.argumentHint } } : {}),
      handler: async ({ agent, rawInput }) => {
        const args = rawInput.trim();
        if (args === '' && entry.argumentHint.trim() !== '') {
          return { kind: 'error', text: `Команда /${entry.name} требует аргументы: ${entry.argumentHint}` };
        }
        let text;
        try {
          text = await readFile(entry.file, 'utf8');
        } catch (error) {
          return { kind: 'error', text: `Не удалось прочитать ${entry.file}: ${String(error?.message ?? error)}` };
        }
        const prompt = expandBody(parseCommandFile(text).body, args);
        agent.steer(createUserMessage({ content: [{ type: 'text', text: prompt }], source: { kind: 'user' } }));
        return { kind: 'success', text: `/${entry.name} → отправлено агенту` };
      },
    };
  };

  /** Scan one directory and attach a watcher for it. */
  const scanWatched = async (dir) => {
    ensureWatch(dir);
    return scanCommandDir(dir);
  };

  const sync = async () => {
    await readState();
    const disabled = disabledNow();
    registerErrors.clear();

    // Global layer: harness-install dirs win over machine-shared dirs, first name wins.
    const globalWanted = new Map();
    for (const [kind, dirs] of [
      ['agent', cfg.agentDirs],
      ['global', cfg.globalDirs],
    ]) {
      for (const dir of dirs) {
        const scanned = await scanWatched(dir);
        for (const entry of scanned.commands) entry.key = `${kind}:${entry.name}`;
        for (const entry of scanned.commands) {
          if (entry.warning !== undefined || globalWanted.has(entry.name)) continue;
          globalWanted.set(entry.name, entry);
        }
      }
    }

    for (const [name, reg] of globalRegs) {
      const entry = globalWanted.get(name);
      if (entry === undefined || entry.key !== reg.key || disabled[entry.key] === true) {
        disposeSafe(reg.dispose);
        globalRegs.delete(name);
      }
    }
    for (const [name, entry] of globalWanted) {
      if (globalRegs.has(name) || disabled[entry.key] === true) continue;
      try {
        const dispose = ctx.commands.register(buildDefinition(entry, entry.key.split(':', 1)[0]));
        globalRegs.set(name, { key: entry.key, dispose });
      } catch (error) {
        registerErrors.set(entry.key, String(error?.message ?? error));
      }
    }

    // Project scopes: one registration set per tracked agent, on its own layer.
    for (const record of tracked.values()) {
      if (record.cwd === undefined) continue;
      const scanned = await scanWatched(path.join(record.cwd, cfg.projectSubdir));
      const wanted = new Map();
      for (const entry of scanned.commands) {
        entry.key = 'project:' + entry.name;
        if (entry.warning === undefined && !wanted.has(entry.name)) wanted.set(entry.name, entry);
      }
      for (const [name, dispose] of record.regs) {
        const entry = wanted.get(name);
        if (entry === undefined || disabled[entry.key] === true) {
          disposeSafe(dispose);
          record.regs.delete(name);
        }
      }
      for (const [name, entry] of wanted) {
        if (record.regs.has(name) || disabled[entry.key] === true) continue;
        try {
          let dispose;
          record.agent.ctx.inject(['commands'], (commandCtx) => {
            dispose = commandCtx.commands.register(buildDefinition(entry, 'project', record.cwd));
          });
          if (typeof dispose === 'function') record.regs.set(name, dispose);
        } catch (error) {
          registerErrors.set(entry.key, String(error?.message ?? error));
        }
      }
    }
  };

  /** Serialize syncs so watchers, agents, and HTTP reads never race. */
  const requestSync = () => {
    syncChain = syncChain.catch(() => {}).then(() => sync());
    return syncChain;
  };

  const scheduleSync = () => {
    if (syncTimer !== undefined) return;
    syncTimer = setTimeout(() => {
      syncTimer = undefined;
      void requestSync();
    }, 250);
    timers.add(syncTimer);
  };

  function ensureWatch(dir) {
    if (watchers.has(dir)) return;
    let watcher;
    try {
      watcher = fsWatch(dir, { persistent: false }, () => scheduleSync());
    } catch {
      return;
    }
    watcher.on('error', () => {
      closeWatch(dir);
      scheduleSync();
    });
    watchers.set(dir, watcher);
  }

  function closeWatch(dir) {
    const watcher = watchers.get(dir);
    watchers.delete(dir);
    try {
      watcher?.close();
    } catch {
      // Already closed with its directory.
    }
  }

  /** The working directory of one live agent, when the service is present. */
  const cwdOf = (agent) => {
    try {
      const workingDirectory = ctx.get('workingDirectory');
      return workingDirectory === undefined ? undefined : workingDirectory.get(agent.session);
    } catch {
      return undefined;
    }
  };

  const attach = (agent) => {
    let sessionId;
    try {
      sessionId = agent.session.id;
    } catch {
      return;
    }
    if (tracked.has(sessionId)) return;
    const cwd = cwdOf(agent);
    tracked.set(sessionId, { agent, cwd, regs: new Map() });
    if (cwd !== undefined) ensureWatch(path.join(cwd, cfg.projectSubdir));
  };

  ctx.on('agent/created', ({ agent }) => {
    attach(agent);
    scheduleSync();
  });
  ctx.on('agent/disposed', ({ agent }) => {
    let sessionId;
    try {
      sessionId = agent.session.id;
    } catch {
      return;
    }
    const record = tracked.get(sessionId);
    if (record === undefined) return;
    tracked.delete(sessionId);
    for (const dispose of record.regs.values()) disposeSafe(dispose);
    record.regs.clear();
  });

  // Attach to agents that are already live (this plugin generation loaded late).
  for (const agent of ctx.get('agents')?.list?.() ?? []) attach(agent);

  const rejected = (req, res) => {
    const status = ctx.get('connection')?.requestRejection?.(req);
    if (status === undefined || status === null) return false;
    res.statusCode = status;
    res.end();
    return true;
  };

  const sendJson = (res, status, payload) => {
    res.statusCode = status;
    res.setHeader('content-type', 'application/json; charset=utf-8');
    res.setHeader('cache-control', 'no-store');
    res.end(JSON.stringify(payload));
  };

  const readJson = (req) =>
    new Promise((resolve) => {
      let data = '';
      req.on('data', (chunk) => {
        data += chunk;
        if (data.length > 65536) req.destroy();
      });
      req.on('end', () => {
        try {
          resolve(JSON.parse(data === '' ? '{}' : data));
        } catch {
          resolve(undefined);
        }
      });
      req.on('error', () => resolve(undefined));
    });

  const withEntries = (scanned, kind, disabled, cwd) => ({
    kind,
    ...(cwd !== undefined ? { cwd } : {}),
    path: scanned.path,
    exists: scanned.exists,
    commands: scanned.commands.map((entry) => {
      const key = entry.key ?? `${kind}:${entry.name}`;
      return {
        key,
        name: entry.name,
        description: entry.description,
        argumentHint: entry.argumentHint,
        file: entry.file,
        enabled: disabled[key] !== true,
        ...(entry.warning !== undefined ? { warning: entry.warning } : {}),
        ...(registerErrors.has(key) ? { warning: registerErrors.get(key) } : {}),
      };
    }),
  });

  const inventory = async () => {
    await requestSync();
    const disabled = disabledNow();
    const sources = [];
    for (const [kind, dirs] of [
      ['agent', cfg.agentDirs],
      ['global', cfg.globalDirs],
    ]) {
      for (const dir of dirs) {
        const scanned = await scanCommandDir(dir);
        for (const entry of scanned.commands) entry.key = `${kind}:${entry.name}`;
        sources.push(withEntries(scanned, kind, disabled));
      }
    }
    const seenCwds = new Set();
    for (const record of tracked.values()) {
      if (record.cwd === undefined || seenCwds.has(record.cwd)) continue;
      seenCwds.add(record.cwd);
      const scanned = await scanCommandDir(path.join(record.cwd, cfg.projectSubdir));
      for (const entry of scanned.commands) entry.key = 'project:' + entry.name;
      sources.push(withEntries(scanned, 'project', disabled, record.cwd));
    }

    // Commands owned by other plugins: read-only rows from the live registry.
    let pluginCommands = [];
    const anyAgent = ctx.get('agents')?.list?.()?.[0];
    if (anyAgent !== undefined) {
      try {
        pluginCommands = ctx.commands
          .list(anyAgent)
          .filter((descriptor) => !(typeof descriptor.definitionId === 'string' && descriptor.definitionId.startsWith(`${BRAND}:`)))
          .map((descriptor) => ({
            name: descriptor.name,
            description: descriptor.description,
            hint: descriptor.input?.hint ?? '',
            definitionId: typeof descriptor.definitionId === 'string' ? descriptor.definitionId : '',
          }))
          .sort((a, b) => a.name.localeCompare(b.name));
      } catch {
        pluginCommands = [];
      }
    }
    return {
      stateFile: cfg.stateFile,
      sources,
      plugins: { available: anyAgent !== undefined, commands: pluginCommands },
    };
  };

  const webServer = ctx.get('webServer');
  if (webServer !== undefined) {
    ctx.effect(
      () =>
        webServer.register({
          kind: 'exact',
          path: INVENTORY_ROUTE,
          handler: async (req, res) => {
            if (rejected(req, res)) return;
            if (req.method !== 'GET') {
              sendJson(res, 405, { error: 'GET only' });
              return;
            }
            try {
              sendJson(res, 200, await inventory());
            } catch (error) {
              sendJson(res, 500, { error: String(error?.message ?? error) });
            }
          },
        }),
      'commands-bridge: inventory route',
    );
    ctx.effect(
      () =>
        webServer.register({
          kind: 'exact',
          path: TOGGLE_ROUTE,
          handler: async (req, res) => {
            if (rejected(req, res)) return;
            if (req.method !== 'POST') {
              sendJson(res, 405, { error: 'POST only' });
              return;
            }
            const body = await readJson(req);
            const key = typeof body?.key === 'string' ? body.key : '';
            const enabled = body?.enabled === true;
            if (!/^(global|agent|project):[a-z0-9][a-z0-9_-]*$/.test(key)) {
              sendJson(res, 400, { error: `invalid key ${JSON.stringify(key)}` });
              return;
            }
            try {
              await readState();
              if (enabled) delete disabledState[key];
              else disabledState[key] = true;
              await writeState();
            } catch (error) {
              sendJson(res, 500, { error: `Не удалось сохранить состояние: ${String(error?.message ?? error)}` });
              return;
            }
            await requestSync();
            sendJson(res, 200, { ok: true });
          },
        }),
      'commands-bridge: toggle route',
    );
  }

  void requestSync();

  ctx.effect(
    () => () => {
      if (syncTimer !== undefined) clearTimeout(syncTimer);
      for (const timer of timers) clearTimeout(timer);
      timers.clear();
      for (const dir of [...watchers.keys()]) closeWatch(dir);
      for (const reg of globalRegs.values()) disposeSafe(reg.dispose);
      globalRegs.clear();
      for (const record of tracked.values()) {
        for (const dispose of record.regs.values()) disposeSafe(dispose);
        record.regs.clear();
      }
      tracked.clear();
    },
    'commands-bridge: cleanup',
  );
}
