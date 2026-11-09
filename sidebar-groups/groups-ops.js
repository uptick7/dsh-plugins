/**
 * Pure model of the sidebar groups document: membership ops, validation,
 * application, and orphan detection. No harness imports — usable from tests
 * and from the Host half alike.
 *
 * The document is the single source of truth for the plugin's UI grouping:
 *   - `groups` maps stable group ids (client-minted UUIDs) to their name,
 *     domain kind (`workspace` | `session`), parent group id, and scope.
 *     A `workspace` group always has scope `""`; a `session` group carries
 *     the workspace id (or `""` for the Ungrouped bucket) whose sessions it
 *     may hold. Sessions themselves never move between workspaces: the
 *     group scope only states which workspace's session list the group
 *     partitions.
 *   - `membership` maps member keys (`workspace:<id>` / `session:<id>`) to
 *     the group id holding them, or `null`/absent for "no group".
 *
 * Workspaces and sessions are referenced by their stable Host ids, so
 * renaming a session title or a workspace display name never breaks
 * membership. Nothing here touches session titles, workspace titles, or
 * directories: grouping is a pure UI overlay.
 */

/** Current document schema version; bump on incompatible changes. */
export const SCHEMA_VERSION = 1;

/** Group domains. */
export const GROUP_KINDS = ['workspace', 'session'];

/** Longest accepted group name after trimming. */
export const MAX_NAME_LENGTH = 200;

/** Shape of a valid member key: `workspace:<id>` or `session:<id>`. */
const MEMBER_KEY_PATTERN = /^(workspace|session):(.+)$/;

/** Loose id sanity: non-empty string without control characters. */
function isId(value) {
  return typeof value === 'string' && value.length > 0 && value.length <= 256 && !/[\u0000-\u001f\u007f]/.test(value);
}

/** Normalize a group name: trim, collapse inner whitespace runs, enforce length. */
export function normalizeName(name) {
  if (typeof name !== 'string') return undefined;
  const normalized = name.trim().replace(/\s+/g, ' ');
  if (normalized.length === 0 || normalized.length > MAX_NAME_LENGTH) return undefined;
  return normalized;
}

/** Parse a member key into its parts, or undefined when malformed. */
export function parseMemberKey(key) {
  if (typeof key !== 'string') return undefined;
  const match = MEMBER_KEY_PATTERN.exec(key);
  if (match === null || !isId(match[2])) return undefined;
  return { kind: match[1], id: match[2] };
}

/** Build a member key for one workspace or session id. */
export function memberKey(kind, id) {
  return `${kind}:${id}`;
}

/** Empty document in the current schema version. */
export function emptyState() {
  return { version: SCHEMA_VERSION, rev: 0, groups: {}, membership: {} };
}

/** Coerce raw persisted JSON into a document, tolerating legacy junk. */
export function coerceState(raw) {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return emptyState();
  if (raw.version !== SCHEMA_VERSION) return emptyState();
  const state = emptyState();
  state.rev = typeof raw.rev === 'number' && Number.isSafeInteger(raw.rev) && raw.rev >= 0 ? raw.rev : 0;
  if (raw.groups !== null && typeof raw.groups === 'object' && !Array.isArray(raw.groups)) {
    for (const [id, group] of Object.entries(raw.groups)) {
      if (!isId(id) || group === null || typeof group !== 'object') continue;
      const kind = group.kind;
      const name = normalizeName(group.name);
      if (!GROUP_KINDS.includes(kind) || name === undefined) continue;
      const parent = group.parent === undefined || group.parent === null ? null : group.parent;
      const scope = typeof group.scope === 'string' ? group.scope : '';
      if (parent !== null && !isId(parent)) continue;
      state.groups[id] = { id, name, kind, parent, scope: kind === 'workspace' ? '' : scope };
    }
    // A hand-edited file may reference a parent that is gone; such a group returns to the root.
    for (const group of Object.values(state.groups)) {
      if (group.parent !== null && state.groups[group.parent] === undefined) state.groups[group.id] = { ...group, parent: null };
    }
  }
  if (raw.membership !== null && typeof raw.membership === 'object' && !Array.isArray(raw.membership)) {
    for (const [key, group] of Object.entries(raw.membership)) {
      if (parseMemberKey(key) === undefined) continue;
      if (!isId(group) || state.groups[group] === undefined) continue;
      state.membership[key] = group;
    }
  }
  return state;
}

/** Validation failure carrying a stable machine-readable reason. */
export class OpError extends Error {
  /**
   * @param reason - stable code, e.g. `unknown-op`, `cycle`, `domain-mismatch`.
   * @param message - human-readable diagnostic (developer-facing).
   */
  constructor(reason, message) {
    super(message);
    this.name = 'OpError';
    this.reason = reason;
  }
}

/** Whether the group chain starting at `groupId` reaches `ancestorId`. */
function reaches(state, groupId, ancestorId) {
  let cursor = groupId;
  const seen = new Set();
  while (cursor !== null && !seen.has(cursor)) {
    if (cursor === ancestorId) return true;
    seen.add(cursor);
    const group = state.groups[cursor];
    cursor = group === undefined ? null : group.parent;
  }
  return false;
}

/** Validate one op against the state; returns the op unchanged when valid. */
export function validateOp(state, op) {
  if (op === null || typeof op !== 'object' || Array.isArray(op)) throw new OpError('bad-op', 'операция должна быть объектом');
  const known = ['group.create', 'group.rename', 'group.delete', 'group.move', 'member.assign', 'member.unassign'];
  if (!known.includes(op.op)) throw new OpError('unknown-op', `неизвестная операция: ${String(op.op)}`);
  const unknownKeys = Object.keys(op).filter((key) => key !== 'op' && !opFields(op.op).includes(key));
  if (unknownKeys.length > 0) throw new OpError('unknown-field', `лишние поля у ${op.op}: ${unknownKeys.join(', ')}`);
  const missing = requiredFields(op.op).filter((field) => op[field] === undefined);
  if (missing.length > 0) throw new OpError('missing-field', `${op.op}: нет поля ${missing.join(', ')}`);

  switch (op.op) {
    case 'group.create': {
      const kind = op.kind;
      if (!GROUP_KINDS.includes(kind)) throw new OpError('bad-kind', `kind должен быть ${GROUP_KINDS.join('|')}`);
      const name = normalizeName(op.name);
      if (name === undefined) throw new OpError('bad-name', 'имя группы пустое или длиннее 200 символов');
      const scope = op.scope === undefined ? (kind === 'workspace' ? '' : undefined) : op.scope;
      if (kind === 'workspace') {
        if (scope !== '') throw new OpError('bad-scope', 'группа воркспейсов всегда имеет scope ""');
      } else if (scope !== undefined && typeof scope !== 'string') {
        throw new OpError('bad-scope', 'scope должен быть строкой');
      }
      const parent = op.parent ?? null;
      if (parent !== null) {
        if (!isId(parent) || state.groups[parent] === undefined) throw new OpError('no-parent', `родительская группа ${String(parent)} не существует`);
        const parentGroup = state.groups[parent];
        if (parentGroup.kind !== kind) throw new OpError('domain-mismatch', 'подгруппа должна быть того же вида, что и родитель');
        if (kind === 'session' && (scope ?? parentScopeOf(state, parent)) !== parentGroup.scope) throw new OpError('domain-mismatch', 'подгруппа сессий должна наследовать scope родителя');
      }
      if (op.id !== undefined && (!isId(op.id) || state.groups[op.id] !== undefined)) throw new OpError('bad-id', 'id группы отсутствует или уже занят');
      const id = op.id ?? randomId();
      return { op: 'group.create', id, name, kind, parent, scope: kind === 'workspace' ? '' : (scope ?? parentScopeOf(state, parent)) };
    }
    case 'group.rename': {
      if (!isId(op.id) || state.groups[op.id] === undefined) throw new OpError('no-group', `группа ${String(op.id)} не существует`);
      const name = normalizeName(op.name);
      if (name === undefined) throw new OpError('bad-name', 'имя группы пустое или длиннее 200 символов');
      return { op: 'group.rename', id: op.id, name };
    }
    case 'group.delete': {
      if (!isId(op.id) || state.groups[op.id] === undefined) throw new OpError('no-group', `группа ${String(op.id)} не существует`);
      return { op: 'group.delete', id: op.id };
    }
    case 'group.move': {
      if (!isId(op.id) || state.groups[op.id] === undefined) throw new OpError('no-group', `группа ${String(op.id)} не существует`);
      const parent = op.parent ?? null;
      if (parent === op.id) throw new OpError('cycle', 'группа не может быть родителем самой себя');
      if (parent !== null) {
        if (!isId(parent) || state.groups[parent] === undefined) throw new OpError('no-parent', `родительская группа ${String(parent)} не существует`);
        const group = state.groups[op.id];
        const parentGroup = state.groups[parent];
        if (parentGroup.kind !== group.kind) throw new OpError('domain-mismatch', 'подгруппа должна быть того же вида, что и родитель');
        if (group.kind === 'session' && group.scope !== parentGroup.scope) throw new OpError('domain-mismatch', 'подгруппа сессий должна оставаться в scope своего воркспейса');
        if (reaches(state, parent, op.id)) throw new OpError('cycle', 'перенос создал бы цикл вложенности');
      }
      return { op: 'group.move', id: op.id, parent };
    }
    case 'member.assign': {
      const member = parseMemberKey(op.key);
      if (member === undefined) throw new OpError('bad-key', `ключ члена должен быть workspace:<id> или session:<id>`);
      if (!isId(op.group) || state.groups[op.group] === undefined) throw new OpError('no-group', `группа ${String(op.group)} не существует`);
      const group = state.groups[op.group];
      if (group.kind === 'workspace') {
        if (member.kind !== 'workspace') throw new OpError('domain-mismatch', 'в группу воркспейсов входят только воркспейсы');
        if (group.scope !== '') throw new OpError('domain-mismatch', 'группа воркспейсов всегда имеет scope ""');
      } else if (member.kind !== 'session') {
        throw new OpError('domain-mismatch', 'в группу сессий входят только сессии');
      }
      return { op: 'member.assign', key: op.key, group: op.group };
    }
    case 'member.unassign': {
      const member = parseMemberKey(op.key);
      if (member === undefined) throw new OpError('bad-key', `ключ члена должен быть workspace:<id> или session:<id>`);
      return { op: 'member.unassign', key: op.key };
    }
    default:
      throw new OpError('unknown-op', `неизвестная операция: ${String(op.op)}`);
  }
}

function parentScopeOf(state, parent) {
  if (parent === null) return '';
  const group = state.groups[parent];
  return group === undefined ? '' : group.scope;
}

/** Field roster per op: everything accepted beyond `op`. */
function opFields(op) {
  switch (op) {
    case 'group.create':
      return ['id', 'name', 'kind', 'parent', 'scope'];
    case 'group.rename':
    case 'group.delete':
    case 'group.move':
      return ['id', ...(op === 'group.rename' ? ['name'] : []), ...(op === 'group.move' ? ['parent'] : [])];
    case 'member.assign':
      return ['key', 'group'];
    case 'member.unassign':
      return ['key'];
    default:
      return [];
  }
}

function requiredFields(op) {
  switch (op) {
    case 'group.create':
      return ['name', 'kind'];
    case 'group.rename':
      return ['id', 'name'];
    case 'group.delete':
    case 'group.move':
      return ['id'];
    case 'member.assign':
      return ['key', 'group'];
    case 'member.unassign':
      return ['key'];
    default:
      return [];
  }
}

/** Random group id (RFC 4122 v4) when the client did not mint one. */
function randomId() {
  return globalThis.crypto?.randomUUID?.() ?? `g-${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`;
}

/**
 * Apply ops in order, validating each against the evolving state, so a batch
 * may create a group and assign members to it. Either all ops are applied or
 * the first invalid one aborts with {@link OpError} — the input document is
 * never mutated, so the caller can answer 400 without a partial write.
 * @param state - document to apply onto (not mutated).
 * @param ops - op list.
 * @returns the next document with `rev` incremented once.
 */
export function applyOps(state, ops) {
  if (!Array.isArray(ops)) throw new OpError('bad-ops', 'ops должен быть массивом');
  let next = { version: SCHEMA_VERSION, rev: state.rev + 1, groups: { ...state.groups }, membership: { ...state.membership } };
  for (const raw of ops) {
    const op = validateOp(next, raw);
    next = applyOne(next, op);
  }
  return next;
}

function applyOne(state, op) {
  switch (op.op) {
    case 'group.create':
      return { ...state, groups: { ...state.groups, [op.id]: { id: op.id, name: op.name, kind: op.kind, parent: op.parent, scope: op.scope } } };
    case 'group.rename': {
      const group = state.groups[op.id];
      return { ...state, groups: { ...state.groups, [op.id]: { ...group, name: op.name } } };
    }
    case 'group.delete': {
      const groups = { ...state.groups };
      const membership = { ...state.membership };
      const doomed = state.groups[op.id];
      // Subgroups lift to the deleted group's parent; members return to ungrouped.
      for (const [id, group] of Object.entries(state.groups)) {
        if (group.parent === op.id) groups[id] = { ...group, parent: doomed.parent };
      }
      delete groups[op.id];
      for (const [key, group] of Object.entries(state.membership)) {
        if (group === op.id) delete membership[key];
      }
      return { ...state, groups, membership };
    }
    case 'group.move': {
      const group = state.groups[op.id];
      return { ...state, groups: { ...state.groups, [op.id]: { ...group, parent: op.parent } } };
    }
    case 'member.assign':
      return { ...state, membership: { ...state.membership, [op.key]: op.group } };
    case 'member.unassign': {
      const membership = { ...state.membership };
      delete membership[op.key];
      return { ...state, membership };
    }
    default:
      return state;
  }
}

/**
 * Membership references that no longer resolve: the group is gone, or the
 * workspace/session behind the key is gone from the live projections.
 * @param state - current document.
 * @param liveWorkspaceIds - workspace ids currently registered on the Host.
 * @param liveSessionIds - session ids currently listed by the Host.
 * @returns member keys safe to unassign, plus group ids that became empty husks.
 */
export function orphans(state, liveWorkspaceIds, liveSessionIds) {
  const workspaces = new Set(liveWorkspaceIds);
  const sessions = new Set(liveSessionIds);
  const staleKeys = [];
  const staleGroups = new Set();
  for (const [key, group] of Object.entries(state.membership)) {
    const member = parseMemberKey(key);
    if (member === undefined) {
      staleKeys.push(key);
      continue;
    }
    const alive = member.kind === 'workspace' ? workspaces.has(member.id) : sessions.has(member.id);
    if (state.groups[group] === undefined || !alive) {
      staleKeys.push(key);
      if (state.groups[group] !== undefined) staleGroups.add(group);
    }
  }
  // Groups nobody can reach anymore: no members, no children, not root-reachable matters
  // only through membership, so a parentless empty group still renders by design and is
  // NOT an orphan — only groups stranded by a missing member are reported for cleanup.
  return { staleKeys, staleGroups: [...staleGroups] };
}

/**
 * Ops that clean every stale reference: unassign stale member keys, then
 * delete stale groups that are left without any member or child.
 * @param state - current document.
 * @param liveWorkspaceIds - workspace ids currently registered on the Host.
 * @param liveSessionIds - session ids currently listed by the Host.
 */
export function cleanupOps(state, liveWorkspaceIds, liveSessionIds) {
  const { staleKeys, staleGroups } = orphans(state, liveWorkspaceIds, liveSessionIds);
  const ops = staleKeys.map((key) => ({ op: 'member.unassign', key }));
  const membership = { ...state.membership };
  for (const key of staleKeys) delete membership[key];
  const keepGroup = (id) => Object.values(membership).includes(id);
  const hasChild = (id) => Object.values(state.groups).some((group) => group.parent === id && id !== group.id);
  for (const id of staleGroups) {
    if (!keepGroup(id) && !hasChild(id)) ops.push({ op: 'group.delete', id });
  }
  return ops;
}
