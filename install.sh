#!/usr/bin/env bash
# Links the ooze-xfer and ooze-deploy commands into ~/.local/bin. Moves and deletes nothing.
set -euo pipefail

HERE="$(cd "$(dirname "$(readlink -f "${BASH_SOURCE[0]}" 2>/dev/null || echo "${BASH_SOURCE[0]}")")" && pwd)"
BIN="${OOZE_BIN_DIR:-$HOME/.local/bin}"

command -v rsync >/dev/null || { echo "ooze-o-meter: rsync is missing. Install it, then run this again." >&2; exit 1; }
command -v python3 >/dev/null || { echo "ooze-o-meter: python3 is missing. Install it, then run this again." >&2; exit 1; }

mkdir -p "$BIN" "$HOME/.claude/ooze"
for CMD in ooze-xfer ooze-deploy; do
  LINK="$BIN/$CMD"
  chmod +x "$HERE/bin/$CMD"
  if [ -L "$LINK" ] || [ ! -e "$LINK" ]; then
    ln -sfn "$HERE/bin/$CMD" "$LINK"
    echo "Linked $LINK"
  else
    echo "ooze-o-meter: $LINK already exists and isn't a link. Left it alone." >&2
    exit 1
  fi
done

case ":$PATH:" in
  *":$BIN:"*) echo "Ready. Try: ooze-xfer --label \"Test\" -a ./some-folder/ ./copy/" ;;
  *) echo "Add this line to your shell profile, then open a new terminal:"
     echo "  export PATH=\"$BIN:\$PATH\"" ;;
esac
