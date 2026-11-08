/**
 * Client half of the commands bridge bundle.
 *
 * Adds a Settings → Commands page: every command the Host bridge discovered
 * (machine-shared, harness-install, per-project) with its description,
 * argument hint, and an enable/disable toggle, plus a read-only group of
 * commands contributed by other plugins. Data comes from the bundle's Host
 * route on the same origin; the page refreshes on show and when the Host
 * publishes `commands/change`.
 */
window.__ModuleLoader__.load({
  id: '@uptick7/dsh-commands-bridge',
  factory(require) {
    const React = require('react');
    const h = React.createElement;

    const NS = 'commandsBridge';
    const ROUTE_INVENTORY = '/commands-bridge/inventory';
    const ROUTE_TOGGLE = '/commands-bridge/toggle';

    const DICTIONARIES = {
      en: {
        nav: 'Commands',
        'group.agent': 'Agent commands',
        'group.global': 'Shared commands (all agents)',
        'group.project': 'Project commands',
        'group.plugins': 'Plugin commands',
        'hint.plugins': 'Registered by installed plugins; managed on their own pages',
        'noDescription': 'No description',
        'loading': 'Loading…',
        'error.prefix': 'Failed to load commands: ',
        'error.retry': 'Retry',
        'toggle.on': 'Disable command',
        'toggle.off': 'Enable command',
      },
      ru: {
        nav: 'Команды',
        'group.agent': 'Команды агента',
        'group.global': 'Общие команды (все агенты)',
        'group.project': 'Команды проекта',
        'group.plugins': 'Команды плагинов',
        'hint.plugins': 'Зарегистрированы установленными плагинами; управляются на их страницах',
        'noDescription': 'Без описания',
        'loading': 'Загрузка…',
        'error.prefix': 'Не удалось загрузить команды: ',
        'error.retry': 'Повторить',
        'toggle.on': 'Отключить команду',
        'toggle.off': 'Включить команду',
      },
    };

    /** Plain nav glyph: white (currentColor) prompt chevron + slash, no underlay, like native nav icons. */
    function NavGlyph({ size = 16 }) {
      return h(
        'svg',
        {
          viewBox: '0 0 16 16',
          width: size,
          height: size,
          fill: 'none',
          'aria-hidden': true,
          style: { flex: 'none', display: 'block' },
        },
        h('path', {
          d: 'M4.5 4.5L8 8l-3.5 3.5',
          stroke: 'currentColor',
          'stroke-width': 1.4,
          'stroke-linecap': 'round',
          'stroke-linejoin': 'round',
        }),
        h('path', { d: 'M9.5 12.5L12 3.5', stroke: 'currentColor', 'stroke-width': 1.4, 'stroke-linecap': 'round' }),
      );
    }

    /** Row badge: the >_ prompt chip, matching the zcode-style command rows. */
    function PromptGlyph({ size = 16 }) {
      return h(
        'svg',
        {
          viewBox: '0 0 64 64',
          width: size,
          height: size,
          'aria-hidden': true,
          style: { flex: 'none', display: 'block' },
        },
        h('rect', { x: 4, y: 4, width: 56, height: 56, rx: 14, fill: 'var(--dsw-alias-bg-layer-2)' }),
        h('path', {
          d: 'M20 24l10 8-10 8',
          stroke: 'var(--dsw-alias-label-secondary)',
          'stroke-width': 5,
          fill: 'none',
          'stroke-linecap': 'round',
          'stroke-linejoin': 'round',
        }),
        h('path', { d: 'M37 44l7-24', stroke: 'var(--dsw-alias-label-secondary)', 'stroke-width': 5, 'stroke-linecap': 'round' }),
      );
    }

    /**
     * Copy of the host `Switch` primitive (@deepseek-ai/dsh-client-ui-primitives):
     * same markup, classes renamed under the plugin prefix, same CSS and behavior.
     * Importing the primitive itself from plugin code is not allowed.
     */
    function Toggle({ on, busy, label, onChange }) {
      return h(
        'button',
        {
          type: 'button',
          role: 'switch',
          'aria-checked': on,
          'aria-label': label,
          disabled: busy === true,
          className: 'cmdb-switch',
          onClick: () => onChange(!on),
        },
        h('span', { className: 'cmdb-thumb' }),
      );
    }

    function CommandRow({ command, busyKeys, onToggle, t }) {
      const busy = busyKeys.has(command.key);
      return h(
        'div',
        { className: 'cmdb-row' + (command.enabled ? '' : ' cmdb-row-off') },
        h('div', { className: 'cmdb-glyph' }, h(PromptGlyph, { size: 18 })),
        h(
          'div',
          { className: 'cmdb-main' },
          h(
            'div',
            { className: 'cmdb-titleline' },
            h('span', { className: 'cmdb-name' }, '/' + command.name),
            command.argumentHint !== '' ? h('span', { className: 'cmdb-hint' }, command.argumentHint) : null,
          ),
          h(
            'div',
            { className: 'cmdb-desc' },
            command.warning !== undefined
              ? h('span', { className: 'cmdb-warning' }, command.warning)
              : command.description !== ''
                ? command.description
                : t('noDescription'),
          ),
        ),
        h(Toggle, {
          on: command.enabled,
          busy,
          label: (command.enabled ? t('toggle.on') : t('toggle.off')) + ': /' + command.name,
          onChange: () => onToggle(command),
        }),
      );
    }

    function PluginRow({ command, t }) {
      return h(
        'div',
        { className: 'cmdb-row' },
        h('div', { className: 'cmdb-glyph' }, h(PromptGlyph, { size: 18 })),
        h(
          'div',
          { className: 'cmdb-main' },
          h(
            'div',
            { className: 'cmdb-titleline' },
            h('span', { className: 'cmdb-name' }, '/' + command.name),
            command.hint !== '' ? h('span', { className: 'cmdb-hint' }, command.hint) : null,
          ),
          h(
            'div',
            { className: 'cmdb-desc' },
            command.description !== '' ? command.description : t('noDescription'),
            command.definitionId !== '' ? h('span', { className: 'cmdb-owner' }, command.definitionId) : null,
          ),
        ),
      );
    }

    /** One group; empty groups render nothing at all. */
    function Group({ title, subtitle, commands, readOnly, busyKeys, onToggle, t }) {
      if (commands.length === 0) return null;
      return h(
        'section',
        { className: 'cmdb-group' },
        h('h3', { className: 'cmdb-group-title' }, title),
        subtitle !== undefined ? h('div', { className: 'cmdb-group-subtitle' }, subtitle) : null,
        h(
          'div',
          { className: 'cmdb-list', role: 'group', 'aria-label': title },
          commands.map((command) =>
            readOnly
              ? h(PluginRow, { key: command.name + ':' + command.definitionId, command, t })
              : h(CommandRow, { key: command.key, command, busyKeys, onToggle, t }),
          ),
        ),
      );
    }

    /** The Commands settings page. */
    function makeCommandsSection(ctx) {
      return function CommandsSection({ t }) {
        const [data, setData] = React.useState(undefined);
        const [error, setError] = React.useState(undefined);
        const [busyKeys, setBusyKeys] = React.useState(() => new Set());

        const reload = React.useCallback(async () => {
          try {
            const response = await fetch(ROUTE_INVENTORY, { headers: { accept: 'application/json' } });
            if (!response.ok) throw new Error(`HTTP ${String(response.status)}`);
            const payload = await response.json();
            setData(payload);
            setError(undefined);
          } catch (cause) {
            setError(String(cause?.message ?? cause));
          }
        }, []);

        React.useEffect(() => {
          void reload();
          const onVisibility = () => {
            if (document.visibilityState === 'visible') void reload();
          };
          document.addEventListener('visibilitychange', onVisibility);
          window.addEventListener('focus', onVisibility);
          let off;
          try {
            off = ctx.get('remote')?.$on?.('commands/change', () => void reload());
          } catch {
            off = undefined;
          }
          return () => {
            document.removeEventListener('visibilitychange', onVisibility);
            window.removeEventListener('focus', onVisibility);
            try {
              off?.();
            } catch {
              // The remote already went away with its connection.
            }
          };
        }, [reload]);

        const onToggle = React.useCallback(
          async (command) => {
            const key = command.key;
            setBusyKeys((current) => {
              const next = new Set(current);
              next.add(key);
              return next;
            });
            setData((current) =>
              current === undefined
                ? current
                : {
                    ...current,
                    sources: current.sources.map((source) => ({
                      ...source,
                      commands: source.commands.map((entry) => (entry.key === key ? { ...entry, enabled: !entry.enabled } : entry)),
                    })),
                  },
            );
            try {
              const response = await fetch(ROUTE_TOGGLE, {
                method: 'POST',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify({ key, enabled: !command.enabled }),
              });
              if (!response.ok) {
                const payload = await response.json().catch(() => ({}));
                throw new Error(payload?.error !== undefined ? payload.error : `HTTP ${String(response.status)}`);
              }
              setError(undefined);
            } catch (cause) {
              setError(String(cause?.message ?? cause));
            } finally {
              setBusyKeys((current) => {
                const next = new Set(current);
                next.delete(key);
                return next;
              });
              void reload();
            }
          },
          [],
        );

        const groups = [];
        if (data !== undefined) {
          for (const source of data.sources ?? []) {
            if ((source.commands ?? []).length === 0) continue;
            groups.push({
              key: (source.cwd ?? '') + ':' + source.path,
              title: t(source.kind === 'global' ? 'group.global' : source.kind === 'agent' ? 'group.agent' : 'group.project'),
              subtitle: source.kind === 'project' ? source.cwd : source.path,
              commands: source.commands ?? [],
              readOnly: false,
            });
          }
          if (data.plugins?.available === true && (data.plugins.commands ?? []).length > 0) {
            groups.push({
              key: 'plugins',
              title: t('group.plugins'),
              subtitle: t('hint.plugins'),
              commands: data.plugins.commands ?? [],
              readOnly: true,
            });
          }
        }

        return h(
          'div',
          { className: 'cmdb-root' },
          h('style', null, STYLES),
          error !== undefined
            ? h(
                'div',
                { className: 'cmdb-error' },
                h('span', null, t('error.prefix') + error),
                h(
                  'button',
                  { type: 'button', className: 'cmdb-retry', onClick: () => void reload() },
                  t('error.retry'),
                ),
              )
            : null,
          data === undefined && error === undefined ? h('div', { className: 'cmdb-empty' }, t('loading')) : null,
          groups.map((group) =>
            h(Group, {
              key: group.key,
              title: group.title,
              subtitle: group.subtitle,
              commands: group.commands,
              readOnly: group.readOnly,
              busyKeys,
              onToggle,
              t,
            }),
          ),
        );
      };
    }

    const STYLES = `
.cmdb-root{display:flex;flex-direction:column;gap:24px;color:var(--dsw-alias-label-primary);font-size:14px;line-height:22px;min-width:0}
.cmdb-error{display:flex;align-items:center;gap:12px;border:1px solid var(--dsw-alias-border-l2);border-radius:var(--dsw-radius-md);padding:10px 12px;color:var(--dsw-alias-state-error-primary)}
.cmdb-retry{border:1px solid var(--dsw-alias-border-l2);background:transparent;color:var(--dsw-alias-label-primary);border-radius:var(--dsw-radius-sm);cursor:pointer;padding:4px 10px;font-family:inherit;font-size:12px}
.cmdb-retry:hover{background:var(--dsw-alias-interactive-bg-hover)}
.cmdb-group{display:flex;flex-direction:column;gap:6px;min-width:0}
.cmdb-group-title{margin:0;font-size:13px;font-weight:600;line-height:20px}
.cmdb-group-subtitle{color:var(--dsw-alias-label-secondary);font-size:12px;line-height:18px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.cmdb-list{border:1px solid var(--dsw-alias-border-l1);border-radius:var(--dsw-radius-md);background:var(--dsw-alias-bg-layer-1);overflow:hidden;display:flex;flex-direction:column}
.cmdb-row{display:flex;align-items:center;gap:12px;padding:10px 14px;border-bottom:.5px solid var(--dsw-alias-border-l1)}
.cmdb-row:last-child{border-bottom:none}
.cmdb-row-off .cmdb-name,.cmdb-row-off .cmdb-glyph{opacity:.45}
.cmdb-glyph{flex:none;display:flex;align-items:center}
.cmdb-main{flex:1;min-width:0;display:flex;flex-direction:column;gap:2px}
.cmdb-titleline{display:flex;align-items:baseline;gap:8px;min-width:0}
.cmdb-name{font-family:var(--ds-font-family-code,monospace);font-size:13px}
.cmdb-hint{color:var(--dsw-alias-label-secondary);font-family:var(--ds-font-family-code,monospace);font-size:12px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.cmdb-desc{color:var(--dsw-alias-label-secondary);font-size:12px;line-height:18px;overflow-wrap:anywhere}
.cmdb-owner{margin-left:8px;color:var(--dsw-alias-label-secondary);font-size:11px;opacity:.8}
.cmdb-warning{color:var(--dsw-alias-state-warn-primary,var(--dsw-alias-state-error-primary))}
.cmdb-empty{color:var(--dsw-alias-label-secondary);padding:10px 2px;font-size:12px}
.cmdb-switch{box-sizing:border-box;position:relative;flex:0 0 auto;width:36px;height:20px;padding:2px;border:0;border-radius:999px;corner-shape:round;background:var(--dsw-alias-border-l3);cursor:pointer}
.cmdb-switch[aria-checked=true]{background:var(--dsw-alias-brand-primary)}
.cmdb-switch:disabled{cursor:default;opacity:.5}
.cmdb-switch:focus-visible{outline:var(--dsw-focus-ring-width) solid var(--dsw-focus-ring-color,var(--dsw-alias-state-business-primary));outline-offset:2px}
.cmdb-thumb{display:block;width:16px;height:16px;border-radius:50%;corner-shape:round;background:var(--dsw-alias-label-primary-foreground);transition:transform .12s ease}
.cmdb-switch[aria-checked=false] .cmdb-thumb{background:var(--dsw-alias-switch-thumb)}
.cmdb-switch[aria-checked=true] .cmdb-thumb{transform:translate(16px)}
`;

    return {
      inject: ['slots', 'locale'],
      apply(ctx) {
        const locale = ctx.get('locale');
        if (locale === undefined) return;
        ctx.effect(() => locale.register(NS, DICTIONARIES), 'commands-bridge: dictionaries');
        const t = locale.bind(NS);
        const CommandsSection = makeCommandsSection(ctx);
        ctx.slots.inject('settings.section', () =>
          ctx.slots.register(
            {
              name: 'settings.section',
              id: 'commands-bridge',
              order: 25,
              label: () => t('nav'),
              locale: NS,
            },
            CommandsSection,
          ),
        );
        ctx.slots.inject('settings.section.icon', () =>
          ctx.slots.register({ name: 'settings.section.icon', id: 'commands-bridge' }, NavGlyph),
        );
      },
    };
  },
});
