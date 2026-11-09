/**
 * Host half of the sidebar groups bundle.
 *
 * Owns the durable store of the plugin's UI grouping — user-defined folders
 * for sidebar workspaces and for the sessions inside each workspace — and
 * serves it to the web client over two routes on the same origin:
 *
 * - `GET  /sidebar-groups/state` returns the whole document;
 * - `POST /sidebar-groups/apply` takes `{ ops: [...] }`, validates every op
 *   against the evolving state (a batch may create a group and assign
 *   members to it), applies all-or-nothing, persists atomically, and answers
 *   with the authoritative document so the client self-corrects.
 *
 * Groups reference workspaces and sessions by their stable Host ids, so
 * renaming a session title or a workspace display name never breaks
 * membership. The store never touches session titles, workspace titles, or
 * directories: grouping is a pure UI overlay. The document lives in a JSON
 * file beside the harness home (default `~/.dsh/sidebar-groups.json`,
 * configurable via `stateFile`) and survives browser changes and reloads.
 *
 * The op model lives in `groups-ops.js` (pure, testable): validation
 * failures carry a stable `reason`, and the Host answers 400 without a
 * partial write. The client half mirrors nothing: it renders the returned
 * document and sends ops.
 *
 * This module deliberately imports no harness packages: profile-installed
 * workspace bundles are linked, and their imports resolve from the workspace,
 * where harness packages are absent.
 */
import os from 'node:os';
import path from 'node:path';
import { readFile, rename, writeFile } from 'node:fs/promises';
import { applyOps, coerceState, emptyState, OpError } from './groups-ops.js';

const STATE_ROUTE = '/sidebar-groups/state';
const APPLY_ROUTE = '/sidebar-groups/apply';

/** Expand a leading `~` to the user home directory. */
function expandHome(p) {
  if (p === '~') return os.homedir();
  if (p.startsWith('~/') || p.startsWith('~\\')) return path.join(os.homedir(), p.slice(2));
  return p;
}

/** Resolve the harness home directory (default `~/.dsh`). */
function dshHome() {
  const value = (process.env.DSH_HOME ?? '').trim();
  return value !== '' ? value : path.join(os.homedir(), '.dsh');
}

/** Normalize the raw row config; unknown keys fail loud. */
function resolveConfig(config) {
  const raw = config !== null && typeof config === 'object' ? config : {};
  const unknown = Object.keys(raw).filter((key) => key !== 'stateFile');
  if (unknown.length > 0) throw new Error(`[sidebar-groups] unknown config key(s): ${unknown.join(', ')}`);
  const stateFile =
    typeof raw.stateFile === 'string' && raw.stateFile.trim() !== ''
      ? expandHome(raw.stateFile.trim())
      : path.join(dshHome(), 'sidebar-groups.json');
  return { stateFile };
}

export const inject = [];

export function apply(ctx, config) {
  const cfg = resolveConfig(config);

  let state = emptyState();

  const readState = async () => {
    try {
      const text = await readFile(cfg.stateFile, 'utf8');
      state = coerceState(JSON.parse(text));
    } catch {
      // Missing or unreadable file starts an empty document; a corrupted one
      // is overwritten by the next successful write rather than blocking the UI.
      state = emptyState();
    }
  };

  const writeState = async () => {
    const payload = JSON.stringify(state, null, 2) + '\n';
    const tmp = `${cfg.stateFile}.tmp-${process.pid}-${Date.now()}`;
    await writeFile(tmp, payload, { mode: 0o644 });
    await rename(tmp, cfg.stateFile);
  };

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
        if (data.length > 262144) req.destroy();
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

  ctx.inject(['webServer'], (hostCtx) => {
    const webServer = hostCtx.get('webServer');
    hostCtx.effect(
      () =>
        webServer.register({
          kind: 'exact',
          path: STATE_ROUTE,
          handler: async (req, res) => {
            if (rejected(req, res)) return;
            if (req.method !== 'GET') {
              sendJson(res, 405, { error: 'GET only' });
              return;
            }
            await readState();
            sendJson(res, 200, { ok: true, stateFile: cfg.stateFile, state });
          },
        }),
      'sidebar-groups: state route',
    );
    hostCtx.effect(
      () =>
        webServer.register({
          kind: 'exact',
          path: APPLY_ROUTE,
          handler: async (req, res) => {
            if (rejected(req, res)) return;
            if (req.method !== 'POST') {
              sendJson(res, 405, { error: 'POST only' });
              return;
            }
            const body = await readJson(req);
            const ops = body !== undefined && body !== null && Array.isArray(body.ops) ? body.ops : undefined;
            if (ops === undefined) {
              sendJson(res, 400, { error: 'ожидался JSON { ops: [...] }' });
              return;
            }
            try {
              await readState();
              state = applyOps(state, ops);
              await writeState();
              sendJson(res, 200, { ok: true, stateFile: cfg.stateFile, state });
            } catch (error) {
              if (error instanceof OpError) {
                sendJson(res, 400, { error: error.message, reason: error.reason });
                return;
              }
              sendJson(res, 500, { error: `Не удалось сохранить группы: ${String(error?.message ?? error)}` });
            }
          },
        }),
      'sidebar-groups: apply route',
    );
  });

  ctx.effect(
    () => () => {
      state = emptyState();
    },
    'sidebar-groups: cleanup',
  );
}
