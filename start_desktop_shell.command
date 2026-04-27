#!/bin/bash
set -euo pipefail

PROJECT_ROOT="$(cd "$(dirname "$0")" && pwd)"
cd "$PROJECT_ROOT"

python3 -m pip install -r desktop-shell/requirements.txt
python3 desktop-shell/app.py
