#!/usr/bin/env bash
# setup.sh — one-shot installer for this claude-hud fork + GLM statusline.
#
# Installs / repairs:
#   1. Plugin source      -> $CLAUDE_DIR/plugins/cache/claude-hud/claude-hud/<version>/
#   2. GLM quota wrapper  -> $CLAUDE_DIR/scripts/glm-wrapper.ts
#   3. HUD display config -> $CLAUDE_DIR/plugins/claude-hud/config.json
#   4. statusLine         -> $CLAUDE_DIR/settings.json, and removes any stale
#                            statusLine override from settings.local.json
#                            (local settings take precedence and silently
#                            bypass the wrapper — the #1 way this setup breaks)
#
# Credentials: none are read, written, or stored here. The wrapper reads
# ANTHROPIC_AUTH_TOKEN from the environment at render time; the token itself
# lives only in ~/.claude/settings.json env and is never committed.
#
# Usage: bash local-setup/setup.sh
set -euo pipefail

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CLAUDE_DIR="${CLAUDE_CONFIG_DIR:-$HOME/.claude}"
VERSION="$(sed -n 's/.*"version": *"\([^"]*\)".*/\1/p' "$REPO_DIR/package.json" | head -1)"
VERSION="${VERSION:-0.1.0}"
PLUGIN_DIR="$CLAUDE_DIR/plugins/cache/claude-hud/claude-hud/$VERSION"

# Resolve bun the same way glm-wrapper.ts does (PATH first, then well-known spots)
BUN="$(command -v bun 2>/dev/null || true)"
if [ -z "$BUN" ]; then
  for c in "$HOME/.bun/bin/bun" /opt/homebrew/bin/bun /usr/local/bin/bun; do
    [ -x "$c" ] && BUN="$c" && break
  done
fi
if [ -z "$BUN" ]; then
  echo "error: bun not found — install it first: curl -fsSL https://bun.sh/install | bash" >&2
  exit 1
fi

echo "Installing claude-hud $VERSION -> $PLUGIN_DIR"
mkdir -p "$PLUGIN_DIR" "$CLAUDE_DIR/scripts" "$CLAUDE_DIR/plugins/claude-hud"

# Plugin source (keep receiver's node_modules/dist if present; not needed to run)
rsync -a \
  --exclude .git --exclude local-setup --exclude node_modules --exclude dist \
  "$REPO_DIR/" "$PLUGIN_DIR/"

# Wrapper + HUD config
cp "$REPO_DIR/local-setup/glm-wrapper.ts" "$CLAUDE_DIR/scripts/glm-wrapper.ts"
cp "$REPO_DIR/local-setup/hud.config.json" "$CLAUDE_DIR/plugins/claude-hud/config.json"

# statusLine wiring — set it in settings.json, clear the override in settings.local.json
python3 - "$CLAUDE_DIR" "$BUN" <<'PY'
import json, os, sys

claude_dir, bun = sys.argv[1], sys.argv[2]
cmd = f'{bun} "{claude_dir}/scripts/glm-wrapper.ts"'

def edit(path, put):
    data = {}
    if os.path.exists(path):
        try:
            with open(path) as f:
                data = json.load(f)
        except json.JSONDecodeError:
            print(f"warning: {path} is not valid JSON — skipping (edit manually)")
            return
    if put:
        data["statusLine"] = {"type": "command", "command": cmd}
        msg = f"statusLine set -> {cmd}"
    elif "statusLine" in data:
        del data["statusLine"]
        msg = "stale statusLine override removed"
    else:
        return
    with open(path, "w") as f:
        json.dump(data, f, indent=2)
        f.write("\n")
    print(f"{path}: {msg}")

edit(os.path.join(claude_dir, "settings.local.json"), put=False)
edit(os.path.join(claude_dir, "settings.json"), put=True)
PY

echo
echo "Done. Restart any running Claude Code session (statusline is read at"
echo "startup), then send a message. You should see the Context bar with the"
echo "transcript size, e.g.:  Context █████░░░ 42% · 12.5KB | Usage █░░░░░ 13%"
