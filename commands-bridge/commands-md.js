/**
 * Pure helpers of the commands bridge: markdown frontmatter parsing, argument
 * substitution, and directory scanning. No harness imports — usable from
 * tests and from the Host half alike.
 */
import os from 'node:os';
import path from 'node:path';
import { readFile, readdir } from 'node:fs/promises';

/** Expand a leading `~` to the user home directory. */
export function expandHome(p) {
  if (p === '~') return os.homedir();
  if (p.startsWith('~/') || p.startsWith('~\\')) return path.join(os.homedir(), p.slice(2));
  return p;
}

/** Resolve the harness home directory (default `~/.dsh`). */
export function dshHome() {
  const value = (process.env.DSH_HOME ?? '').trim();
  return value !== '' ? value : path.join(os.homedir(), '.dsh');
}

/** Read one config field: plain values pass through, volatile fields unwrap `.get()`. */
export function readField(value) {
  if (value !== null && typeof value === 'object' && typeof value.get === 'function') {
    try {
      return value.get();
    } catch {
      return undefined;
    }
  }
  return value;
}

/**
 * Split one command markdown file into frontmatter metadata and prompt body.
 * @param text - complete file text.
 * @returns metadata (lowercased keys) and the body after the frontmatter fence.
 */
export function parseCommandFile(text) {
  const meta = {};
  let body = text;
  const fence = /^---\r?\n([\s\S]*?)\r?\n---[ \t]*\r?\n?/.exec(text);
  if (fence !== null) {
    for (const line of fence[1].split(/\r?\n/)) {
      const pair = /^([A-Za-z][\w-]*)[ \t]*:[ \t]*(.*)$/.exec(line.trim());
      if (pair === null) continue;
      let value = pair[2].trim();
      if (value.length >= 2 && ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'")))) {
        value = value.slice(1, -1);
      }
      meta[pair[1].toLowerCase()] = value;
    }
    body = text.slice(fence[0].length);
  }
  return { meta, body };
}

/**
 * Substitute command arguments into a prompt body: `$ARGUMENTS` receives the
 * whole argument string, `$1`–`$9` receive positional words; a body with no
 * placeholder gets the arguments appended.
 */
export function expandBody(body, args) {
  const positional = args === '' ? [] : args.split(/\s+/);
  let out = body.replace(/\$ARGUMENTS/g, () => args);
  out = out.replace(/\$([1-9])/g, (raw, index) => {
    const value = positional[Number(index) - 1];
    if (value === undefined) return raw;
    const unquoted = /^"(.*)"$/.exec(value);
    return unquoted !== null ? unquoted[1] : value;
  });
  if (args !== '' && !/\$ARGUMENTS|\$[1-9]/.test(body)) out = `${out.replace(/\s+$/, '')}\n\n${args}`;
  return out;
}

/** The command name a filename provides, and whether the registry accepts it. */
export function commandNameOf(fileName) {
  const base = fileName.replace(/\.md$/i, '');
  return { base, valid: /^[a-z0-9][a-z0-9_-]*$/.test(base) };
}

/** List the markdown commands in one directory; a missing directory scans empty. */
export async function scanCommandDir(dir) {
  const out = { path: dir, exists: false, commands: [] };
  let names;
  try {
    names = await readdir(dir);
    out.exists = true;
  } catch {
    return out;
  }
  for (const name of names.sort()) {
    if (!name.toLowerCase().endsWith('.md')) continue;
    const file = path.join(dir, name);
    let text;
    try {
      text = await readFile(file, 'utf8');
    } catch {
      continue;
    }
    const { meta } = parseCommandFile(text);
    const { base, valid } = commandNameOf(name);
    out.commands.push({
      name: base.toLowerCase(),
      file,
      description: typeof meta.description === 'string' ? meta.description : '',
      argumentHint: typeof meta['argument-hint'] === 'string' ? meta['argument-hint'] : '',
      warning: valid ? undefined : `недопустимое имя команды «${base}» (ожидается a-z, 0-9, «_», «-»)`,
    });
  }
  return out;
}
