#!/bin/bash
set -euo pipefail

INSTALL_ROOT="$HOME/Applications/BXB Client"
DESKTOP_LINK="$HOME/Desktop/BXB Client.command"

rm -rf "$INSTALL_ROOT"
rm -f "$DESKTOP_LINK"

echo "[BXB Installer] Uninstall complete."
