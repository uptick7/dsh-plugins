/**
 * Client half of the sidebar groups bundle.
 *
 * Replaces the shipped Workspaces browser (`sidebar.workspaces` single slot,
 * filled by @deepseek-ai/dsh-client-ui-workspace) with a grouping-aware tree:
 *
 *   workspace groups (nested folders)
 *     └ workspaces (working directories, untouched on the Host)
 *         └ session groups (nested, scoped to one workspace)
 *             └ sessions
 *
 * Membership references stable Host ids (`workspaceId`, `sessionId`), so
 * renaming a session title or a workspace display name never breaks the
 * tree; nothing is renamed or moved physically. The group document lives on
 * the Host (the bundle's own routes) and is shared by every browser.
 *
 * Shipped browser facilities are re-used through public services: session
 * and workspace projections (`ctx.sessions`, `ctx.workspaces`), the unified
 * UI status (`ctx.uiSession`), navigation (`ctx.uiWorkspace`), the shared
 * session context menu (`ctx.contextMenus`, target `session` — its rename,
 * fork, pin, archive dialogs are overlay entries that survive the shadowing),
 * the directory-picking hole, and the row seats (the trailing seat keeps the
 * group mark visible while the shipped browser is active). Workspace
 * rename/delete of the shipped menu would write into the shadowed browser's
 * private dialog state, so workspace rows open a custom popup that renders
 * `ctx.contextMenus.resolve(target)` views without those two contributions
 * and supplies its own rename/delete dialogs on the public workspace API.
 *
 * A Settings → Session groups page carries the "grouped sidebar" switch that
 * unregisters this browser and brings the shipped one back, plus stale-link
 * cleanup for deleted workspaces and sessions.
 *
 * Deliberately imports nothing but React: the plugin is self-contained, per
 * the repo convention of not reaching into harness client packages from
 * plugin code.
 */
window.__ModuleLoader__.load({
  id: '@uptick7/dsh-sidebar-groups',
  factory(require) {
    const React = require('react');
    const h = React.createElement;
    const { useState, useEffect, useMemo, useRef, useCallback, useSyncExternalStore } = React;

    const NS = 'sidebarGroups';
    const ROUTE_STATE = '/sidebar-groups/state';
    const ROUTE_APPLY = '/sidebar-groups/apply';
    /** Browser-local view state: expansions, filters, ordering. */
    const VIEW_KEY = 'dsh.sbg.view.v1';
    /** Grouped-vs-shipped browser switch, browser-local by design. */
    const ENABLED_KEY = 'dsh.sbg.enabled';
    /** Pixels of indentation per tree level; the sidebar is narrow, keep titles readable. */
    const INDENT_PX = 12;

    //#region locale
    const DICTIONARIES = {
      en: {
        'settings.nav': 'Session groups',
        'settings.enabled': 'Grouped sidebar',
        'settings.enabled.hint':
          'Replaces the Workspaces panel with a grouped tree: workspace groups, workspaces, session groups, sessions. Sessions and workspaces are never renamed or moved — groups are a display layer keyed by their stable ids.',
        'settings.stateFile': 'Storage',
        'settings.stats': '{groups} group(s), {links} linked item(s)',
        'settings.cleanup': 'Clean stale links',
        'settings.cleanup.none': 'No stale links',
        'settings.cleanup.done': 'Removed {count} stale link(s)',
        'settings.error.prefix': 'Failed to load groups: ',
        'settings.retry': 'Retry',
        'header.title': 'Sessions',
        'header.search': 'Search sessions',
        'header.search.placeholder': 'Search…',
        'header.addGroup': 'New workspace group',
        'header.addWorkspace': 'Add workspace',
        'header.view': 'View options',
        'view.order.updated': 'Last updated',
        'view.order.name': 'By name',
        'view.archived.hide': 'Hide archived',
        'view.archived.show': 'Show archived',
        'view.archived.only': 'Archived only',
        'group.ungrouped': 'No workspace',
        'group.newSession': 'New session',
        'session.untitled': 'Untitled',
        'session.archived': 'Archived',
        'session.pinned': 'Pinned',
        'status.approval': 'Waiting for approval',
        'status.plan-review': 'Plan awaiting review',
        'status.question': 'Waiting for answer',
        'status.running': 'Running',
        'status.done': 'Finished',
        'time.now': 'now',
        'time.m': '{n} m',
        'time.h': '{n} h',
        'time.d': '{n} d',
        'menu.group.submenu': 'Group',
        'menu.group.remove': 'Remove from group',
        'menu.group.new': 'New group…',
        'menu.group.createChild': 'Create subgroup',
        'menu.rename': 'Rename',
        'menu.delete': 'Delete',
        'menu.moveInto': 'Move into “{name}”',
        'dialog.name.create': 'New group',
        'dialog.name.rename': 'Rename group',
        'dialog.name.placeholder': 'Group name',
        'dialog.confirm': 'Save',
        'dialog.cancel': 'Cancel',
        'dialog.groupDelete.title': 'Delete group “{name}”?',
        'dialog.groupDelete.text':
          'Subgroups rise to the deleted group’s level, its members become ungrouped. Sessions and workspaces are not affected.',
        'dialog.workspaceRename.title': 'Rename workspace',
        'dialog.workspaceDelete.title': 'Delete workspace “{name}”?',
        'dialog.workspaceDelete.text': 'Only the sidebar registration is deleted; sessions and files remain.',
        'dialog.workspace.name': 'Workspace name',
        'toast.groupsError': 'Failed to save groups',
        'toast.workspaceError': 'Workspace operation failed',
        'toast.archived': 'An archived session cannot be opened',
        'toast.copied': 'Copied',
        'empty.title': 'No sessions yet',
        'empty.add': 'Add a workspace to begin',
        'search.empty': 'Nothing found',
        'drop.ungroup': 'Drop here to remove from group',
        'aria.tree': 'Sessions and workspaces',
        'aria.more': 'More actions',
        'aria.expand': 'Expand or collapse',
      },
      ru: {
        'settings.nav': 'Группы сессий',
        'settings.enabled': 'Группированная боковая панель',
        'settings.enabled.hint':
          'Заменяет панель Workspaces группированным деревом: группы воркспейсов, воркспейсы, группы сессий, сессии. Сессии и воркспейсы не переименовываются и не переносятся — группы это слой отображения, привязанный к их стабильным идентификаторам.',
        'settings.stateFile': 'Хранилище',
        'settings.stats': 'Групп: {groups}, связей: {links}',
        'settings.cleanup': 'Убрать устаревшие ссылки',
        'settings.cleanup.none': 'Устаревших ссылок нет',
        'settings.cleanup.done': 'Удалено устаревших ссылок: {count}',
        'settings.error.prefix': 'Не удалось загрузить группы: ',
        'settings.retry': 'Повторить',
        'header.title': 'Сессии',
        'header.search': 'Поиск сессий',
        'header.search.placeholder': 'Поиск…',
        'header.addGroup': 'Новая группа проектов',
        'header.addWorkspace': 'Добавить воркспейс',
        'header.view': 'Настройки вида',
        'view.order.updated': 'По обновлению',
        'view.order.name': 'По имени',
        'view.archived.hide': 'Скрывать архивные',
        'view.archived.show': 'Показывать архивные',
        'view.archived.only': 'Только архивные',
        'group.ungrouped': 'Без воркспейса',
        'group.newSession': 'Новая сессия',
        'session.untitled': 'Без названия',
        'session.archived': 'Архив',
        'session.pinned': 'Закреплено',
        'status.approval': 'Ожидает подтверждения',
        'status.plan-review': 'План ждёт проверки',
        'status.question': 'Ожидает ответа',
        'status.running': 'Выполняется',
        'status.done': 'Завершено',
        'time.now': 'только что',
        'time.m': '{n} мин',
        'time.h': '{n} ч',
        'time.d': '{n} д',
        'menu.group.submenu': 'Группа',
        'menu.group.remove': 'Убрать из группы',
        'menu.group.new': 'Новая группа…',
        'menu.group.createChild': 'Создать подгруппу',
        'menu.rename': 'Переименовать',
        'menu.delete': 'Удалить',
        'menu.moveInto': 'Переместить в «{name}»',
        'dialog.name.create': 'Новая группа',
        'dialog.name.rename': 'Переименовать группу',
        'dialog.name.placeholder': 'Название группы',
        'dialog.confirm': 'Сохранить',
        'dialog.cancel': 'Отмена',
        'dialog.groupDelete.title': 'Удалить группу «{name}»?',
        'dialog.groupDelete.text':
          'Подгруппы поднимутся на уровень удаляемой группы, её элементы станут негруппированными. Сессии и воркспейсы не пострадают.',
        'dialog.workspaceRename.title': 'Переименовать воркспейс',
        'dialog.workspaceDelete.title': 'Удалить воркспейс «{name}»?',
        'dialog.workspaceDelete.text': 'Удаляется только регистрация в панели; сессии и файлы останутся.',
        'dialog.workspace.name': 'Название воркспейса',
        'toast.groupsError': 'Не удалось сохранить группы',
        'toast.workspaceError': 'Не удалось выполнить операцию с воркспейсом',
        'toast.archived': 'Архивную сессию нельзя открыть',
        'toast.copied': 'Скопировано',
        'empty.title': 'Сессий пока нет',
        'empty.add': 'Добавьте воркспейс, чтобы начать',
        'search.empty': 'Ничего не найдено',
        'drop.ungroup': 'Отпустите здесь, чтобы убрать из группы',
        'aria.tree': 'Сессии и воркспейсы',
        'aria.more': 'Ещё действия',
        'aria.expand': 'Развернуть или свернуть',
      },
    };
    //#endregion

    //#region tiny observable store
    /** Minimal snapshot store (getSnapshot/subscribe/set) for module-level UI state. */
    function createStore(initial) {
      let value = initial;
      const listeners = new Set();
      return {
        getSnapshot: () => value,
        subscribe(listener) {
          listeners.add(listener);
          return () => listeners.delete(listener);
        },
        set(next) {
          value = next;
          for (const listener of [...listeners]) listener();
        },
      };
    }

    const useStore = (store) => useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot);
    //#endregion

    //#region icons
    /** All glyphs are plain stroke SVGs in the 20-grid, matching the sidebar row size. */
    function svgIcon(paths, extra) {
      return function Icon(props) {
        const size = props?.size ?? 16;
        return h(
          'svg',
          {
            viewBox: '0 0 20 20',
            width: size,
            height: size,
            fill: 'none',
            'aria-hidden': true,
            style: { flex: 'none', display: 'block', ...(props?.style ?? {}) },
          },
          paths,
        );
      };
    }

    const stroke = { stroke: 'currentColor', 'stroke-width': 1.3, 'stroke-linecap': 'round', 'stroke-linejoin': 'round' };

    /** Workspace folder, closed — mirrors the shipped workspace glyph. */
    const IconFolder = svgIcon([
      h('path', { d: 'M3.5 6.2c0-1.1.9-2 2-2h3.1l1.8 1.9h4.1c1.1 0 2 .9 2 2v7.2c0 1.1-.9 2-2 2h-9c-1.1 0-2-.9-2-2z', ...stroke }),
    ]);
    /** Workspace folder, open. */
    const IconFolderOpen = svgIcon([
      h('path', { d: 'M3.5 6.2c0-1.1.9-2 2-2h3.1l1.8 1.9h4.1c1.1 0 2 .9 2 2v1.2', ...stroke }),
      h('path', { d: 'M2.6 10.2h13.2l-1.3 5.4c-.2.9-1 1.5-1.9 1.5H5.8c-.9 0-1.7-.6-1.9-1.5z', ...stroke }),
    ]);
    /** A workspace group: several folders. */
    const IconFolders = svgIcon([
      h('path', { d: 'M7.1 4.2h2.6l1.5 1.6h3.3c.9 0 1.6.7 1.6 1.6v.7', ...stroke, opacity: 0.55 }),
      h('path', { d: 'M3.2 7.1c0-.9.7-1.6 1.6-1.6h2.6l1.5 1.6h3.6c.9 0 1.6.7 1.6 1.6v6.2c0 .9-.7 1.6-1.6 1.6H4.8c-.9 0-1.6-.7-1.6-1.6z', ...stroke }),
    ]);
    /** A session group: several messages. */
    const IconMessages = svgIcon([
      h('path', { d: 'M6.7 4.5h7.6c.9 0 1.6.7 1.6 1.6v5.1c0 .9-.7 1.6-1.6 1.6h-.5v2.3l-2.6-2.3H8.5', ...stroke, opacity: 0.55 }),
      h('path', { d: 'M3.4 6.6c0-.9.7-1.6 1.6-1.6h5.5c.9 0 1.6.7 1.6 1.6v4.3c0 .9-.7 1.6-1.6 1.6H6.5l-2.5 2.2v-2.2h-.2c-.9 0-1.6-.7-1.6-1.6z', ...stroke }),
    ]);
    /** Collapse chevron for expandable rows. */
    const IconChevron = svgIcon([h('path', { d: 'M8 5.5L12.5 10 8 14.5', ...stroke })]);
    const IconEllipsis = svgIcon([
      h('circle', { cx: '4.6', cy: '10', r: '1.3', fill: 'currentColor' }),
      h('circle', { cx: '10', cy: '10', r: '1.3', fill: 'currentColor' }),
      h('circle', { cx: '15.4', cy: '10', r: '1.3', fill: 'currentColor' }),
    ]);
    const IconPin = svgIcon([h('path', { d: 'M7 3.5h6l-.7 4.2 2.6 2.6v1.2H5.1v-1.2l2.6-2.6z', ...stroke }), h('path', { d: 'M10 11.5v5', ...stroke })]);
    const IconPinFilled = svgIcon([
      h('path', { d: 'M7 3.5h6l-.7 4.2 2.6 2.6v1.2H5.1v-1.2l2.6-2.6z', fill: 'currentColor', stroke: 'currentColor', 'stroke-width': 1.3, 'stroke-linejoin': 'round' }),
      h('path', { d: 'M10 11.5v5', ...stroke }),
    ]);
    const IconArchive = svgIcon([
      h('path', { d: 'M3.5 5h13v3h-13z', ...stroke }),
      h('path', { d: 'M4.8 8v8.2c0 .7.6 1.3 1.3 1.3h7.8c.7 0 1.3-.6 1.3-1.3V8', ...stroke }),
      h('path', { d: 'M8 11h4', ...stroke }),
    ]);
    const IconNewChat = svgIcon([
      h('path', { d: 'M4 6.4c0-1.3 1-2.3 2.3-2.3h7.4c1.3 0 2.3 1 2.3 2.3v5c0 1.3-1 2.3-2.3 2.3H9l-3.4 3v-3H6.3C5 13.7 4 12.7 4 11.4z', ...stroke }),
    ]);
    const IconSearch = svgIcon([h('circle', { cx: '9', cy: '9', r: '4.6', ...stroke }), h('path', { d: 'M12.5 12.5l4 4', ...stroke })]);
    const IconPlus = svgIcon([h('path', { d: 'M10 4.5v11M4.5 10h11', ...stroke })]);
    const IconSliders = svgIcon([h('path', { d: 'M4 6.5h8M14.8 6.5h1.2M4 13.5h1.2M8 13.5h8', ...stroke }), h('circle', { cx: '13.4', cy: '6.5', r: '1.4', ...stroke }), h('circle', { cx: '6.6', cy: '13.5', r: '1.4', ...stroke })]);
    const IconEdit = svgIcon([h('path', { d: 'M4 16h.9l9.4-9.4-1.9-1.9L3 14.1z', ...stroke }), h('path', { d: 'M11.4 4.7l1.9-1.9 1.9 1.9-1.9 1.9z', ...stroke })]);
    const IconTrash = svgIcon([
      h('path', { d: 'M4.5 6h11', ...stroke }),
      h('path', { d: 'M8 6V4.6c0-.6.5-1.1 1.1-1.1h1.8c.6 0 1.1.5 1.1 1.1V6', ...stroke }),
      h('path', { d: 'M6 6l.7 9.6c0 .7.6 1.3 1.3 1.3h4c.7 0 1.3-.6 1.3-1.3L14 6', ...stroke }),
    ]);
    //#endregion

    //#region styles
    const STYLE_ID = 'dsh-sidebar-groups-style';
    const CSS = `
.sbg-root{display:flex;flex-direction:column;min-height:0;height:100%;color:var(--dsw-alias-label-primary);font-size:13px;line-height:18px;--sbg-indent:${INDENT_PX}px}
.sbg-header{display:flex;align-items:center;gap:2px;padding:8px 10px 6px;flex:none}
.sbg-title{font-size:13px;font-weight:600;flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.sbg-hbtn{position:relative;flex:none;width:26px;height:26px;border:0;border-radius:var(--dsw-radius-sm);background:transparent;color:var(--dsw-alias-label-secondary);cursor:pointer;display:inline-flex;align-items:center;justify-content:center;padding:0}
.sbg-hbtn:hover{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}
.sbg-hbtn:focus-visible{outline:1.5px solid var(--dsw-focus-ring-color,var(--dsw-alias-state-business-primary));outline-offset:1px}
.sbg-searchline{display:flex;align-items:center;gap:6px;padding:0 10px 6px;flex:none}
.sbg-searchline input{flex:1;min-width:0;height:26px;border:1px solid var(--dsw-alias-border-l2);border-radius:var(--dsw-radius-sm);background:var(--dsw-alias-bg-layer-1,var(--dsw-alias-bg-base));color:inherit;font:inherit;font-size:12px;padding:0 8px;outline:none}
.sbg-searchline input:focus-visible{outline:none;border-color:var(--dsw-alias-state-business-primary)}
.sbg-banner{margin:0 10px 6px;border:1px solid var(--dsw-alias-border-l2);border-radius:var(--dsw-radius-sm);padding:6px 8px;color:var(--dsw-alias-state-error-primary);font-size:12px;display:flex;gap:8px;align-items:center;flex:none}
.sbg-banner button{border:1px solid var(--dsw-alias-border-l2);background:transparent;color:inherit;border-radius:var(--dsw-radius-sm);cursor:pointer;font:inherit;font-size:11px;padding:2px 8px}
.sbg-list{flex:1;min-height:0;overflow-y:auto;overflow-x:hidden;padding:0 6px 12px;scrollbar-width:thin;position:relative}
.sbg-row{position:relative;display:flex;align-items:center;height:30px;border-radius:var(--dsw-radius-sm);cursor:pointer;user-select:none;min-width:0}
.sbg-row:hover{background:var(--dsw-alias-interactive-bg-hover)}
.sbg-row[data-selected="true"]{background:var(--dsw-alias-interactive-bg-selected,var(--dsw-alias-interactive-bg-hover))}
.sbg-row[data-droptarget="true"]{background:var(--dsw-alias-interactive-bg-hover);outline:1.5px dashed var(--dsw-alias-state-business-primary);outline-offset:-1.5px}
.sbg-row[data-dropbad="true"]{cursor:not-allowed}
.sbg-row:focus-visible{outline:1.5px solid var(--dsw-focus-ring-color,var(--dsw-alias-state-business-primary));outline-offset:-1.5px}
.sbg-lead{flex:none;width:16px;height:16px;margin:0 6px 0 0;display:flex;align-items:center;justify-content:center;color:var(--dsw-alias-label-tertiary)}
.sbg-lead[data-active="true"]{color:var(--dsw-alias-state-business-primary)}
.sbg-chevron{flex:none;width:14px;height:14px;margin-right:2px;display:flex;align-items:center;justify-content:center;color:var(--dsw-alias-label-tertiary)}
.sbg-chevron[data-open="true"]{transform:rotate(90deg)}
.sbg-chevron[data-leaf="true"]{visibility:hidden}
.sbg-label{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.sbg-group-label{font-weight:600}
.sbg-count{flex:none;color:var(--dsw-alias-label-tertiary);font-size:11px;margin-left:6px}
.sbg-time{flex:none;color:var(--dsw-alias-label-tertiary);font-size:11px;margin-left:6px;white-space:nowrap}
.sbg-dot{flex:none;width:7px;height:7px;border-radius:50%;margin-left:6px;background:var(--dsw-alias-label-tertiary)}
.sbg-dot[data-kind="running"]{background:var(--dsw-alias-state-business-primary)}
.sbg-dot[data-kind="pending"]{background:var(--dsw-alias-state-warn-primary,#d97706)}
.sbg-dot[data-kind="done"]{background:var(--dsw-alias-state-success-primary,#15803d)}
.sbg-mark{flex:none;color:var(--dsw-alias-label-tertiary);margin-left:6px;display:flex}
.sbg-actions{flex:none;display:flex;align-items:center;gap:1px;margin-left:4px;opacity:0}
.sbg-row:hover .sbg-actions,.sbg-row:focus-within .sbg-actions,.sbg-row[data-menuopen="true"] .sbg-actions{opacity:1}
@media (hover:none){.sbg-actions{opacity:1}}
.sbg-abtn{flex:none;width:22px;height:22px;border:0;border-radius:var(--dsw-radius-sm);background:transparent;color:var(--dsw-alias-label-tertiary);cursor:pointer;display:inline-flex;align-items:center;justify-content:center;padding:0}
.sbg-abtn:hover{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}
.sbg-abtn:focus-visible{outline:1.5px solid var(--dsw-focus-ring-color,var(--dsw-alias-state-business-primary));outline-offset:1px}
.sbg-row[data-archived="true"]{opacity:.5}
.sbg-row[data-blank="true"]{color:var(--dsw-alias-label-secondary)}
.sbg-empty{display:flex;flex-direction:column;align-items:center;gap:6px;padding:32px 16px;color:var(--dsw-alias-label-tertiary);text-align:center}
.sbg-empty strong{color:var(--dsw-alias-label-secondary);font-weight:600}
.sbg-dropstrip{flex:none;margin:4px 10px 10px;border:1.5px dashed var(--dsw-alias-state-business-primary);border-radius:var(--dsw-radius-md);color:var(--dsw-alias-state-business-primary);font-size:12px;padding:10px;text-align:center;cursor:pointer}
.sbg-overlay{position:fixed;z-index:1000;min-width:200px;max-width:320px;max-height:60vh;overflow-y:auto;background:var(--dsw-alias-bg-overlay,var(--dsw-alias-bg-layer-1));border:0.5px solid var(--dsw-alias-border-l2,#0000001f);border-radius:var(--dsw-radius-md);box-shadow:var(--dsw-elevation-panel,0 4px 16px #00000026);padding:4px}
.sbg-menu-item{display:flex;align-items:center;gap:8px;width:100%;border:0;border-radius:var(--dsw-radius-sm);background:transparent;color:var(--dsw-alias-label-primary);cursor:pointer;font:inherit;font-size:13px;line-height:18px;padding:6px 10px;text-align:left;min-width:0}
.sbg-menu-item:hover{background:var(--dsw-alias-interactive-bg-hover)}
.sbg-menu-item[data-danger="true"]{color:var(--dsw-alias-state-error-primary)}
.sbg-menu-item[data-checked="true"]{font-weight:600}
.sbg-menu-item[disabled]{opacity:.45;cursor:default}
.sbg-menu-item .sbg-menu-glyph{flex:none;display:flex;color:var(--dsw-alias-label-secondary)}
.sbg-menu-item span{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.sbg-menu-sep{height:0.5px;background:var(--dsw-alias-border-l1);margin:4px 6px}
.sbg-menu-sub{padding-left:14px}
.sbg-dialog-backdrop{position:fixed;inset:0;z-index:1100;background:#00000055;display:flex;align-items:flex-start;justify-content:center;padding-top:18vh}
.sbg-dialog{width:min(420px,86vw);background:var(--dsw-alias-bg-layer-1,var(--dsw-alias-bg-base));border:1px solid var(--dsw-alias-border-l2);border-radius:var(--dsw-radius-lg,12px);box-shadow:var(--dsw-elevation-panel,0 8px 32px #00000033);padding:14px 16px;display:flex;flex-direction:column;gap:10px}
.sbg-dialog h3{margin:0;font-size:14px;font-weight:600;line-height:20px}
.sbg-dialog p{margin:0;color:var(--dsw-alias-label-secondary);font-size:12px;line-height:17px}
.sbg-dialog input{width:100%;box-sizing:border-box;height:30px;border:1px solid var(--dsw-alias-border-l2);border-radius:var(--dsw-radius-sm);background:var(--dsw-alias-bg-layer-1,var(--dsw-alias-bg-base));color:inherit;font:inherit;font-size:13px;padding:0 10px;outline:none}
.sbg-dialog input:focus-visible{outline:none;border-color:var(--dsw-alias-state-business-primary)}
.sbg-dialog-bar{display:flex;justify-content:flex-end;gap:8px}
.sbg-dialog-bar button{border-radius:var(--dsw-radius-sm);font:inherit;font-size:12px;line-height:18px;padding:5px 14px;cursor:pointer}
.sbg-dialog-cancel{border:1px solid var(--dsw-alias-border-l2);background:transparent;color:var(--dsw-alias-label-secondary)}
.sbg-dialog-cancel:hover{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}
.sbg-dialog-ok{border:0;background:var(--dsw-alias-state-business-primary,var(--dsw-alias-brand-primary));color:var(--dsw-alias-label-primary-foreground,#fff);font-weight:600}
.sbg-dialog-ok[data-danger="true"]{background:var(--dsw-alias-state-error-primary)}
.sbg-toast{position:fixed;left:50%;bottom:28px;transform:translateX(-50%);z-index:1200;background:var(--dsw-alias-bg-overlay,var(--dsw-alias-bg-layer-1));color:var(--dsw-alias-label-primary);border:0.5px solid var(--dsw-alias-border-l2,#0000001f);border-radius:var(--dsw-radius-md);box-shadow:var(--dsw-elevation-panel,0 4px 16px #00000026);padding:8px 14px;font-size:12px;line-height:18px;max-width:70vw}
.sbg-settings{display:flex;flex-direction:column;gap:18px;color:var(--dsw-alias-label-primary);font-size:14px;line-height:22px;min-width:0}
.sbg-settings .sbg-set-row{display:flex;align-items:flex-start;gap:12px}
.sbg-settings .sbg-set-main{flex:1;min-width:0;display:flex;flex-direction:column;gap:2px}
.sbg-settings .sbg-set-hint{color:var(--dsw-alias-label-secondary);font-size:12px;line-height:18px;overflow-wrap:anywhere}
.sbg-settings .sbg-set-code{font-family:var(--ds-font-family-code,monospace);font-size:12px;color:var(--dsw-alias-label-secondary)}
.sbg-switch{box-sizing:border-box;position:relative;flex:0 0 auto;width:36px;height:20px;padding:2px;border:0;border-radius:999px;background:var(--dsw-alias-border-l3,#00000042);cursor:pointer}
.sbg-switch[aria-checked="true"]{background:var(--dsw-alias-brand-primary)}
.sbg-switch:focus-visible{outline:var(--dsw-focus-ring-width,2px) solid var(--dsw-focus-ring-color,var(--dsw-alias-state-business-primary));outline-offset:2px}
.sbg-thumb{display:block;width:16px;height:16px;border-radius:50%;background:var(--dsw-alias-label-primary-foreground,#fff);transition:transform .12s ease}
.sbg-switch[aria-checked="false"] .sbg-thumb{background:var(--dsw-alias-switch-thumb,#fff)}
.sbg-switch[aria-checked="true"] .sbg-thumb{transform:translate(16px)}
.sbg-settings .sbg-cleanup{align-self:flex-start;border:1px solid var(--dsw-alias-border-l2);background:transparent;color:var(--dsw-alias-label-primary);border-radius:var(--dsw-radius-sm);cursor:pointer;font:inherit;font-size:12px;padding:4px 10px}
.sbg-settings .sbg-cleanup:hover{background:var(--dsw-alias-interactive-bg-hover)}
`;
    //#endregion

    //#region browser-local helpers
    const readLocal = (key, fallback) => {
      try {
        const raw = window.localStorage.getItem(key);
        return raw === null ? fallback : JSON.parse(raw);
      } catch {
        return fallback;
      }
    };
    const writeLocal = (key, value) => {
      try {
        window.localStorage.setItem(key, JSON.stringify(value));
      } catch {
        // Quota or privacy mode: view state just stays in memory.
      }
    };

    /** The grouped/shipped switch as an observable store backed by localStorage. */
    const enabledStore = (() => {
      const store = createStore(readLocal(ENABLED_KEY, true) !== false);
      return { ...store, set(next) { writeLocal(ENABLED_KEY, next); store.set(next); } };
    })();

    /** Mint a client-side group id. */
    const mintId = () => {
      try {
        return crypto.randomUUID();
      } catch {
        return `g-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
      }
    };
    //#endregion

    //#region pure derivation
    const WORKSPACE_PREFIX = 'workspace:';
    const SESSION_PREFIX = 'session:';

    const groupOf = (state, memberKey) => state.membership[memberKey] ?? null;

    /** Ids of groups of one kind/scope under a parent, ordered by name. */
    function groupChildren(state, kind, scope, parent) {
      return Object.values(state.groups)
        .filter((g) => g.kind === kind && g.parent === parent && (kind === 'workspace' ? true : g.scope === scope))
        .sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }) || (a.id < b.id ? -1 : 1))
        .map((g) => g.id);
    }

    /** Whether `ancestorId` is the group itself or one of its ancestors. */
    function inGroupChain(state, groupId, ancestorId) {
      let cursor = groupId;
      const seen = new Set();
      while (cursor !== null && !seen.has(cursor)) {
        if (cursor === ancestorId) return true;
        seen.add(cursor);
        cursor = state.groups[cursor]?.parent ?? null;
      }
      return false;
    }

    /** Order sessions: pinned partition first, then the selected mode. */
    function orderSessionIds(ids, byId, pinnedIds, order) {
      const pinIndex = new Map(pinnedIds.map((id, i) => [id, i]));
      return [...ids.filter((id) => byId[id] !== undefined)].sort((a, b) => {
        const pa = pinIndex.has(a);
        const pb = pinIndex.has(b);
        if (pa !== pb) return pa ? -1 : 1;
        if (pa && pb) return pinIndex.get(a) - pinIndex.get(b);
        if (order === 'name') return String(byId[a]?.displayTitle ?? '').localeCompare(String(byId[b]?.displayTitle ?? ''), undefined, { sensitivity: 'base' });
        const ta = byId[a]?.updatedAt ?? 0;
        const tb = byId[b]?.updatedAt ?? 0;
        if (ta !== tb) return tb - ta;
        return a < b ? -1 : 1;
      });
    }

    /** Sessions accounted to no workspace (subagents and blanks excluded). */
    function ungroupedSessionIds(list, workspaces) {
      const accounted = new Set();
      for (const ws of workspaces) for (const id of ws.sessionIds) accounted.add(id);
      return list.ids.filter((id) => {
        const row = list.byId[id];
        return row !== undefined && row.origin !== 'subagent' && row.blank !== true && !accounted.has(id);
      });
    }

    /** Session ids grouped under any session group of the scope. */
    function sessionsInScopeGroups(state, scope) {
      const grouped = new Set();
      for (const [key, gid] of Object.entries(state.membership)) {
        if (!key.startsWith(SESSION_PREFIX)) continue;
        const group = state.groups[gid];
        if (group !== undefined && group.kind === 'session' && group.scope === scope) grouped.add(key.slice(SESSION_PREFIX.length));
      }
      return grouped;
    }

    /** Workspace ids belonging to any workspace group. */
    function workspacesInGroups(state) {
      const grouped = new Set();
      for (const [key, gid] of Object.entries(state.membership)) {
        if (!key.startsWith(WORKSPACE_PREFIX)) continue;
        if (state.groups[gid] !== undefined) grouped.add(key.slice(WORKSPACE_PREFIX.length));
      }
      return grouped;
    }

    /**
     * Derive the flat render rows of the grouped tree.
     * @returns rows of kinds `wgroup`, `workspace`, `sgroup`, `session`; each carries its depth.
     */
    function deriveRows(state, workspaces, list, view, options) {
      const { currentId, pinnedIds, archivedSet, archivedFilter, order, now } = options;
      const byId = list.byId;
      const rows = [];

      const sessionVisible = (id) => {
        const row = byId[id];
        if (row === undefined) return false;
        if (row.origin === 'subagent' || row.blank === true) return false;
        const archived = archivedSet.has(id);
        if (archivedFilter === 'only') return archived;
        if (archivedFilter === 'hide') return !archived;
        return true;
      };

      const sessionRow = (id, depth, containerScope, extra) => {
        const summary = byId[id];
        const status = options.statuses.get(id);
        return {
          type: 'session',
          key: `se:${id}`,
          id,
          depth,
          scope: containerScope,
          displayTitle: summary?.displayTitle ?? '',
          storedTitle: summary?.title ?? '',
          blank: summary?.blank === true,
          archived: archivedSet.has(id),
          pinned: pinnedIds.includes(id),
          updatedAt: summary?.updatedAt ?? 0,
          status: {
            running: (status?.running ?? summary?.running) === true,
            pending: status?.pendingInteraction?.kind ?? null,
            done: status?.completionUnread === true,
          },
          ...(extra ?? {}),
        };
      };

      const pushSessionGroup = (gid, depth, scope, visibleMembers) => {
        const group = state.groups[gid];
        const expanded = view.sgroups[gid] !== false;
        const childGroupIds = groupChildren(state, 'session', scope, gid);
        const ownMembers = visibleMembers.filter((id) => groupOf(state, SESSION_PREFIX + id) === gid);
        const subMembers = new Set();
        for (const sub of childGroupIds) collectGroupMembers(state, sub, subMembers);
        rows.push({
          type: 'sgroup',
          key: `sg:${gid}`,
          id: gid,
          name: group.name,
          scope,
          depth,
          expanded,
          count: ownMembers.length + subMembers.size,
          containsCurrent: currentId !== undefined && (ownMembers.includes(currentId) || subMembers.has(currentId)),
        });
        if (!expanded) return;
        for (const sub of childGroupIds) pushSessionGroup(sub, depth + 1, scope, visibleMembers);
        const inSub = new Set();
        for (const sub of childGroupIds) collectGroupMembers(state, sub, inSub);
        for (const id of orderSessionIds(ownMembers.filter((id) => !inSub.has(id)), byId, pinnedIds, order)) rows.push(sessionRow(id, depth + 1, scope));
      };

      /** Direct member ids of a group plus everything below its subgroups. */
      const collectGroupMembers = (stateRef, gid, into) => {
        for (const [key, holder] of Object.entries(stateRef.membership)) {
          if (holder !== gid) continue;
          const member = key.startsWith(SESSION_PREFIX) ? key.slice(SESSION_PREFIX.length) : key.startsWith(WORKSPACE_PREFIX) ? key.slice(WORKSPACE_PREFIX.length) : null;
          if (member !== null) into.add(member);
        }
        for (const sub of groupChildren(stateRef, stateRef.groups[gid]?.kind ?? 'session', stateRef.groups[gid]?.scope ?? '', gid)) collectGroupMembers(stateRef, sub, into);
      };

      const pushWorkspaceContainer = (container, depth) => {
        const scope = container.id;
        const expanded = view.workspaces[container.id] !== false;
        const bucket = container.id === '';
        const rawMembers = bucket
          ? ungroupedSessionIds(list, workspaces)
          : container.sessionIds.filter((id) => byId[id] !== undefined && byId[id].origin !== 'subagent' && byId[id].blank !== true);
        const visibleMembers = rawMembers.filter(sessionVisible);
        const rootGroups = groupChildren(state, 'session', scope, null);
        const blankSessionId =
          currentId !== undefined &&
          archivedFilter !== 'only' &&
          byId[currentId]?.blank === true &&
          (bucket ? !workspaces.some((ws) => ws.sessionIds.includes(currentId)) : container.sessionIds.includes(currentId))
            ? currentId
            : undefined;
        // The Ungrouped bucket only exists while it has something to show (members or its own groups).
        const hasVisible = visibleMembers.length > 0 || blankSessionId !== undefined || rootGroups.length > 0;
        if (archivedFilter === 'only' && !hasVisible) return;
        if (bucket && !hasVisible) return;
        const containsCurrent =
          currentId !== undefined && (rawMembers.includes(currentId) || sessionsInScopeGroups(state, scope).has(currentId) || currentId === blankSessionId);
        rows.push({
          type: 'workspace',
          key: `ws:${scope}`,
          id: scope,
          label: container.label,
          path: container.path,
          depth,
          expanded,
          count: visibleMembers.length,
          containsCurrent,
        });
        if (!expanded) return;
        // The selected provisional New Session keeps the first slot, outside every group.
        if (blankSessionId !== undefined) rows.push(sessionRow(blankSessionId, depth + 1, scope));
        for (const gid of rootGroups) pushSessionGroup(gid, depth + 1, scope, visibleMembers);
        const inGroups = sessionsInScopeGroups(state, scope);
        for (const id of orderSessionIds(visibleMembers.filter((id) => !inGroups.has(id)), byId, pinnedIds, order)) rows.push(sessionRow(id, depth + 1, scope));
      };

      const pushWorkspaceGroup = (gid, depth) => {
        const group = state.groups[gid];
        const expanded = view.wgroups[gid] !== false;
        const childGroups = groupChildren(state, 'workspace', '', gid);
        const own = workspaces.filter((ws) => groupOf(state, WORKSPACE_PREFIX + ws.workspaceId) === gid);
        const subCount = childGroups.length;
        const visible = archivedFilter === 'only' ? own.some((ws) => ws.sessionIds.some(sessionVisible)) || childGroups.some((sub) => groupHasVisible(sub)) : true;
        if (!visible) return;
        rows.push({
          type: 'wgroup',
          key: `wg:${gid}`,
          id: gid,
          name: group.name,
          depth,
          expanded,
          count: own.length + subCount,
          containsCurrent: own.some((ws) => ws.workspaceId === options.currentWorkspaceId) || childGroups.some((sub) => groupContainsWorkspace(sub, options.currentWorkspaceId)),
        });
        if (!expanded) return;
        for (const sub of childGroups) pushWorkspaceGroup(sub, depth + 1);
        for (const ws of own) pushWorkspaceContainer({ id: ws.workspaceId, label: ws.title, path: ws.path, sessionIds: ws.sessionIds }, depth + 1);
      };

      const groupHasVisible = (gid) => {
        const own = workspaces.filter((ws) => groupOf(state, WORKSPACE_PREFIX + ws.workspaceId) === gid);
        const subs = groupChildren(state, 'workspace', '', gid);
        return own.some((ws) => ws.sessionIds.some(sessionVisible)) || subs.some(groupHasVisible);
      };
      const groupContainsWorkspace = (gid, workspaceId) => {
        if (workspaceId === undefined) return false;
        const own = workspaces.some((ws) => ws.workspaceId === workspaceId && groupOf(state, WORKSPACE_PREFIX + workspaceId) === gid);
        return own || groupChildren(state, 'workspace', '', gid).some((sub) => groupContainsWorkspace(sub, workspaceId));
      };

      for (const gid of groupChildren(state, 'workspace', '', null)) pushWorkspaceGroup(gid, 0);
      const grouped = workspacesInGroups(state);
      for (const ws of workspaces) if (!grouped.has(ws.workspaceId)) pushWorkspaceContainer({ id: ws.workspaceId, label: ws.title, path: ws.path, sessionIds: ws.sessionIds }, 0);
      // The Ungrouped bucket behaves as one more container (session groups may live in it too).
      pushWorkspaceContainer({ id: '', label: options.t('group.ungrouped'), path: undefined, sessionIds: [] }, 0);
      return rows;
    }

    /**
     * What a drop of `drag` onto `row` means: an op list plus optional host
     * order call, or `null` when the target is invalid.
     */
    function dropPlan(drag, row, state) {
      if (drag === null || row === undefined) return null;
      if (drag.kind === 'session') {
        if (row.type === 'sgroup' && row.scope === drag.scope) return { ops: [{ op: 'member.assign', key: SESSION_PREFIX + drag.id, group: row.id }] };
        if (row.type === 'session' && !row.blank && row.scope === drag.scope && row.id !== drag.id) {
          const targetGroup = groupOf(state, SESSION_PREFIX + row.id);
          return targetGroup === null
            ? { ops: [{ op: 'member.unassign', key: SESSION_PREFIX + drag.id }] }
            : { ops: [{ op: 'member.assign', key: SESSION_PREFIX + drag.id, group: targetGroup }] };
        }
        if (row.type === 'workspace' && row.id === drag.scope) return { ops: [{ op: 'member.unassign', key: SESSION_PREFIX + drag.id }] };
        return null;
      }
      if (drag.kind === 'workspace') {
        if (row.type === 'wgroup') return { ops: [{ op: 'member.assign', key: WORKSPACE_PREFIX + drag.id, group: row.id }] };
        if (row.type === 'workspace' && row.id !== drag.id) {
          const ops = [];
          const targetGroup = row.id === '' ? null : groupOf(state, WORKSPACE_PREFIX + row.id);
          if ((groupOf(state, WORKSPACE_PREFIX + drag.id) ?? null) !== (targetGroup ?? null)) {
            ops.push(targetGroup === null ? { op: 'member.unassign', key: WORKSPACE_PREFIX + drag.id } : { op: 'member.assign', key: WORKSPACE_PREFIX + drag.id, group: targetGroup });
          }
          return { ops, hostOrder: { workspaceId: drag.id, beforeWorkspaceId: row.id === '' ? undefined : row.id } };
        }
        return null;
      }
      if (drag.kind === 'wgroup' || drag.kind === 'sgroup') {
        if ((drag.kind === 'wgroup' && row.type === 'wgroup') || (drag.kind === 'sgroup' && row.type === 'sgroup')) {
          if (row.id === drag.id || inGroupChain(state, row.id, drag.id)) return null;
          return { ops: [{ op: 'group.move', id: drag.id, parent: row.id }] };
        }
        return null;
      }
      return null;
    }

    /** Drop on the root strip: leave the group (or the parent group for groups). */
    function dropPlanRoot(drag, state) {
      if (drag === null) return null;
      if (drag.kind === 'session') return { ops: [{ op: 'member.unassign', key: SESSION_PREFIX + drag.id }] };
      if (drag.kind === 'workspace') return { ops: [{ op: 'member.unassign', key: WORKSPACE_PREFIX + drag.id }] };
      if (drag.kind === 'wgroup' || drag.kind === 'sgroup') {
        const group = state.groups[drag.id];
        if (group?.parent) return { ops: [{ op: 'group.move', id: drag.id, parent: null }] };
        return null;
      }
      return null;
    }

    /** Relative time label for a session row. */
    function relativeTime(updatedAt, now, t) {
      if (!updatedAt) return '';
      const delta = Math.max(0, now - updatedAt);
      const minute = 60_000;
      if (delta < minute) return t('time.now');
      if (delta < 60 * minute) return t('time.m', { n: Math.floor(delta / minute) });
      if (delta < 24 * 60 * minute) return t('time.h', { n: Math.floor(delta / (60 * minute)) });
      if (delta < 7 * 24 * 60 * minute) return t('time.d', { n: Math.floor(delta / (24 * 60 * minute)) });
      return new Date(updatedAt).toLocaleDateString(undefined, { day: '2-digit', month: '2-digit' });
    }

    /** Parse a `kind:id` member key; null when malformed. */
    function parseMemberKey(key) {
      if (typeof key !== 'string') return null;
      const cut = key.indexOf(':');
      if (cut <= 0) return null;
      const kind = key.slice(0, cut);
      const id = key.slice(cut + 1);
      if ((kind !== 'workspace' && kind !== 'session') || id === '') return null;
      return { kind, id };
    }

    /** Membership keys whose group is gone or whose workspace/session is gone. */
    function staleMemberKeys(state, liveWorkspaceIds, liveSessionIds) {
      const workspaces = new Set(liveWorkspaceIds);
      const sessions = new Set(liveSessionIds);
      const stale = [];
      for (const [key, gid] of Object.entries(state.membership ?? {})) {
        const member = parseMemberKey(key);
        if (member === null) {
          stale.push(key);
          continue;
        }
        const alive = member.kind === 'workspace' ? workspaces.has(member.id) : sessions.has(member.id);
        if ((state.groups ?? {})[gid] === undefined || !alive) stale.push(key);
      }
      return stale;
    }

    /** Map a pending interaction kind to the localized status label. */
    function pendingLabel(kind, t) {
      if (typeof kind !== 'string') return undefined;
      if (kind.includes('plan')) return t('status.plan-review');
      if (kind.includes('question') || kind.includes('ask')) return t('status.question');
      return t('status.approval');
    }
    //#endregion

    //#region module-level UI stores
    const toastStore = createStore(null);
    const dialogStore = createStore(null);
    const workspaceMenuStore = createStore(null);
    let toastSeq = 0;

    const notify = (text, tone) => {
      toastSeq += 1;
      toastStore.set({ text, tone: tone ?? 'info', seq: toastSeq });
    };
    //#endregion

    //#region groups source
    /** Client-side projection of the Host group document plus op submission. */
    function createGroupsSource() {
      const store = createStore({ phase: 'pending', state: null, error: undefined, stateFile: undefined });
      // One serialized chain for every network hop: an apply response can never
      // be overwritten by a stale GET that read the file before that apply.
      let chain = Promise.resolve();
      const enqueue = (job) => {
        chain = chain.catch(() => {}).then(job);
        return chain;
      };

      const refresh = () =>
        enqueue(async () => {
          try {
            const response = await fetch(ROUTE_STATE, { headers: { accept: 'application/json' } });
            if (!response.ok) throw new Error(`HTTP ${String(response.status)}`);
            const payload = await response.json();
            store.set({ phase: 'ready', state: payload.state, error: undefined, stateFile: payload.stateFile });
          } catch (cause) {
            store.set({ phase: 'error', state: store.getSnapshot().state, error: String(cause?.message ?? cause), stateFile: store.getSnapshot().stateFile });
          }
        });

      const apply = (ops) =>
        enqueue(async () => {
          const response = await fetch(ROUTE_APPLY, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ ops }),
          });
          const payload = await response.json().catch(() => ({}));
          if (!response.ok) {
            notify(payload?.error !== undefined ? String(payload.error) : 'HTTP ' + String(response.status), 'error');
            // Re-sync: the Host may have moved on since our last read.
            void refresh();
            throw new Error(payload?.error ?? 'apply failed');
          }
          store.set({ phase: 'ready', state: payload.state, error: undefined, stateFile: payload.stateFile });
          return payload.state;
        });

      return { store, refresh, apply };
    }
    //#endregion

    //#region shared menu popup (custom renderer)
    /**
     * Menu row model used by both popups: resolved `ctx.contextMenus` views
     * and locally built rows share this shape.
     */
    function MenuRows({ rows, onPick }) {
      const nodes = [];
      let needSep = false;
      for (const row of rows) {
        if (row === 'sep') {
          needSep = true;
          continue;
        }
        if (needSep && nodes.length > 0) nodes.push(h('div', { key: `sep:${nodes.length}`, className: 'sbg-menu-sep' }));
        needSep = false;
        nodes.push(
          h(
            'button',
            {
              key: row.id,
              type: 'button',
              role: 'menuitem',
              className: 'sbg-menu-item',
              disabled: row.disabled === true,
              'data-danger': row.danger === true,
              'data-checked': row.checked === true,
              onClick: () => onPick(row),
            },
            row.glyph !== undefined ? h('span', { className: 'sbg-menu-glyph' }, row.glyph) : null,
            h('span', null, row.label),
          ),
        );
        if (row.children !== undefined && row.open === true) nodes.push(h('div', { key: `sub:${row.id}`, className: 'sbg-menu-sub' }, h(MenuRows, { rows: row.children, onPick })));
      }
      return h('div', { role: 'menu' }, nodes);
    }

    const flattenView = (view, openIds) => ({
      id: view.id,
      label: view.label,
      disabled: view.disabled,
      danger: view.danger,
      checked: false,
      glyph: undefined,
      children: view.children?.map((child) => flattenView(child, openIds)),
      open: view.children !== undefined && openIds.has(view.id),
      view,
    });

    /**
     * The workspace context popup: renders resolved views without the two
     * shipped contributions whose dialogs died with the shadowed browser,
     * and adds its own rename/delete rows backed by the public API.
     */
    function WorkspaceMenuEntry({ contextMenus, face, t }) {
      const request = useStore(workspaceMenuStore);
      const [views, setViews] = useState([]);
      const [openSubs, setOpenSubs] = useState(() => new Set());
      const resolutionRef = useRef(undefined);
      const boxRef = useRef(null);

      useEffect(() => {
        if (request === null || request.kind !== 'workspace') return;
        setOpenSubs(new Set());
        const resolution = contextMenus.resolve(request.target);
        resolutionRef.current = resolution;
        const sync = () => setViews(resolution.source.getSnapshot().slice());
        sync();
        const off = resolution.source.subscribe(sync);
        void resolution.ready.then(sync).catch(() => {});
        return () => {
          off();
          resolution.dispose();
          resolutionRef.current = undefined;
        };
      }, [request, contextMenus]);

      useEffect(() => {
        if (request === null) return;
        const onKey = (event) => {
          if (event.key === 'Escape') workspaceMenuStore.set(null);
        };
        const onDown = (event) => {
          if (boxRef.current !== null && event.target instanceof Node && !boxRef.current.contains(event.target)) workspaceMenuStore.set(null);
        };
        window.addEventListener('keydown', onKey);
        window.addEventListener('mousedown', onDown, true);
        return () => {
          window.removeEventListener('keydown', onKey);
          window.removeEventListener('mousedown', onDown, true);
        };
      }, [request]);

      if (request === null || request.kind !== 'workspace') return null;
      const dead = (view) => view.id.startsWith('workspace.rename') || view.id.startsWith('workspace.delete');
      const canRename = face.remoteAccess.source('workspace', request.target.value.workspaceId, 'workspace/rename').getSnapshot();
      const canDelete = face.remoteAccess.source('workspace', request.target.value.workspaceId, 'workspace/delete').getSnapshot();
      const rows = [];
      if (canRename) rows.push({ id: 'sbg:workspace.rename', label: t('menu.rename'), glyph: h(IconEdit, { size: 15 }), run: () => face.dialogs.openWorkspaceRename(request.target.value) });
      const middle = views.filter((view) => !dead(view)).map((view) => flattenView(view, openSubs));
      const flattened = [...rows, ...middle];
      if (canDelete) {
        if (flattened.length > 0) flattened.push('sep');
        flattened.push({ id: 'sbg:workspace.delete', label: t('menu.delete'), danger: true, glyph: h(IconTrash, { size: 15 }), run: () => face.dialogs.openWorkspaceDelete(request.target.value) });
      }
      const pick = (row) => {
        if (row.view !== undefined) {
          resolutionRef.current?.select(row.view.id);
          workspaceMenuStore.set(null);
          return;
        }
        if (row.children !== undefined) {
          setOpenSubs((current) => {
            const next = new Set(current);
            if (next.has(row.id)) next.delete(row.id);
            else next.add(row.id);
            return next;
          });
          return;
        }
        workspaceMenuStore.set(null);
        row.run?.();
      };
      const style = {
        left: Math.min(request.point.x, window.innerWidth - 240),
        top: Math.min(request.point.y, window.innerHeight - 120),
      };
      return h('div', { className: 'sbg-overlay', style, ref: boxRef }, h(MenuRows, { rows: flattened, onPick: pick }));
    }

    /** The group/view popup fed by locally built rows (no shared registry). */
    function LocalMenuEntry({ t }) {
      const request = useStore(workspaceMenuStore);
      const boxRef = useRef(null);
      const [openSubs, setOpenSubs] = useState(() => new Set());
      useEffect(() => {
        if (request === null || request.kind === 'workspace') return;
        setOpenSubs(new Set());
        const onKey = (event) => {
          if (event.key === 'Escape') workspaceMenuStore.set(null);
        };
        const onDown = (event) => {
          if (boxRef.current !== null && event.target instanceof Node && !boxRef.current.contains(event.target)) workspaceMenuStore.set(null);
        };
        window.addEventListener('keydown', onKey);
        window.addEventListener('mousedown', onDown, true);
        return () => {
          window.removeEventListener('keydown', onKey);
          window.removeEventListener('mousedown', onDown, true);
        };
      }, [request]);
      if (request === null || request.kind === 'workspace') return null;
      const withSubs = (rows) => rows.map((row) => (row.children !== undefined ? { ...row, open: openSubs.has(row.id) } : row));
      const pick = (row) => {
        if (row.children !== undefined) {
          setOpenSubs((current) => {
            const next = new Set(current);
            if (next.has(row.id)) next.delete(row.id);
            else next.add(row.id);
            return next;
          });
          return;
        }
        workspaceMenuStore.set(null);
        row.run?.();
      };
      const style = { left: Math.min(request.point.x, window.innerWidth - 240), top: Math.min(request.point.y, window.innerHeight - 120) };
      return h('div', { className: 'sbg-overlay', style, ref: boxRef }, h(MenuRows, { rows: withSubs(request.rows), onPick: pick }));
    }
    //#endregion

    //#region dialogs
    /** Name/confirm/workspace dialogs, one active request at a time. */
    function DialogsEntry({ face, t }) {
      const request = useStore(dialogStore);
      const [draft, setDraft] = useState('');
      const [busy, setBusy] = useState(false);
      const inputRef = useRef(null);

      useEffect(() => {
        if (request === null) return;
        setDraft(request.kind === 'workspaceRename' ? request.storedTitle : request.initial ?? '');
        setBusy(false);
        const timer = setTimeout(() => inputRef.current?.focus(), 30);
        const onKey = (event) => {
          if (event.key === 'Escape' && !busy) dialogStore.set(null);
        };
        window.addEventListener('keydown', onKey);
        return () => {
          clearTimeout(timer);
          window.removeEventListener('keydown', onKey);
        };
      }, [request, busy]);

      if (request === null) return null;
      const close = () => dialogStore.set(null);
      const commit = async () => {
        if (busy) return;
        setBusy(true);
        try {
          await request.commit(draft);
          close();
        } catch {
          // Failures already surfaced a toast; keep the dialog for retry.
          setBusy(false);
        }
      };
      const onInputKey = (event) => {
        if (event.key === 'Enter') void commit();
      };

      if (request.kind === 'groupDelete') {
        return h('div', { className: 'sbg-dialog-backdrop', onMouseDown: (e) => { if (e.target === e.currentTarget) close(); } },
          h('div', { className: 'sbg-dialog', role: 'dialog', 'aria-modal': true },
            h('h3', null, t('dialog.groupDelete.title', { name: request.name })),
            h('p', null, t('dialog.groupDelete.text')),
            h('div', { className: 'sbg-dialog-bar' },
              h('button', { type: 'button', className: 'sbg-dialog-cancel', onClick: close }, t('dialog.cancel')),
              h('button', { type: 'button', className: 'sbg-dialog-ok', 'data-danger': true, disabled: busy, onClick: () => { close(); void request.onConfirm(); } }, t('menu.delete')),
            ),
          ),
        );
      }

      const isWorkspaceRename = request.kind === 'workspaceRename';
      const isWorkspaceDelete = request.kind === 'workspaceDelete';
      if (isWorkspaceDelete) {
        return h('div', { className: 'sbg-dialog-backdrop', onMouseDown: (e) => { if (e.target === e.currentTarget) close(); } },
          h('div', { className: 'sbg-dialog', role: 'dialog', 'aria-modal': true },
            h('h3', null, t('dialog.workspaceDelete.title', { name: request.displayTitle })),
            h('p', null, t('dialog.workspaceDelete.text')),
            h('div', { className: 'sbg-dialog-bar' },
              h('button', { type: 'button', className: 'sbg-dialog-cancel', onClick: close }, t('dialog.cancel')),
              h('button', { type: 'button', className: 'sbg-dialog-ok', 'data-danger': true, disabled: busy, onClick: () => { close(); void request.onConfirm(); } }, t('menu.delete')),
            ),
          ),
        );
      }

      return h('div', { className: 'sbg-dialog-backdrop', onMouseDown: (e) => { if (e.target === e.currentTarget) close(); } },
        h('div', { className: 'sbg-dialog', role: 'dialog', 'aria-modal': true },
          h('h3', null, isWorkspaceRename ? t('dialog.workspaceRename.title') : request.title),
          h('input', {
            ref: inputRef,
            value: draft,
            placeholder: isWorkspaceRename ? t('dialog.workspace.name') : t('dialog.name.placeholder'),
            onChange: (e) => setDraft(e.target.value),
            onKeyDown: onInputKey,
            maxLength: 200,
          }),
          h('div', { className: 'sbg-dialog-bar' },
            h('button', { type: 'button', className: 'sbg-dialog-cancel', onClick: close }, t('dialog.cancel')),
            h('button', { type: 'button', className: 'sbg-dialog-ok', disabled: busy || draft.trim() === '', onClick: () => void commit() }, t('dialog.confirm')),
          ),
        ),
      );
    }

    /** Transient toast at the bottom of the frame. */
    function ToastEntry() {
      const toast = useStore(toastStore);
      const [visible, setVisible] = useState(null);
      useEffect(() => {
        if (toast === null) return;
        setVisible(toast);
        const timer = setTimeout(() => setVisible(null), 3500);
        return () => clearTimeout(timer);
      }, [toast]);
      if (visible === null) return null;
      return h('div', { className: 'sbg-toast', role: 'status' }, visible.text);
    }
    //#endregion

    //#region rows
    function Actions({ children }) {
      return h('div', { className: 'sbg-actions', onClick: (e) => e.stopPropagation() }, children);
    }

    const iconButton = (props, glyph) => h('button', { type: 'button', className: 'sbg-abtn', ...props }, glyph);

    function GroupRow({ row, t, view, onToggle, onMenu, dragHandlers }) {
      const Icon = row.type === 'wgroup' ? IconFolders : IconMessages;
      return h(
        'div',
        {
          className: 'sbg-row',
          'data-row-key': row.key,
          role: 'treeitem',
          'aria-expanded': row.expanded,
          'aria-level': row.depth + 1,
          style: { paddingLeft: 6 + row.depth * INDENT_PX },
          onClick: onToggle,
          onContextMenu: (e) => { e.preventDefault(); onMenu(e); },
          'data-droptarget': view.dropKey === row.key && view.dropValid,
          'data-dropbad': view.dropKey === row.key && !view.dropValid,
          draggable: true,
          ...dragHandlers,
        },
        h('span', { className: 'sbg-chevron', 'data-open': row.expanded, 'aria-hidden': true }, h(IconChevron, { size: 12 })),
        h('span', { className: 'sbg-lead', 'data-active': row.containsCurrent }, h(Icon, { size: 16 })),
        h('span', { className: 'sbg-label sbg-group-label' }, row.name),
        row.count > 0 ? h('span', { className: 'sbg-count' }, String(row.count)) : null,
        h(Actions, null,
          iconButton({ 'aria-label': `${t('aria.more')}: ${row.name}`, title: t('aria.more'), 'aria-haspopup': 'menu', onClick: (e) => { e.stopPropagation(); onMenu(e); } }, h(IconEllipsis, { size: 14 })),
        ),
      );
    }

    function WorkspaceRow({ row, t, view, onToggle, onMenu, onNewSession, dragHandlers }) {
      const isUngrouped = row.id === '';
      return h(
        'div',
        {
          className: 'sbg-row',
          'data-row-key': row.key,
          role: 'treeitem',
          'aria-expanded': row.expanded,
          'aria-level': row.depth + 1,
          style: { paddingLeft: 6 + row.depth * INDENT_PX },
          onClick: onToggle,
          onContextMenu: (e) => { if (isUngrouped) return; e.preventDefault(); onMenu(e); },
          'data-droptarget': view.dropKey === row.key && view.dropValid,
          'data-dropbad': view.dropKey === row.key && !view.dropValid,
          draggable: !isUngrouped,
          ...dragHandlers,
        },
        h('span', { className: 'sbg-chevron', 'data-open': row.expanded, 'aria-hidden': true }, h(IconChevron, { size: 12 })),
        h('span', { className: 'sbg-lead', 'data-active': row.containsCurrent, title: row.path ?? undefined }, h(row.expanded ? IconFolderOpen : IconFolder, { size: 16 })),
        h('span', { className: 'sbg-label sbg-group-label', title: row.path ?? undefined }, row.label),
        row.count > 0 ? h('span', { className: 'sbg-count' }, String(row.count)) : null,
        h(Actions, null,
          !isUngrouped && onNewSession !== undefined
            ? iconButton({ 'aria-label': `${t('group.newSession')}: ${row.label}`, title: t('group.newSession'), onClick: (e) => { e.stopPropagation(); onNewSession(); } }, h(IconNewChat, { size: 14 }))
            : null,
          !isUngrouped
            ? iconButton({ 'aria-label': `${t('aria.more')}: ${row.label}`, title: t('aria.more'), 'aria-haspopup': 'menu', onClick: (e) => { e.stopPropagation(); onMenu(e); } }, h(IconEllipsis, { size: 14 }))
            : null,
        ),
      );
    }

    function SessionRow({ row, t, current, view, onOpen, onMenu, onTogglePin, onArchive, dragHandlers }) {
      const statusText = row.status.pending !== null
        ? pendingLabel(row.status.pending, t)
        : row.status.running
          ? t('status.running')
          : row.status.done
            ? t('status.done')
            : undefined;
      const dotKind = row.status.pending !== null ? 'pending' : row.status.running ? 'running' : row.status.done ? 'done' : undefined;
      return h(
        'div',
        {
          className: 'sbg-row',
          'data-row-key': row.key,
          role: 'treeitem',
          'aria-level': row.depth + 1,
          'aria-selected': current === row.id,
          tabIndex: 0,
          style: { paddingLeft: 6 + row.depth * INDENT_PX },
          'data-selected': current === row.id,
          'data-archived': row.archived,
          'data-blank': row.blank,
          'data-droptarget': view.dropKey === row.key && view.dropValid,
          'data-dropbad': view.dropKey === row.key && !view.dropValid,
          draggable: dragHandlers !== undefined,
          onClick: () => onOpen(),
          onContextMenu: (e) => { e.preventDefault(); onMenu(e); },
          onKeyDown: (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onOpen(); } },
          ...dragHandlers,
        },
        h('span', { className: 'sbg-chevron', 'data-leaf': true }, null),
        h('span', { className: 'sbg-lead' }, dotKind !== undefined ? h('span', { className: 'sbg-dot', 'data-kind': dotKind, title: statusText }) : null),
        h('span', { className: 'sbg-label', title: row.displayTitle }, row.blank ? t('group.newSession') : row.displayTitle === '' ? t('session.untitled') : row.displayTitle),
        row.archived ? h('span', { className: 'sbg-count' }, t('session.archived')) : null,
        h('span', { className: 'sbg-time' }, relativeTime(row.updatedAt, view.now, t)),
        h(Actions, null,
          row.archived
            ? h('span', { className: 'sbg-mark', title: t('session.archived') }, h(IconArchive, { size: 13 }))
            : [
                row.pinned ? h('span', { className: 'sbg-mark', title: t('session.pinned'), style: { marginRight: 2 } }, h(IconPinFilled, { size: 13 })) : null,
                onTogglePin !== undefined
                  ? iconButton({ 'aria-label': t('session.pinned'), title: t('session.pinned'), onClick: (e) => { e.stopPropagation(); onTogglePin(); } }, h(row.pinned ? IconPin : IconPinFilled, { size: 13 }))
                  : null,
                onArchive !== undefined
                  ? iconButton({ 'aria-label': t('session.archived'), title: t('session.archived'), onClick: (e) => { e.stopPropagation(); onArchive(); } }, h(IconArchive, { size: 13 }))
                  : null,
                iconButton({ 'aria-label': `${t('aria.more')}: ${row.displayTitle}`, title: t('aria.more'), 'aria-haspopup': 'menu', onClick: (e) => { e.stopPropagation(); onMenu(e); } }, h(IconEllipsis, { size: 14 })),
              ],
        ),
      );
    }
    //#endregion

    //#region browser
    /** Menu rows for one group (our own domain): subgroup/rename/move/delete. */
    function groupMenuRows(face, state, groupId, t) {
      const group = state.groups[groupId];
      if (group === undefined) return [];
      const scope = group.kind === 'session' ? group.scope : '';
      // Any same-kind group in scope can become the new parent, except itself and its descendants.
      const moveTargets = Object.values(state.groups)
        .filter((candidate) => candidate.kind === group.kind && (group.kind === 'workspace' || candidate.scope === scope))
        .filter((candidate) => candidate.id !== groupId && !inGroupChain(state, candidate.id, groupId))
        .sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }));
      const rows = [
        {
          id: 'sbg:subgroup',
          label: t('menu.group.createChild'),
          glyph: h(group.kind === 'workspace' ? IconFolders : IconMessages, { size: 15 }),
          run: () =>
            face.dialogs.openName({
              title: t('dialog.name.create'),
              initial: '',
              commit: (name) => face.groups.apply([{ op: 'group.create', id: mintId(), name, kind: group.kind, parent: groupId, scope: group.kind === 'session' ? group.scope : undefined }]),
            }),
        },
        {
          id: 'sbg:rename',
          label: t('menu.rename'),
          glyph: h(IconEdit, { size: 15 }),
          run: () => face.dialogs.openName({ title: t('dialog.name.rename'), initial: group.name, commit: (name) => face.groups.apply([{ op: 'group.rename', id: groupId, name }]) }),
        },
      ];
      if (group.parent !== null || moveTargets.length > 0) {
        rows.push({
          id: 'sbg:move',
          label: t('menu.group.submenu'),
          glyph: h(IconFolders, { size: 15 }),
          children: [
            ...(group.parent !== null ? [{ id: 'sbg:move:root', label: t('menu.group.remove'), run: () => face.groups.apply([{ op: 'group.move', id: groupId, parent: null }]).catch(() => {}) }] : []),
            ...moveTargets.map((target) => ({
              id: `sbg:move:${target.id}`,
              label: t('menu.moveInto', { name: target.name }),
              run: () => face.groups.apply([{ op: 'group.move', id: groupId, parent: target.id }]).catch(() => {}),
            })),
          ],
        });
      }
      rows.push('sep');
      rows.push({
        id: 'sbg:delete',
        label: t('menu.delete'),
        danger: true,
        glyph: h(IconTrash, { size: 15 }),
        run: () =>
          face.dialogs.openGroupDelete({
            name: group.name,
            onConfirm: () => face.groups.apply([{ op: 'group.delete', id: groupId }]).catch(() => {}),
          }),
      });
      return rows;
    }

    /** View options popup rows (order + archived filter). */
    function viewMenuRows(view, setView, t) {
      const radio = (id, label, checked, run) => ({ id, label, checked, run });
      return [
        radio('sbg:order:updated', t('view.order.updated'), view.order !== 'name', () => setView((v) => ({ ...v, order: 'updated' }))),
        radio('sbg:order:name', t('view.order.name'), view.order === 'name', () => setView((v) => ({ ...v, order: 'name' }))),
        'sep',
        radio('sbg:archived:hide', t('view.archived.hide'), view.archivedFilter === 'hide', () => setView((v) => ({ ...v, archivedFilter: 'hide' }))),
        radio('sbg:archived:show', t('view.archived.show'), view.archivedFilter === 'show', () => setView((v) => ({ ...v, archivedFilter: 'show' }))),
        radio('sbg:archived:only', t('view.archived.only'), view.archivedFilter === 'only', () => setView((v) => ({ ...v, archivedFilter: 'only' }))),
      ];
    }

    /** The grouped browser filling `sidebar.workspaces`. */
    function makeGroupedBrowser(face) {
      return function GroupedBrowser(props) {
        const { wide, expandSidebar, useSessions, useWorkspaces, useSessionStatus, usePanelInfo, renderSlot, t } = props;
        const list = useSessions((s) => s);
        const workspacesSnap = useWorkspaces((s) => s);
        const statuses = useSessionStatus((s) => s);
        const panelActive = usePanelInfo((info) => info.activePanelId !== null);

        const groupsSnap = useStore(face.groups.store);
        const directoryFlowReady = useStore(face.directoryFlow);

        const [view, setView] = useState(() => ({
          wgroups: {},
          workspaces: {},
          sgroups: {},
          archivedFilter: 'hide',
          order: 'updated',
          searchOpen: false,
          query: '',
          ...readLocal(VIEW_KEY, {}),
        }));
        useEffect(() => {
          const { searchOpen: _ignored, query: _ignored2, ...persisted } = view;
          writeLocal(VIEW_KEY, persisted);
        }, [view]);

        const [drag, setDrag] = useState(null);
        const [dropInfo, setDropInfo] = useState({ key: null, valid: false });
        const [addOpen, setAddOpen] = useState(false);
        const [addBusy, setAddBusy] = useState(false);
        const [content, setContent] = useState({ items: [], hasMore: false });
        const searchSeq = useRef(0);
        const [now, setNow] = useState(() => Date.now());
        useEffect(() => {
          const timer = setInterval(() => setNow(Date.now()), 60_000);
          return () => clearInterval(timer);
        }, []);

        // Re-sync the group document when the window regains focus (other tabs may have applied ops).
        useEffect(() => {
          const onFocus = () => void face.groups.refresh();
          window.addEventListener('focus', onFocus);
          document.addEventListener('visibilitychange', onFocus);
          return () => {
            window.removeEventListener('focus', onFocus);
            document.removeEventListener('visibilitychange', onFocus);
          };
        }, []);

        const currentId = panelActive ? undefined : Object.values(list.byId).find((row) => (row.retainedBy.mainView ?? 0) > 0)?.id;
        const currentWorkspaceId = currentId === undefined ? undefined : workspacesSnap.items.find((ws) => ws.sessionIds.includes(currentId))?.workspaceId;
        const state = groupsSnap.state ?? { version: 1, rev: 0, groups: {}, membership: {} };

        const rows = useMemo(() => {
          if (view.searchOpen && view.query.trim() !== '') return [];
          return deriveRows(state, workspacesSnap.items, list, view, {
            currentId,
            currentWorkspaceId,
            pinnedIds: workspacesSnap.pinnedSessionIds,
            archivedSet: new Set(workspacesSnap.archivedSessionIds),
            archivedFilter: view.archivedFilter,
            order: view.order,
            statuses,
            now,
            t,
          });
        }, [state, workspacesSnap, list, view, currentId, currentWorkspaceId, statuses, now, t]);

        const workspaceOfSession = useCallback(
          (sessionId) => workspacesSnap.items.find((ws) => ws.sessionIds.includes(sessionId)),
          [workspacesSnap],
        );

        const applyGroups = useCallback(
          (ops) => {
            face.groups.apply(ops).catch(() => {});
          },
          [face],
        );

        const openSession = useCallback(
          (sessionId) => {
            const summary = list.byId[sessionId];
            if (summary === undefined) return;
            if (workspacesSnap.archivedSessionIds.includes(sessionId)) {
              notify(t('toast.archived'));
              return;
            }
            face.uiWorkspace.openSession(sessionId);
          },
          [face, list, workspacesSnap, t],
        );

        const togglePin = useCallback(
          (sessionId, pinned) => {
            const call = pinned ? face.uiWorkspace.unpinSession : face.uiWorkspace.pinSession;
            call(sessionId).catch(() => notify(t('toast.workspaceError'), 'error'));
          },
          [face, t],
        );

        const archive = useCallback(
          (sessionId) => {
            face.uiWorkspace.archiveSession(sessionId).catch(() => notify(t('toast.workspaceError'), 'error'));
          },
          [face, t],
        );

        const openSessionMenu = useCallback(
          (sessionId, displayTitle, point) => {
            const active = face.contextMenus.active.getSnapshot();
            if (active?.kind === 'session' && active.value.sessionId === sessionId) face.contextMenus.close();
            else face.contextMenus.open({ kind: 'session', value: { sessionId, displayTitle } }, point);
          },
          [face],
        );

        const openWorkspaceMenu = useCallback((row, point) => {
          if (row.id === '') return;
          workspaceMenuStore.set({
            kind: 'workspace',
            target: { kind: 'workspace', value: { workspaceId: row.id, path: row.path ?? '', displayTitle: row.label } },
            point: { x: point.clientX, y: point.clientY + 8 },
          });
        }, []);

        const openGroupMenu = useCallback((row, point) => {
          workspaceMenuStore.set({
            kind: 'group',
            groupId: row.id,
            rows: groupMenuRows(face, state, row.id, t),
            point: { x: point.clientX, y: point.clientY + 8 },
          });
        }, [face, state, t]);

        const openViewMenu = useCallback((point) => {
          workspaceMenuStore.set({ kind: 'view', rows: viewMenuRows(view, setView, t), point });
        }, [view, t]);

        const startDrag = useCallback((kind, id, scope) => (event) => {
          event.dataTransfer.effectAllowed = 'move';
          event.dataTransfer.setData('text/plain', id);
          setDrag({ kind, id, scope });
        }, []);

        const dragOver = useCallback(
          (row) => (event) => {
            if (drag === null) return;
            const plan = dropPlan(drag, row, state);
            event.preventDefault();
            event.dataTransfer.dropEffect = plan === null ? 'none' : 'move';
            setDropInfo({ key: row.key, valid: plan !== null });
          },
          [drag, state],
        );

        const drop = useCallback(
          (row) => (event) => {
            event.preventDefault();
            setDropInfo({ key: null, valid: false });
            const plan = dropPlan(drag, row, state);
            setDrag(null);
            if (plan === null) return;
            if (plan.hostOrder !== undefined) void face.workspaces.insertBefore(plan.hostOrder.workspaceId, plan.hostOrder.beforeWorkspaceId).catch(() => notify(t('toast.workspaceError'), 'error'));
            if (plan.ops.length > 0) applyGroups(plan.ops);
          },
          [drag, state, face, applyGroups, t],
        );

        const dragEnd = useCallback(() => {
          setDrag(null);
          setDropInfo({ key: null, valid: false });
        }, []);

        const dropRoot = useCallback(() => {
          const plan = dropPlanRoot(drag, state);
          setDrag(null);
          setDropInfo({ key: null, valid: false });
          if (plan === null || plan.ops.length === 0) return;
          applyGroups(plan.ops);
        }, [drag, state, applyGroups]);

        // Content search: local metadata instantly, host content debounced.
        useEffect(() => {
          if (!view.searchOpen || view.query.trim() === '') {
            setContent({ items: [], hasMore: false });
            return;
          }
          const query = view.query.trim();
          const seq = ++searchSeq.current;
          const controller = new AbortController();
          const timer = setTimeout(() => {
            face.sessions
              .search(query, controller.signal)
              .then((result) => {
                if (!result.ok || seq !== searchSeq.current) return;
                setContent({ items: result.value.items, hasMore: result.value.hasMore });
              })
              .catch(() => {});
          }, 250);
          return () => {
            clearTimeout(timer);
            controller.abort();
          };
        }, [view.searchOpen, view.query, face]);

        const searchRows = useMemo(() => {
          if (!view.searchOpen || view.query.trim() === '') return [];
          const query = view.query.trim().toLowerCase();
          const archivedSet = new Set(workspacesSnap.archivedSessionIds);
          const local = [];
          for (const id of list.ids) {
            const row = list.byId[id];
            if (row === undefined || row.origin === 'subagent' || row.blank) continue;
            const ws = workspaceOfSession(id);
            const haystack = `${row.displayTitle} ${ws?.title ?? ''} ${row.cwd ?? ''} ${id}`.toLowerCase();
            if (haystack.includes(query)) local.push({ id, row, ws, snippet: undefined, at: row.updatedAt });
          }
          local.sort((a, b) => b.at - a.at);
          const seen = new Set(local.map((entry) => entry.id));
          const merged = [...local];
          for (const item of content.items) {
            if (seen.has(item.sessionId)) {
              const hit = merged.find((entry) => entry.id === item.sessionId);
              if (hit !== undefined) hit.snippet = item.snippet;
              continue;
            }
            const row = list.byId[item.sessionId];
            if (row === undefined || row.origin === 'subagent') continue;
            if (archivedSet.has(item.sessionId) && view.archivedFilter === 'hide') continue;
            seen.add(item.sessionId);
            merged.push({ id: item.sessionId, row, ws: workspaceOfSession(item.sessionId), snippet: item.snippet, at: row.updatedAt ?? 0 });
          }
          return merged.slice(0, face.sessions.searchResultLimit ?? 20);
        }, [view.searchOpen, view.query, view.archivedFilter, list, workspacesSnap, content, workspaceOfSession, face]);

        const headerButton = (props, glyph) => iconButton({ className: 'sbg-hbtn', ...props }, glyph);

        const searchRowsNodes =
          searchRows.length === 0
            ? h('div', { className: 'sbg-empty' }, h('strong', null, t('search.empty')))
            : searchRows.map((entry) =>
                h(
                  'div',
                  {
                    key: `sr:${entry.id}`,
                    className: 'sbg-row',
                    'data-row-key': `sr:${entry.id}`,
                    role: 'option',
                    'data-selected': currentId === entry.id,
                    onClick: () => {
                      setView((v) => ({ ...v, searchOpen: false, query: '' }));
                      openSession(entry.id);
                    },
                  },
                  h('span', { className: 'sbg-lead' }, h(IconSearch, { size: 13 })),
                  h('span', { className: 'sbg-label' }, entry.row.displayTitle === '' ? t('session.untitled') : entry.row.displayTitle),
                  entry.ws !== undefined ? h('span', { className: 'sbg-count' }, entry.ws.title) : null,
                  entry.snippet !== undefined ? h('span', { className: 'sbg-time', title: entry.snippet }, entry.snippet.slice(0, 40)) : null,
                ),
              );

        const rowNodes = rows.map((row) => {
          const common = {
            key: row.key,
            row,
            t,
            view: { ...dropInfo, now },
          };
          const groupDrag = { onDragStart: startDrag(row.type, row.id), onDragOver: dragOver(row), onDrop: drop(row), onDragEnd: dragEnd };
          if (row.type === 'wgroup') {
            return h(GroupRow, {
              ...common,
              onToggle: () => setView((v) => ({ ...v, wgroups: { ...v.wgroups, [row.id]: !row.expanded } })),
              onMenu: (e) => openGroupMenu(row, e),
              dragHandlers: groupDrag,
            });
          }
          if (row.type === 'sgroup') {
            return h(GroupRow, {
              ...common,
              onToggle: () => setView((v) => ({ ...v, sgroups: { ...v.sgroups, [row.id]: !row.expanded } })),
              onMenu: (e) => openGroupMenu(row, e),
              dragHandlers: groupDrag,
            });
          }
          if (row.type === 'workspace') {
            return h(WorkspaceRow, {
              ...common,
              onToggle: () => setView((v) => ({ ...v, workspaces: { ...v.workspaces, [row.id]: !row.expanded } })),
              onMenu: (e) => openWorkspaceMenu(row, e),
              onNewSession: row.id === '' ? undefined : () => face.uiWorkspace.startSession(row.id),
              dragHandlers: { onDragStart: startDrag('workspace', row.id), onDragOver: dragOver(row), onDrop: drop(row), onDragEnd: dragEnd },
            });
          }
          return h(SessionRow, {
            ...common,
            current: currentId,
            onOpen: () => openSession(row.id),
            onMenu: (e) => openSessionMenu(row.id, row.displayTitle, { x: e.clientX, y: e.clientY + 8 }),
            onTogglePin: row.blank || row.archived ? undefined : () => togglePin(row.id, row.pinned),
            onArchive: row.blank || row.archived ? undefined : () => archive(row.id),
            dragHandlers: row.blank ? undefined : { onDragStart: startDrag('session', row.id, row.scope), onDragOver: dragOver(row), onDrop: drop(row), onDragEnd: dragEnd },
          });
        });

        const phaseReady = list.phase !== 'pending' && workspacesSnap.phase !== 'pending';

        return h(
          'div',
          { className: 'sbg-root' },
          h('div', { className: 'sbg-header' },
            h('span', { className: 'sbg-title' }, t('header.title')),
            headerButton({ 'aria-label': t('header.search'), title: t('header.search'), 'aria-expanded': view.searchOpen, onClick: () => { if (!wide) expandSidebar?.(); setView((v) => ({ ...v, searchOpen: !v.searchOpen, query: '' })); } }, h(IconSearch, { size: 15 })),
            headerButton({ 'aria-label': t('header.view'), title: t('header.view'), onClick: (e) => { const r = e.currentTarget.getBoundingClientRect(); openViewMenu({ x: r.right, y: r.bottom + 4 }); } }, h(IconSliders, { size: 15 })),
            headerButton({ 'aria-label': t('header.addGroup'), title: t('header.addGroup'), onClick: () => face.dialogs.openName({ title: t('dialog.name.create'), initial: '', commit: (name) => face.groups.apply([{ op: 'group.create', id: mintId(), name, kind: 'workspace' }]) }) }, h(IconFolders, { size: 15 })),
            directoryFlowReady
              ? headerButton({ 'aria-label': t('header.addWorkspace'), title: t('header.addWorkspace'), disabled: addBusy, onClick: () => setAddOpen(true) }, h(IconPlus, { size: 15 }))
              : null,
          ),
          view.searchOpen
            ? h('div', { className: 'sbg-searchline' },
                h('input', {
                  value: view.query,
                  placeholder: t('header.search.placeholder'),
                  autoFocus: true,
                  onChange: (e) => setView((v) => ({ ...v, query: e.target.value })),
                  onKeyDown: (e) => { if (e.key === 'Escape') setView((v) => ({ ...v, searchOpen: false, query: '' })); },
                }),
              )
            : null,
          groupsSnap.phase === 'error'
            ? h('div', { className: 'sbg-banner' },
                h('span', null, t('settings.error.prefix') + groupsSnap.error),
                h('button', { type: 'button', onClick: () => void face.groups.refresh() }, t('settings.retry')),
              )
            : null,
          h('div', { className: 'sbg-list', role: 'tree', 'aria-label': t('aria.tree') },
            !phaseReady
              ? h('div', { className: 'sbg-empty' }, '…')
              : view.searchOpen && view.query.trim() !== ''
                ? searchRowsNodes
                : rowNodes.length > 0
                  ? rowNodes
                  : h('div', { className: 'sbg-empty' },
                      h('strong', null, t('empty.title')),
                      h('span', null, t('empty.add')),
                    ),
          ),
          drag !== null ? h('div', { className: 'sbg-dropstrip', onDragOver: (e) => e.preventDefault(), onDrop: dropRoot, onClick: dropRoot }, t('drop.ungroup')) : null,
          directoryFlowReady
            ? renderSlot('sidebar.workspaces.directoryFlow', {
                open: addOpen,
                busy: addBusy,
                onPicked: (pickedPath) => {
                  setAddBusy(true);
                  face.workspaces
                    .create({ path: pickedPath })
                    .then(() => {
                      setAddOpen(false);
                      setAddBusy(false);
                    })
                    .catch((cause) => {
                      setAddBusy(false);
                      notify(String(cause?.message ?? cause), 'error');
                    });
                },
                onCancel: () => {
                  setAddOpen(false);
                  setAddBusy(false);
                },
                onError: (message) => {
                  setAddOpen(false);
                  setAddBusy(false);
                  notify(String(message), 'error');
                },
              })
            : null,
        );
      };
    }
    //#endregion

    //#region settings section
    /** Switch control copied from the host primitive's markup under the plugin prefix. */
    function Switch({ on, busy, label, onChange }) {
      return h(
        'button',
        {
          type: 'button',
          role: 'switch',
          'aria-checked': on,
          'aria-label': label,
          disabled: busy === true,
          className: 'sbg-switch',
          onClick: () => onChange(!on),
        },
        h('span', { className: 'sbg-thumb' }),
      );
    }

    function makeSettingsSection(face) {
      return function SettingsSection({ t }) {
        const groupsSnap = useStore(face.groups.store);
        const enabled = useStore(enabledStore);
        const [cleanupState, setCleanupState] = useState({ busy: false, message: undefined });

        useEffect(() => {
          void face.groups.refresh();
          const onFocus = () => void face.groups.refresh();
          window.addEventListener('focus', onFocus);
          return () => window.removeEventListener('focus', onFocus);
        }, [face]);

        const state = groupsSnap.state ?? { groups: {}, membership: {} };
        const groupCount = Object.keys(state.groups ?? {}).length;
        const linkCount = Object.keys(state.membership ?? {}).length;

        const cleanup = async () => {
          setCleanupState({ busy: true, message: undefined });
          try {
            const [sessionIds, workspaceIds] = await Promise.resolve(face.liveIds());
            const stale = staleMemberKeys(state, workspaceIds, sessionIds);
            if (stale.length === 0) {
              setCleanupState({ busy: false, message: t('settings.cleanup.none') });
              return;
            }
            await face.groups.apply(stale.map((key) => ({ op: 'member.unassign', key })));
            setCleanupState({ busy: false, message: t('settings.cleanup.done', { count: stale.length }) });
          } catch (cause) {
            setCleanupState({ busy: false, message: String(cause?.message ?? cause) });
          }
        };

        return h(
          'div',
          { className: 'sbg-settings' },
          h('style', null, CSS),
          groupsSnap.phase === 'error'
            ? h('div', { className: 'sbg-banner', style: { margin: 0 } },
                h('span', null, t('settings.error.prefix') + groupsSnap.error),
                h('button', { type: 'button', onClick: () => void face.groups.refresh() }, t('settings.retry')),
              )
            : null,
          h('div', { className: 'sbg-set-row' },
            h('div', { className: 'sbg-set-main' },
              h('div', null, t('settings.enabled')),
              h('div', { className: 'sbg-set-hint' }, t('settings.enabled.hint')),
            ),
            h(Switch, { on: enabled, label: t('settings.enabled'), onChange: (next) => enabledStore.set(next) }),
          ),
          h('div', { className: 'sbg-set-main' },
            h('div', null, t('settings.stats', { groups: groupCount, links: linkCount })),
            groupsSnap.stateFile !== undefined ? h('div', { className: 'sbg-set-hint' }, `${t('settings.stateFile')}: `) : null,
            groupsSnap.stateFile !== undefined ? h('div', { className: 'sbg-set-code' }, groupsSnap.stateFile) : null,
          ),
          h('button', { type: 'button', className: 'sbg-cleanup', disabled: cleanupState.busy, onClick: () => void cleanup() },
            cleanupState.busy ? '…' : t('settings.cleanup'),
          ),
          cleanupState.message !== undefined ? h('div', { className: 'sbg-set-hint' }, cleanupState.message) : null,
        );
      };
    }
    //#endregion

    //#region trailing seat (native mode)
    /** Group glyph on session rows of the shipped browser, keyed by stable id. */
    function makeTrailingMark(face) {
      return function TrailingGroupMark({ sessionId }) {
        const snap = useStore(face.groups.store);
        const enabled = useStore(enabledStore);
        if (enabled) return null;
        const gid = snap.state?.membership?.[SESSION_PREFIX + sessionId];
        const group = gid !== undefined ? snap.state?.groups?.[gid] : undefined;
        if (group === undefined) return null;
        const Icon = group.kind === 'workspace' ? IconFolders : IconMessages;
        return h('span', { className: 'sbg-mark', title: group.name, style: { marginRight: 4 } }, h(Icon, { size: 13 }));
      };
    }
    //#endregion

    //#region apply
    return {
      inject: ['slots', 'locale', 'sessions', 'workspaces', 'uiWorkspace', 'contextMenus', 'remoteAccess'],
      apply(ctx) {
        const locale = ctx.get('locale');
        if (locale === undefined) return;
        const t = locale.bind(NS);
        const sessions = ctx.get('sessions');
        const workspaces = ctx.get('workspaces');
        const uiWorkspace = ctx.get('uiWorkspace');
        const contextMenus = ctx.get('contextMenus');
        const remoteAccess = ctx.get('remoteAccess');
        const slots = ctx.get('slots');

        ctx.effect(() => {
          const style = document.createElement('style');
          style.id = STYLE_ID;
          style.textContent = CSS;
          document.head.appendChild(style);
          return () => style.remove();
        }, 'sidebar-groups: stylesheet');

        ctx.effect(() => locale.register(NS, DICTIONARIES), 'sidebar-groups: dictionaries');

        const groups = createGroupsSource();
        void groups.refresh();

        /** Everything the slot components need, resolved once per apply. */
        const face = {
          groups,
          sessions,
          workspaces,
          uiWorkspace,
          contextMenus,
          remoteAccess,
          directoryFlow: {
            getSnapshot: () => slots.entries('sidebar.workspaces.directoryFlow').length > 0,
            subscribe: (listener) => slots.subscribe('sidebar.workspaces.directoryFlow', listener),
          },
          liveIds: async () => [sessions.list.getSnapshot().ids, workspaces.list.getSnapshot().items.map((ws) => ws.workspaceId)],
          dialogs: {
            openName: (request) => dialogStore.set({ kind: 'name', ...request }),
            openGroupDelete: (request) => dialogStore.set({ kind: 'groupDelete', ...request }),
            openWorkspaceRename: (value) =>
              dialogStore.set({
                kind: 'workspaceRename',
                workspaceId: value.workspaceId,
                storedTitle: workspaces.list.getSnapshot().items.find((ws) => ws.workspaceId === value.workspaceId)?.title ?? value.displayTitle,
                commit: async (title) => {
                  try {
                    await workspaces.rename(value.workspaceId, title);
                  } catch (cause) {
                    notify(t('toast.workspaceError'), 'error');
                    throw cause;
                  }
                },
              }),
            openWorkspaceDelete: (value) =>
              dialogStore.set({
                kind: 'workspaceDelete',
                workspaceId: value.workspaceId,
                displayTitle: value.displayTitle,
                onConfirm: async () => {
                  try {
                    await workspaces.delete(value.workspaceId);
                  } catch (cause) {
                    notify(t('toast.workspaceError'), 'error');
                  }
                },
              }),
          },
        };

        // Register/unregister the grouped browser as the switch flips.
        ctx.effect(() => {
          let disposeInject;
          const install = () => {
            if (disposeInject !== undefined) {
              disposeInject();
              disposeInject = undefined;
            }
            if (!enabledStore.getSnapshot()) return;
            disposeInject = slots.inject('sidebar.workspaces', () =>
              slots.register(
                {
                  name: 'sidebar.workspaces',
                  id: 'sidebar-groups',
                  locale: NS,
                  // Re-declare the shipped browser's child seats: shadowing collapses
                  // its declarations, and every occupant re-registers through inject().
                  children: {
                    'sidebar.workspaces.directoryFlow': { kind: 'single', scope: 'root' },
                    'sidebar.workspaces.session.row.action': { kind: 'list', scope: 'root' },
                    'sidebar.session.row.leading': { kind: 'list', scope: 'root', inline: true },
                    'sidebar.session.row.trailing': { kind: 'list', scope: 'root', inline: true },
                    'sidebar.session.row.hover': { kind: 'list', scope: 'root' },
                  },
                },
                makeGroupedBrowser(face),
              ),
            );
          };
          install();
          const off = enabledStore.subscribe(install);
          return () => {
            off();
            if (disposeInject !== undefined) disposeInject();
          };
        }, 'sidebar-groups: browser entry');

        // Group mark on the shipped browser rows (declaration rides the active browser).
        ctx.slots.inject('sidebar.session.row.trailing', () =>
          slots.register({ name: 'sidebar.session.row.trailing', id: 'sidebar-groups.mark', order: 50, inject: () => ({ face }) }, makeTrailingMark(face)),
        );

        // Overlays: dialogs, custom workspace menu, local menus, toast.
        ctx.slots.inject('shell.overlay', () =>
          slots.register({ name: 'shell.overlay', id: 'sidebar-groups.dialogs', locale: NS, inject: () => ({ face }) }, DialogsEntry),
        );
        ctx.slots.inject('shell.overlay', () =>
          slots.register({ name: 'shell.overlay', id: 'sidebar-groups.workspace-menu', locale: NS, inject: () => ({ face, contextMenus }) }, WorkspaceMenuEntry),
        );
        ctx.slots.inject('shell.overlay', () =>
          slots.register({ name: 'shell.overlay', id: 'sidebar-groups.local-menu', locale: NS }, LocalMenuEntry),
        );
        ctx.slots.inject('shell.overlay', () => slots.register({ name: 'shell.overlay', id: 'sidebar-groups.toast' }, ToastEntry));

        // Menu glyphs for our contributions in the shared popup.
        ctx.slots.inject('contextMenu.icon', function* () {
          yield slots.register({ name: 'contextMenu.icon', key: 'sidebar-groups.wgroup' }, IconFolders);
          yield slots.register({ name: 'contextMenu.icon', key: 'sidebar-groups.sgroup' }, IconMessages);
        });

        /** Session groups available for one session (its workspace scope). */
        const sessionGroupChoices = (sessionId) => {
          const ws = workspaces.list.getSnapshot().items.find((row) => row.sessionIds.includes(sessionId));
          const scope = ws?.workspaceId ?? '';
          const state = groups.store.getSnapshot().state ?? { groups: {}, membership: {} };
          const choices = groupChildren(state, 'session', scope, null).map((id) => state.groups[id]);
          const current = state.membership?.[SESSION_PREFIX + sessionId] ?? null;
          return { scope, ws, choices, current };
        };

        ctx.effect(() =>
          contextMenus.register({
            id: 'sidebar-groups.session-group',
            target: 'session',
            order: 640,
            observe: (target) => [groups.store, workspaces.list],
            resolve: (target) => {
              const { choices, current, scope } = sessionGroupChoices(target.value.sessionId);
              const children = choices.map((group) => ({
                id: `assign:${group.id}`,
                label: group.name,
                icon: { key: 'sidebar-groups.sgroup' },
                disabled: current === group.id,
                run: () => groups.apply([{ op: 'member.assign', key: SESSION_PREFIX + target.value.sessionId, group: group.id }]).catch(() => {}),
              }));
              if (current !== null) {
                children.push({
                  id: 'ungroup',
                  label: t('menu.group.remove'),
                  run: () => groups.apply([{ op: 'member.unassign', key: SESSION_PREFIX + target.value.sessionId }]).catch(() => {}),
                });
              }
              children.push({
                id: 'new-group',
                label: t('menu.group.new'),
                run: () =>
                  face.dialogs.openName({
                    title: t('dialog.name.create'),
                    initial: '',
                    commit: (name) => {
                      const id = mintId();
                      return groups.apply([{ op: 'group.create', id, name, kind: 'session', scope }, { op: 'member.assign', key: SESSION_PREFIX + target.value.sessionId, group: id }]);
                    },
                  }),
              });
              return [{ id: 'sidebar-groups.session-group', label: t('menu.group.submenu'), icon: { key: 'sidebar-groups.sgroup' }, children }];
            },
          }),
          'sidebar-groups: session menu contribution',
        );

        ctx.effect(() =>
          contextMenus.register({
            id: 'sidebar-groups.workspace-group',
            target: 'workspace',
            order: 640,
            observe: () => [groups.store],
            resolve: (target) => {
              const state = groups.store.getSnapshot().state ?? { groups: {}, membership: {} };
              const choices = groupChildren(state, 'workspace', '', null).map((id) => state.groups[id]);
              const current = state.membership?.[WORKSPACE_PREFIX + target.value.workspaceId] ?? null;
              const children = choices.map((group) => ({
                id: `assign:${group.id}`,
                label: group.name,
                icon: { key: 'sidebar-groups.wgroup' },
                disabled: current === group.id,
                run: () => groups.apply([{ op: 'member.assign', key: WORKSPACE_PREFIX + target.value.workspaceId, group: group.id }]).catch(() => {}),
              }));
              if (current !== null) {
                children.push({
                  id: 'ungroup',
                  label: t('menu.group.remove'),
                  run: () => groups.apply([{ op: 'member.unassign', key: WORKSPACE_PREFIX + target.value.workspaceId }]).catch(() => {}),
                });
              }
              children.push({
                id: 'new-group',
                label: t('menu.group.new'),
                run: () =>
                  face.dialogs.openName({
                    title: t('dialog.name.create'),
                    initial: '',
                    commit: (name) => {
                      const id = mintId();
                      return groups.apply([{ op: 'group.create', id, name, kind: 'workspace' }, { op: 'member.assign', key: WORKSPACE_PREFIX + target.value.workspaceId, group: id }]);
                    },
                  }),
              });
              return [{ id: 'sidebar-groups.workspace-group', label: t('menu.group.submenu'), icon: { key: 'sidebar-groups.wgroup' }, children }];
            },
          }),
          'sidebar-groups: workspace menu contribution',
        );

        // Settings → Session groups.
        ctx.slots.inject('settings.section', () =>
          slots.register({ name: 'settings.section', id: 'sidebar-groups', order: 26, label: () => t('settings.nav'), locale: NS }, makeSettingsSection(face)),
        );
        ctx.slots.inject('settings.section.icon', () => slots.register({ name: 'settings.section.icon', id: 'sidebar-groups' }, IconFolders));
      },
    };
    //#endregion
  },
});
