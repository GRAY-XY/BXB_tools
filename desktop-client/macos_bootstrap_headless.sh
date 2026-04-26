#!/bin/bash
set -Eeuo pipefail

PROJECT_ROOT="$(cd "$(dirname "$0")" && pwd)"
RESOURCES_ROOT="$(cd "$PROJECT_ROOT/.." && pwd)"
CONTENTS_ROOT="$(cd "$PROJECT_ROOT/../.." && pwd)"
FRAMEWORKS_ROOT="$CONTENTS_ROOT/Frameworks"
PYTHON_VERSION="3.14"
PYTHON_HOME="$FRAMEWORKS_ROOT/Python.framework/Versions/$PYTHON_VERSION"
PYTHON_BIN="$PYTHON_HOME/bin/python3"
PYTHON_SITE_PACKAGES="$RESOURCES_ROOT/site-packages"
LOG_DIR="$HOME/Library/Logs/BXB Client"
LOG_FILE="$LOG_DIR/launcher.log"
GUI_LOG="$LOG_DIR/gui.log"
mkdir -p "$LOG_DIR"
touch "$LOG_FILE" "$GUI_LOG"
exec > >(tee -a "$LOG_FILE") 2>&1

status() {
  printf '%s\n' "$1"
}

status "正在检测环境..."
if [ ! -x "$PYTHON_BIN" ]; then
  status "启动失败：应用内置 Python 运行时缺失。"
  exit 1
fi

export PYTHONHOME="$PYTHON_HOME"
export PYTHONPATH="$PYTHON_SITE_PACKAGES${PYTHONPATH:+:$PYTHONPATH}"
export PATH="$PYTHON_HOME/bin:$PATH"
export DYLD_FRAMEWORK_PATH="$FRAMEWORKS_ROOT${DYLD_FRAMEWORK_PATH:+:$DYLD_FRAMEWORK_PATH}"
status "检测到内置 Python: $PYTHON_BIN"
"$PYTHON_BIN" --version

status "正在检查并安装运行依赖，这一步可能会下载 Playwright/Chromium..."
"$PYTHON_BIN" "$PROJECT_ROOT/bootstrap_runtime.py" --mode gui

export BXB_RUNTIME_BOOTSTRAPPED=1
status "正在启动软件..."
nohup "$PYTHON_BIN" "$PROJECT_ROOT/banxuebang_gui.py" >>"$GUI_LOG" 2>&1 < /dev/null &
GUI_PID=$!
status "启动成功"
status "GUI PID: $GUI_PID"
exit 0
