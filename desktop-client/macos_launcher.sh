#!/bin/bash
set -euo pipefail

PROJECT_ROOT="$(cd "$(dirname "$0")" && pwd)"
LOG_DIR="$HOME/Library/Logs/BXB Client"
GUI_LOG="$LOG_DIR/gui.log"
mkdir -p "$LOG_DIR"
touch "$GUI_LOG"

python_meets_requirement() {
  local candidate="$1"
  "$candidate" -c 'import sys; raise SystemExit(0 if sys.version_info >= (3, 10) else 1)' >/dev/null 2>&1
}

find_python() {
  for candidate in \
    "/Library/Frameworks/Python.framework/Versions/3.12/bin/python3" \
    "/opt/homebrew/bin/python3" \
    "/usr/local/bin/python3" \
    "$(command -v python3 2>/dev/null || true)"
  do
    if [ -n "${candidate:-}" ] && [ -x "$candidate" ] && python_meets_requirement "$candidate"; then
      echo "$candidate"
      return 0
    fi
  done

  return 1
}

launch_gui() {
  local python_bin="$1"
  export BXB_RUNTIME_BOOTSTRAPPED=1
  nohup "$python_bin" "$PROJECT_ROOT/banxuebang_gui.py" >>"$GUI_LOG" 2>&1 < /dev/null &
}

PYTHON_BIN="$(find_python || true)"
if [ -n "${PYTHON_BIN:-}" ] && "$PYTHON_BIN" "$PROJECT_ROOT/bootstrap_runtime.py" --mode gui --check-only >/dev/null 2>&1; then
  launch_gui "$PYTHON_BIN"
  exit 0
fi

VISIBLE_SCRIPT="$PROJECT_ROOT/macos_bootstrap_and_launch.command"

if command -v osascript >/dev/null 2>&1; then
  osascript <<EOF
tell application "Terminal"
  activate
  do script (quoted form of "$VISIBLE_SCRIPT")
end tell
EOF
else
  open -a Terminal "$VISIBLE_SCRIPT"
fi
