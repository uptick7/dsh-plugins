English | [Русский](README.ru.md)

# Commands bridge (`@local/commands-bridge`)

A bridge between markdown commands and the Harness slash-command registry, plus a **Settings → Commands** page.

## What it does

- Registers commands from markdown files in `ctx.commands`:
  - **Agent** — `~/.dsh/commands` (the agent's own root);
  - **Shared** — `~/.agents/commands` (shared by all agents on the machine);
  - **Project** — `<session working directory>/.agents/commands` (a per-agent scope; it takes priority over globals with the same name).
- Invoking `/name arguments` re-reads the file, substitutes `$ARGUMENTS` and `$1`–`$9` (when there are no placeholders, the arguments are appended to the end) and sends the prompt to the agent as an ordinary user message (`agent.steer`). Runs are written to the session log (`command/run` / `command/done`).
- Commands with a description and an argument-hint automatically appear in the composer's `/` menu.
- File changes in the watched directories are picked up on the fly (fs.watch + rescan).

## The Settings → Commands page

- Groups: "Agent commands", "Shared commands", "Project commands" (one per working directory of each open session), "Plugin commands" (read-only: what other plugins have registered — `/plan`, `/compact`, etc.; their lifecycle is managed by their own plugin).
- For each command: `/name`, the argument-hint (if set), the description (if set) and an enable/disable toggle.
- Disabled commands remain on disk but are not registered in the registry. Toggle state is stored in a JSON file (by default `~/.agents/commands-bridge.json`, key `<kind>:<name>` — shared across all project directories).

## Command file format

```markdown
---
description: Short description for the menu and the commands page
argument-hint: KEY [cases]
---

Prompt text. Arguments: $ARGUMENTS, positional: $1 $2
```

The frontmatter is optional; the command name is the file name without `.md` (lowercase, `a-z0-9_-`).

## Config (cordis.patch.yml)

```yaml
- insert:
    - id: commands-bridge
      name: '@local/commands-bridge'
      config:
        globalDirs: ['~/.agents/commands']   # directories shared by all agents
        agentDirs: ['~/.dsh/commands']       # this agent's directories
        projectSubdir: '.agents/commands'    # subdirectory inside the session working directory
        stateFile: '~/.agents/commands-bridge.json' # toggle state file
```

## Limitations

- Project commands are bound to the working directory as of agent creation; changing the directory within a live session is not tracked (it is refreshed after the session is reopened).
- A toggle for a project command applies to all projects (the key has no path).
- The settings page is part of the web GUI; in profiles without `commands`/`webServer` the corresponding features are simply not activated.
- Positional arguments `$1`–`$9` are split on whitespace; quotes are stripped only around a whole word. Use `$ARGUMENTS` for the entire argument text.

## Verification

```bash
npm run check && npm test
```
