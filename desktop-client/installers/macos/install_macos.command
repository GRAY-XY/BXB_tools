#!/bin/bash
set -euo pipefail

SCRIPT_ROOT="$(cd "$(dirname "$0")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_ROOT/../.." && pwd)"
INSTALL_ROOT="$HOME/Applications/BXB Client"
DESKTOP_LINK="$HOME/Desktop/BXB Client.command"

echo "[BXB Installer] Installing to $INSTALL_ROOT"
mkdir -p "$HOME/Applications"
rm -rf "$INSTALL_ROOT"
mkdir -p "$INSTALL_ROOT"

rsync -a \
  --delete \
  --exclude ".git" \
  --exclude ".github" \
  --exclude "__pycache__" \
  --exclude "build" \
  --exclude "dist" \
  "$PROJECT_ROOT/" "$INSTALL_ROOT/"

chmod +x "$INSTALL_ROOT/start_gui.command"
chmod +x "$INSTALL_ROOT/start_cli.command"
chmod +x "$INSTALL_ROOT/installers/macos/uninstall_macos.command"

cat > "$DESKTOP_LINK" <<'EOF'
#!/bin/bash
set -euo pipefail
"$HOME/Applications/BXB Client/start_gui.command"
EOF
chmod +x "$DESKTOP_LINK"

echo "[BXB Installer] Installation complete."
echo "[BXB Installer] Desktop launcher: $DESKTOP_LINK"
