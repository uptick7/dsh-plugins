English | [Русский](README.ru.md)

# DSH Plugins

A collection of plugins for [DeepSeek Harness (DSH)](https://www.npmjs.com/package/@deepseek-ai/dsh) — one self-contained directory per plugin. The repo is not limited to web plugins; host-side and mixed plugins are welcome too.

## Plugins

| Plugin | Version | Description |
|---|---|---|
| [message-edit](message-edit/) | 1.5.1 | Edit a sent user message in place: the edited text replaces the previous exchange in the same session's model context, and the session continues without a fork. |
| [commands-bridge](commands-bridge/) | 1.0.0 | Bridge markdown slash-commands from shared (`~/.agents/commands`), harness (`~/.dsh/commands`), and project (`<cwd>/.agents/commands`) directories into the command registry; a Settings → Commands page shows descriptions, argument hints, and enable toggles. |

## Installation

Each plugin is a plain JS package — no TypeScript/Vite build step required. Clone this repository and point your DSH profile at the plugin directory, e.g. `dsh-plugins/message-edit`. See the plugin's own README for details and limitations.

## Development

Each plugin directory is independent:

```sh
cd message-edit
npm test        # runs node --test; requires a local DSH installation
npm run check   # syntax check
```

Tests use a real DSH `Session` and the V4 codec (no model calls). DSH is resolved via `npm root -g` by default; override with:

```sh
DSH_ROOT=/path/to/@deepseek-ai/dsh npm test
```

## Contributing

- One directory per plugin, named after the plugin.
- Each plugin must include its own bilingual README (`README.md` + `README.ru.md`), `package.json` and tests.
- Plugins should not depend on each other.

## License

Released under the [MIT License](LICENSE).
