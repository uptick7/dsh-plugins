English | [Русский](README.ru.md)

# Sidebar groups (`@uptick7/dsh-sidebar-groups`)

User-defined UI groups for the dsh web sidebar: **folders for workspaces** (working directories) and **folders for the sessions inside each workspace**. Purely a display layer — sessions and workspaces are never renamed or moved on disk, and group membership is keyed by stable Host ids (`workspaceId`, `sessionId`), so renaming a session title or a workspace display name never breaks the tree.

## Install

Published on npm as [`@uptick7/dsh-sidebar-groups`](https://www.npmjs.com/package/@uptick7/dsh-sidebar-groups); it declares `engines.dsh: ">=0.2.1-rc.1 <0.3.0-0"`.

Install into a profile (replace `web` with your profile name), then restart the host:

```sh
dsh plugin --profile web add -w @uptick7/dsh-sidebar-groups
```

Or install from the web GUI: **Plugins** (Plugin Manager) → search for `@uptick7/dsh-sidebar-groups` → install.

From this repository without npm: clone it and add both the dependency and the bundle name to the profile's `package.json`:

```json
{
  "dependencies": {
    "@uptick7/dsh-sidebar-groups": "link:/path/to/dsh-plugins/sidebar-groups"
  },
  "dsh": {
    "profile": {
      "bundles": [
        "@uptick7/dsh-sidebar-groups"
      ]
    }
  }
}
```

## What it does

The plugin replaces the shipped Workspaces panel with a grouping-aware tree:

```
▾ Clients              (workspace group; icon: several folders)
  ▾ Acme site          (workspace; icon: one folder, as shipped)
      ▾ Bugs           (session group; icon: several messages)
          fix login    (session, as shipped — no icon)
          …
      refactor css     (session outside groups)
  ▸ Internal tools     (workspace)
▸ Archive              (workspace group)
```

- **Nesting** is allowed in both domains (context menu → *Create subgroup*), but nothing nests it for you: the tree is exactly as deep as you make it. Indentation is 12 px per level.
- **Icons**: a workspace group shows several folders, a workspace keeps the shipped single-folder look, a session group shows several messages, sessions keep their current icon-free rows. Status dots (running / waiting for approval / unviewed completion), relative time and the pin marker stay on session rows.
- **Drag-and-drop**: a session onto a session group (same workspace only — sessions cannot leave their workspace), a workspace onto a workspace group, a group onto another group (re-parenting; cycles are rejected). Dropping on the strip at the bottom removes the item from its group; dropping a workspace onto another workspace row reorders them in the Host registry order and moves it into the target's group when it differs. Invalid targets show a not-allowed cursor.
- **Context menus**:
  - group rows (right-click or `…`): *Create subgroup*, *Rename*, *Move into group ▸*, *Delete group* (subgroups rise to the deleted group's level, members become ungrouped; sessions and workspaces are not affected);
  - session rows: the shipped session menu still works (pin, rename, fork, copy id, archive — its dialogs are frame overlays and survive the replacement), plus a *Group ▸* submenu (assign / remove / new group);
  - workspace rows: a custom popup renders the shared menu contributions — including "open in app" from other plugins — and supplies its own *Rename* / *Delete* (the shipped entries for those two would write into the replaced panel's private dialog state, so they are filtered out and re-implemented here on the public API, with confirmation dialogs).
- **Header**: search (instant metadata matches plus the debounced host content search), view options (ordering by last updated / by name; archived sessions hidden / shown / only), new workspace group, add workspace (the same host directory picker the shipped panel uses, called through `uiWorkspace.pickDirectory()`).
- The Ungrouped bucket ("No workspace") behaves as one more container and can hold its own session groups.
- The provisional blank **New Session** keeps the first slot of its workspace and cannot be dragged.
- **Settings → Session groups**:
  - *Grouped sidebar* switch — unregisters this browser and brings the shipped panel back instantly, without uninstalling the plugin;
  - group/link counters, the storage file path;
  - *Clean stale links* — unassigns memberships that point to deleted workspaces/sessions (deleted registrations leave their groups in place; re-adding a workspace gets a new id, so old links need this cleanup).

## Storage

Groups live in one JSON file on the Host (default `~/.dsh/sidebar-groups.json`, override with the `stateFile` config key):

```json
{
  "version": 1,
  "rev": 4,
  "groups": {
    "0f1e…": { "id": "0f1e…", "name": "Clients", "kind": "workspace", "parent": null, "scope": "" },
    "9a2b…": { "id": "9a2b…", "name": "Bugs", "kind": "session", "parent": null, "scope": "<workspaceId>" }
  },
  "membership": {
    "workspace:<workspaceId>": "0f1e…",
    "session:<sessionId>": "9a2b…"
  }
}
```

A `workspace` group always has `scope: ""`; a `session` group carries the workspace id (or `""` for the Ungrouped bucket) whose sessions it may hold. All mutations go through `POST /sidebar-groups/apply` as validated all-or-nothing op batches — the Host is the single authority, and every response returns the authoritative document, so several open tabs converge. Expansion, ordering mode and the archived filter are browser-local (as in the shipped panel); session ordering inside containers is pinned-first, then last updated.

The file never touches session titles, workspace titles, or directories: deleting the file or the plugin restores the stock sidebar with zero side effects.

## Config (cordis.patch.yml)

```yaml
- insert:
    - id: sidebar-groups
      name: '@uptick7/dsh-sidebar-groups'
      config:
        stateFile: '~/.dsh/sidebar-groups.json' # group document storage
```

## How it hooks in

- Registers a component into the `sidebar.workspaces` single slot (declared by the sidebar shell, filled by the shipped `ui-workspace` browser) at priority `-1`; the lowest priority renders. The shipped browser entry stays registered and keeps declaring its child seats, so other occupants (the schedule clock) keep working, and the plugin declares no seats of its own — the registry rejects duplicate declarations. `renderSlot` is scoped to an entry's own children, so a shadowing entry cannot render the shipped directory-flow seat; the add-workspace button calls the public `uiWorkspace.pickDirectory()` RPC instead.
- Everything else is public API: `ctx.sessions`, `ctx.workspaces`, `ctx.uiWorkspace`, `ctx.uiSession`, `ctx.remoteAccess`, `ctx.contextMenus`, `ctx.locale`, `shell.overlay`, `settings.section`.

## Limitations

- The shipped panel's per-workspace "show more" watermarks and hover cards are not reproduced; grouped lists show all sessions of an expanded container.
- Archiving a session with running work surfaces the Host refusal as a toast; the shipped stop-and-archive confirmation belongs to the replaced panel. Use the shipped view (switch it in Settings) for that flow.
- The workspace context menu is re-rendered by the plugin while the grouped view is active; plugin contributions that rely on the shared popup still appear, but the two shipped entries whose dialogs died with the replaced panel are filtered out (they are re-implemented on top of the public API).
- Manual session ordering (drag to a specific position) is not persisted; ordering is pins + recency/name. DnD is for group membership, not ordering.

## Development

```sh
cd sidebar-groups
npm test        # node --test; host model and routes are covered
npm run check   # syntax check
node dev-activation-harness.js  # materialize client.js with stubs and run apply() to debug boot failures
```

`groups-ops.js` is the pure op model (validation, application, orphan detection) shared by the Host half and the tests; `client.js` imports only React and the shipped client UI primitives (declared in `dsh.client.inject`), so icons, the status dot, and switches are the harness's own components.
