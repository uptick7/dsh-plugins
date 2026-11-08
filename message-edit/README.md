English | [Русский](README.ru.md)

# Message Edit (`@uptick7/dsh-message-edit`)

Editing a user message **in the same session**, without a fork:

1. The client stops the current response and sends the edit along with the number of the original message.
2. In `agent/pre-step` the host replaces the suffix of the model surface with an empty `developer/message`. The event must include `turn`, `step` and `message.source`.
3. The model receives the history **up to** the selected message and the corrected message with its attachments preserved. The service header is not passed to the model.
4. The UI hides the replaced turns only in the corresponding conversation panel.

If the original message is already excluded from the surface (for example, by a previous edit or compaction), the edit is rejected. Refresh the conversation and pick the current message. An invalid edit is not sent as a regular request on top of the old history.

## Install

Published on npm as [`@uptick7/dsh-message-edit`](https://www.npmjs.com/package/@uptick7/dsh-message-edit); it declares `engines.dsh: ">=0.2.1-rc.1 <0.3.0-0"`.

Install into a profile (replace `web` with your profile name), then restart the host:

```sh
dsh plugin --profile web add -w @uptick7/dsh-message-edit
```

Or install from the web GUI: **Plugins** (Plugin Manager) → search for `@uptick7/dsh-message-edit` → install; enable the bundle if the manager does not do it automatically.

From this repository without npm: clone it and add both the dependency and the bundle name to the profile's `package.json`:

```json
{
  "dependencies": {
    "@uptick7/dsh-message-edit": "link:/path/to/dsh-plugins/message-edit"
  },
  "dsh": {
    "profile": {
      "bundles": [
        "@uptick7/dsh-message-edit"
      ]
    }
  }
}
```

## Limitations

- This is an exclusion from the context, **not a physical deletion**: the append-only DSH journal keeps the original events. The journal viewer/export and history-reading tools may still show the old records.
- Executed commands, file changes, plugin state and other external effects are not rolled back.
- The protocol uses the regular prompt queue: the client accepting the request does not mean the server-side edit has already been applied. A host error is displayed as a turn error.
- The surface replacement happens in the pre-step. A subsequent provider error does not restore the old branch automatically.
- The UI hides whole turns. If several user messages ended up in one turn, the saved part of that turn may be hidden visually as well; the model surface is trimmed exactly from the selected message.

## Verification

Requires an installed DSH (the tests use a real DSH `Session` and the V4 codec, no model calls):

```sh
npm test
npm run check
```

By default the DSH installation is resolved via `npm root -g`. To use a different installation:

```sh
DSH_ROOT=/path/to/@deepseek-ai/dsh npm test
```

## Applying fixes

This package ships ready-made JS entry points: there is no separate TypeScript/Vite build. If the profile references this directory (`link:`), reinstalling the package is not needed. Reload the host plugin via plugin management (if available) or restart `dsh web`, then refresh the GUI page. A single browser refresh does not guarantee that the server module is reloaded.

For an npm-installed plugin, pick up a fix by updating the package in the Plugin Manager or with `dsh plugin --profile web add -w @uptick7/dsh-message-edit@latest`, then restart the host.

A fix does not rewrite invalid events that a previous version may have created. Run the first check in a fresh test session.

Manual verification after the fixes are loaded:

1. In a test session, send several messages with clearly distinguishable responses.
2. Edit the middle message: the earlier history must remain, the selected message and the tail must disappear, and the new version must receive a response.
3. Edit the corrected message again, then an earlier preserved message.
4. Reload the page and make sure the result has not changed.
5. Repeat with an attachment; messages must not be hidden in a neighboring open session.

Version 1.5.1 fixes the `developer/message turn must be a non-negative safe integer` error and related re-editing issues.
