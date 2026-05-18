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

python_supports_tkinter() {
  local candidate="$1"
  "$candidate" -c 'import tkinter' >/dev/null 2>&1
}

find_python() {
  local candidates=()
  local candidate
  shopt -s nullglob
  candidates+=("/Library/Frameworks/Python.framework/Versions/"*/bin/python3)
  shopt -u nullglob
  candidates+=(
    "/usr/local/bin/python3"
    "/opt/homebrew/bin/python3"
    "$(command -v python3 2>/dev/null || true)"
  )

  for candidate in "${candidates[@]}"; do
    if [ -n "${candidate:-}" ] && [ -x "$candidate" ] && python_meets_requirement "$candidate" && python_supports_tkinter "$candidate"; then
      echo "$candidate"
      return 0
    fi
  done

  return 1
}

find_python_launcher() {
  local python_bin="$1"
  local version=""
  local launcher_path=""
  local candidate

  version="$("$python_bin" -c 'import sys; print(f"{sys.version_info.major}.{sys.version_info.minor}")' 2>/dev/null || true)"
  if [ -n "$version" ]; then
    launcher_path="/Applications/Python $version/Python Launcher.app"
    if [ -d "$launcher_path" ]; then
      echo "$launcher_path"
      return 0
    fi
  fi

  shopt -s nullglob
  for candidate in /Applications/Python*/Python\ Launcher.app; do
    if [ -d "$candidate" ]; then
      echo "$candidate"
      shopt -u nullglob
      return 0
    fi
  done
  shopt -u nullglob

  return 1
}

launch_gui() {
  local python_bin="$1"
  local launcher_app=""
  export BXB_RUNTIME_BOOTSTRAPPED=1
  launcher_app="$(find_python_launcher "$python_bin" || true)"
  if [ -n "$launcher_app" ]; then
    open -a "$launcher_app" "$PROJECT_ROOT/banxuebang_gui.py"
  else
    nohup "$python_bin" "$PROJECT_ROOT/banxuebang_gui.py" >>"$GUI_LOG" 2>&1 < /dev/null &
  fi
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
