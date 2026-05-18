#!/bin/bash
set -Eeuo pipefail

PROJECT_ROOT="$(cd "$(dirname "$0")" && pwd)"
LOG_DIR="$HOME/Library/Logs/BXB Client"
LOG_FILE="$LOG_DIR/launcher.log"
GUI_LOG="$LOG_DIR/gui.log"
mkdir -p "$LOG_DIR"
touch "$LOG_FILE" "$GUI_LOG"
exec > >(tee -a "$LOG_FILE") 2>&1

on_error() {
  local exit_code="$1"
  local line_no="$2"
  echo
  echo "[BXB] Launch failed at line $line_no with exit code $exit_code."
  echo "[BXB] Full log: $LOG_FILE"
  echo "[BXB] Press Enter to close this window."
  read -r _
  exit "$exit_code"
}
trap 'on_error "$?" "$LINENO"' ERR

log() {
  printf '[BXB] %s\n' "$1"
}

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

close_terminal_window() {
  if [ "${TERM_PROGRAM:-}" != "Apple_Terminal" ]; then
    return 0
  fi

  osascript <<'EOF' >/dev/null 2>&1 &
tell application "Terminal"
  try
    close front window saving no
  end try
end tell
EOF
}

log "Launcher started."
log "Project root: $PROJECT_ROOT"
log "Log file: $LOG_FILE"
log "Checking Python..."
PYTHON_BIN="$(find_python || true)"
if [ -n "$PYTHON_BIN" ]; then
  log "Using Python: $PYTHON_BIN"
  "$PYTHON_BIN" --version
elif command -v python3 >/dev/null 2>&1; then
  FALLBACK_PYTHON="$(command -v python3)"
  log "Detected system Python but version is too old: $FALLBACK_PYTHON"
  "$FALLBACK_PYTHON" --version || true
fi

if [ -z "$PYTHON_BIN" ]; then
  if command -v brew >/dev/null 2>&1; then
    log "Python 3.10+ not found. Installing python@3.12 via Homebrew..."
    brew install python@3.12
    PYTHON_BIN="$(find_python || true)"
  else
    log "Homebrew not found."
  fi
fi

if [ -z "$PYTHON_BIN" ]; then
  echo "Python 3.10+ is required. Install Python or Homebrew, then rerun this launcher."
  exit 1
fi

log "Bootstrapping runtime dependencies. This may download packages and Chromium on first launch..."
"$PYTHON_BIN" "$PROJECT_ROOT/bootstrap_runtime.py" --mode gui

export BXB_RUNTIME_BOOTSTRAPPED=1
log "Starting GUI..."
PYTHON_LAUNCHER_APP="$(find_python_launcher "$PYTHON_BIN" || true)"
if [ -n "$PYTHON_LAUNCHER_APP" ]; then
  log "Opening GUI via $PYTHON_LAUNCHER_APP"
  open -a "$PYTHON_LAUNCHER_APP" "$PROJECT_ROOT/banxuebang_gui.py"
  log "GUI handed off to Python Launcher."
else
  nohup "$PYTHON_BIN" "$PROJECT_ROOT/banxuebang_gui.py" >>"$GUI_LOG" 2>&1 < /dev/null &
  GUI_PID=$!
  log "GUI started with PID $GUI_PID"
fi
sleep 1
log "Setup complete. Closing Terminal..."
close_terminal_window
exit 0
