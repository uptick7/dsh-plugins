English | [Русский](README.ru.md)

# DSH Plugins

A collection of plugins for [DeepSeek Harness (DSH)](https://www.npmjs.com/package/@deepseek-ai/dsh) — one self-contained directory per plugin. The repo is not limited to web plugins; host-side and mixed plugins are welcome too.

## Plugins

| Plugin | Version | Description |
|---|---|---|
| [message-edit](message-edit/) | 1.5.1 | Edit a sent user message in place: the edited text replaces the previous exchange in the same session's model context, and the session continues without a fork. |

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
- Each plugin must include its own `README.md`, `package.json` and tests.
- Plugins should not depend on each other.

## License

No license yet — add one before publishing or accepting external contributions.
