# local-setup

Everything needed to reproduce this HUD setup on a machine, beyond the plugin
source itself (which is the repo root).

## What's here

| File | Installs to | Purpose |
|---|---|---|
| `setup.sh` | — | One-shot installer (see below) |
| `glm-wrapper.ts` | `~/.claude/scripts/glm-wrapper.ts` | Sits between Claude Code and claude-hud; injects GLM Coding Plan quota percentages into the Usage bar |
| `hud.config.json` | `~/.claude/plugins/claude-hud/config.json` | Display flags (tools/agents/todos lines, duration, session name, `showTranscriptSize`) |

## Quick setup

```bash
git clone https://github.com/ppezzull/claude-hud.git
cd claude-hud && bash local-setup/setup.sh
```

Requires `bun` and `python3` (macOS built-in). Restarts needed: the statusline
command is read when a Claude Code session starts.

## How the pieces fit

```
Claude Code statusline (~/.claude/settings.json)
  └─> bun ~/.claude/scripts/glm-wrapper.ts     ← injects GLM quota (reads token from env)
        └─> <repo>/src/index.ts                ← plugin source, run directly by bun
              └─> ~/.claude/plugins/claude-hud/config.json
```

This fork's additions on top of upstream claude-hud v0.1.0:

- `showTranscriptSize` config flag — shows the session transcript's exact size
  (e.g. `· 1.1MB`) next to the Context bar, formatted like the Claude Code
  session picker (`2.1KB` / `244.1KB` / `10.9MB`).

## Gotchas this setup defends against

- **`settings.local.json` overrides `settings.json`** — a stale `statusLine`
  there (e.g. left by an older `/claude-hud:setup`) silently bypasses the
  wrapper. `setup.sh` removes it.
- **Plugin updates** — the marketplace installs a new version dir and the
  wrapper switches to it, dropping this fork's patches. Re-run
  `bash local-setup/setup.sh` to reinstall.

## Secrets

None are stored in this repo. `glm-wrapper.ts` reads `ANTHROPIC_AUTH_TOKEN`
from the environment at render time; the token lives only in
`~/.claude/settings.json` (`env` block), which is never committed.
