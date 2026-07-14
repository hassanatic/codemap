#!/usr/bin/env bash
# codemap installer. Clones (or updates) codemap into ~/.codemap, builds it,
# and puts a `codemap` command on your PATH.
#
#   curl -fsSL https://raw.githubusercontent.com/hassanatic/codemap/main/install.sh | bash

set -euo pipefail

REPO_URL="${CODEMAP_REPO_URL:-https://github.com/hassanatic/codemap.git}"
DEST="${CODEMAP_HOME:-$HOME/.codemap}"

for tool in git node npm; do
  if ! command -v "$tool" >/dev/null 2>&1; then
    echo "error: $tool is required" >&2
    exit 1
  fi
done

NODE_MAJOR=$(node -p 'process.versions.node.split(".")[0]')
if [ "$NODE_MAJOR" -lt 20 ]; then
  echo "error: node 20 or newer is required (you have $(node --version))" >&2
  exit 1
fi

if [ -d "$DEST/.git" ]; then
  echo "updating codemap in $DEST"
  git -C "$DEST" pull --ff-only
else
  echo "installing codemap into $DEST"
  git clone --depth 1 "$REPO_URL" "$DEST"
fi

cd "$DEST"
npm install --no-fund --no-audit --silent
npm run build >/dev/null

# put a `codemap` shim on the PATH
SHIM_BODY="#!/bin/sh
exec node \"$DEST/scripts/cli.mjs\" \"\$@\""

INSTALLED=""
for BIN_DIR in /opt/homebrew/bin /usr/local/bin "$HOME/.local/bin"; do
  if [ -d "$BIN_DIR" ] && [ -w "$BIN_DIR" ]; then
    printf '%s\n' "$SHIM_BODY" > "$BIN_DIR/codemap"
    chmod +x "$BIN_DIR/codemap"
    INSTALLED="$BIN_DIR"
    break
  fi
done
if [ -z "$INSTALLED" ]; then
  mkdir -p "$HOME/.local/bin"
  printf '%s\n' "$SHIM_BODY" > "$HOME/.local/bin/codemap"
  chmod +x "$HOME/.local/bin/codemap"
  INSTALLED="$HOME/.local/bin"
fi

echo
echo "codemap installed: $INSTALLED/codemap"
case ":$PATH:" in
  *":$INSTALLED:"*) ;;
  *)
    echo "note: $INSTALLED is not on your PATH. Add this to your shell profile:"
    echo "  export PATH=\"$INSTALLED:\$PATH\""
    ;;
esac
echo
echo "next: cd into any project and run"
echo "  codemap up --summaries"
