#!/bin/bash
set -euo pipefail

PROJECT_ROOT="$(cd "$(dirname "$0")" && pwd)"

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

PYTHON_BIN="$(find_python || true)"
if [ -z "$PYTHON_BIN" ]; then
  if command -v brew >/dev/null 2>&1; then
    echo "Python 3.10+ not found. Installing via Homebrew..."
    brew install python@3.12
    PYTHON_BIN="$(find_python || true)"
  fi
fi

if [ -z "$PYTHON_BIN" ]; then
  echo "Python 3.10+ is required. Install Python or Homebrew, then rerun this launcher."
  exit 1
fi

"$PYTHON_BIN" "$PROJECT_ROOT/bootstrap_runtime.py" --mode cli
export BXB_RUNTIME_BOOTSTRAPPED=1
"$PYTHON_BIN" "$PROJECT_ROOT/banxuebang.py" "$@"
