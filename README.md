English | [Русский](README.ru.md)

# DSH Plugins

A collection of plugins for [DeepSeek Harness (DSH)](https://www.npmjs.com/package/@deepseek-ai/dsh) — one self-contained directory per plugin. The repo is not limited to web plugins; host-side and mixed plugins are welcome too.

## Plugins

| Plugin | npm package | Version | Description |
|---|---|---|---|
| [message-edit](message-edit/) | [`@uptick7/dsh-message-edit`](https://www.npmjs.com/package/@uptick7/dsh-message-edit) | 1.5.1 | Edit a sent user message in place: the edited text replaces the previous exchange in the same session's model context, and the session continues without a fork. |
| [commands-bridge](commands-bridge/) | [`@uptick7/dsh-commands-bridge`](https://www.npmjs.com/package/@uptick7/dsh-commands-bridge) | 1.0.0 | Bridge markdown slash-commands from shared (`~/.agents/commands`), harness (`~/.dsh/commands`), and project (`<cwd>/.agents/commands`) directories into the command registry; a Settings → Commands page shows descriptions, argument hints, and enable toggles. |

## Installation

### From npm (recommended)

Each plugin is a plain JS package published to npm — no TypeScript/Vite build step required. Install into a DSH profile (replace `web` with your profile name), then restart the host:

```sh
dsh plugin --profile web add @uptick7/dsh-message-edit
dsh plugin --profile web add @uptick7/dsh-commands-bridge
```

Or in the web GUI: **Plugins** (Plugin Manager) → search for the package name → install.

### From source

Clone this repository and point your DSH profile at the plugin directory: add `"link:<absolute-path>/message-edit"` (or `commands-bridge`) to the profile's `dependencies` **and** the package name to `dsh.profile.bundles`. See the plugin's own README for details and limitations.

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

## Releasing

Both packages publish from CI: bump the plugin's `version` in its `package.json`, push a tag `<plugin>-v<version>` (for example `message-edit-v1.5.2`), and the [release workflow](.github/workflows/release.yml) runs the checks and publishes to npm with the repository's `NPM_TOKEN` secret. Publishing manually also works: an npm account with the `uptick7` scope, then `npm publish` inside the plugin directory.

After the first release, consider listing the repo in the community catalog — a one-file PR to [awesome-dsh-plugin](https://github.com/awesome-dsh-plugin/awesome-dsh-plugin#contributing) (`data/plugins/uptick7__dsh-plugins.yml`), and add the `dsh-plugin` topic to the GitHub repository so the catalog accepts it. Prepared submission files live in [catalog/](catalog/).

## Contributing

- One directory per plugin, named after the plugin.
- Each plugin must include its own bilingual README (`README.md` + `README.ru.md`), `package.json` and tests.
- Plugins should not depend on each other.
- Keep the plugin's npm identity consistent: the package name in `package.json`, the `name:` in its `cordis.patch.yml`, and the client module `id` must all match.

## License

Released under the [MIT License](LICENSE).
