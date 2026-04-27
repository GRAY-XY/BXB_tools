#!/bin/bash
set -euo pipefail

SCRIPT_ROOT="$(cd "$(dirname "$0")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_ROOT/../../.." && pwd)"
APP_NAME="BXB Student"
APP_ID="com.grayxy.bxbstudent"
BUILD_ROOT="$PROJECT_ROOT/build/desktop-shell"
RUNTIME_ROOT="$BUILD_ROOT/runtime"
NPM_RUNTIME_ROOT="$BUILD_ROOT/npm-runtime"
PKG_RESOURCES_ROOT="$BUILD_ROOT/pkg-resources"
COMPONENT_PKG_PATH="$BUILD_ROOT/${APP_NAME}.component.pkg"
DIST_XML_PATH="$BUILD_ROOT/distribution.xml"
PLAYWRIGHT_CACHE_ROOT="${PLAYWRIGHT_CACHE_ROOT:-$HOME/Library/Caches/ms-playwright}"
NODE_BIN="${NODE_BIN:-$(command -v node)}"
PYTHON_BIN="${PYTHON_BIN:-python3}"
VERSION="$("$PYTHON_BIN" -c 'import json, pathlib; print(json.loads(pathlib.Path("package.json").read_text(encoding="utf-8"))["version"])' 2>/dev/null)"
BUILD_STAMP="$(date +%Y%m%d-%H%M%S)"
DIST_ROOT="$PROJECT_ROOT/dist/desktop-shell-release-$BUILD_STAMP"
APP_PATH="$DIST_ROOT/${APP_NAME}.app"
PKG_VERSIONED_PATH="$DIST_ROOT/BXB_Student_macOS_v${VERSION}.pkg"
PKG_ALIAS_PATH="$DIST_ROOT/BXB_Student_macOS.pkg"
PLAYWRIGHT_ARCHIVE="$RUNTIME_ROOT/ms-playwright.tar.gz"

if [ -z "${VERSION:-}" ]; then
  echo "Unable to resolve app version from package.json"
  exit 1
fi

if [ ! -x "$NODE_BIN" ]; then
  echo "Node binary not found."
  exit 1
fi

if [ ! -d "$PLAYWRIGHT_CACHE_ROOT/chromium-1217" ]; then
  echo "Missing Playwright Chromium cache: $PLAYWRIGHT_CACHE_ROOT/chromium-1217"
  exit 1
fi

pkill -f "$APP_NAME.app/Contents/MacOS/$APP_NAME" >/dev/null 2>&1 || true
pkill -f "desktop-shell/app.py" >/dev/null 2>&1 || true

mkdir -p "$DIST_ROOT" "$BUILD_ROOT" "$RUNTIME_ROOT/ms-playwright" "$NPM_RUNTIME_ROOT"
chmod -R u+w "$DIST_ROOT" "$BUILD_ROOT" >/dev/null 2>&1 || true
rm -rf "$DIST_ROOT" "$BUILD_ROOT"
mkdir -p "$DIST_ROOT" "$BUILD_ROOT" "$RUNTIME_ROOT/ms-playwright" "$NPM_RUNTIME_ROOT" "$PKG_RESOURCES_ROOT"

cp "$NODE_BIN" "$RUNTIME_ROOT/node"
chmod +x "$RUNTIME_ROOT/node"

for entry in chromium-1217; do
  if [ -d "$PLAYWRIGHT_CACHE_ROOT/$entry" ]; then
    rsync -a "$PLAYWRIGHT_CACHE_ROOT/$entry" "$RUNTIME_ROOT/ms-playwright/"
  fi
done

(cd "$RUNTIME_ROOT" && tar -czf "$PLAYWRIGHT_ARCHIVE" ms-playwright)
rm -rf "$RUNTIME_ROOT/ms-playwright"

cp "$PROJECT_ROOT/package.json" "$NPM_RUNTIME_ROOT/package.json"
cp "$PROJECT_ROOT/package-lock.json" "$NPM_RUNTIME_ROOT/package-lock.json"
(cd "$NPM_RUNTIME_ROOT" && npm ci --omit=dev)

"$PYTHON_BIN" -m PyInstaller \
  --noconfirm \
  --clean \
  --windowed \
  --name "$APP_NAME" \
  --icon "$PROJECT_ROOT/desktop-shell/assets/app-icon.icns" \
  --osx-bundle-identifier "$APP_ID" \
  --distpath "$DIST_ROOT" \
  --workpath "$BUILD_ROOT/pyinstaller" \
  --specpath "$BUILD_ROOT/spec" \
  --hidden-import webview.platforms.cocoa \
  --add-data "$PROJECT_ROOT/desktop-shell:desktop-shell" \
  --add-data "$PROJECT_ROOT/config:config" \
  --add-data "$PROJECT_ROOT/docs:docs" \
  --add-data "$PROJECT_ROOT/src:src" \
  --add-data "$PROJECT_ROOT/package.json:." \
  --add-data "$PROJECT_ROOT/package-lock.json:." \
  --add-data "$NPM_RUNTIME_ROOT/node_modules:node_modules" \
  --add-data "$PLAYWRIGHT_ARCHIVE:runtime" \
  --add-binary "$RUNTIME_ROOT/node:runtime" \
  "$PROJECT_ROOT/desktop-shell/app.py"

codesign --force --deep --sign - "$APP_PATH" >/dev/null 2>&1 || true

cp "$PROJECT_ROOT/docs/legal/BXB_Student_User_Agreement_Installer_zh-CN.txt" "$PKG_RESOURCES_ROOT/License.txt"

pkgbuild \
  --component "$APP_PATH" \
  --install-location /Applications \
  --identifier "$APP_ID" \
  --version "$VERSION" \
  "$COMPONENT_PKG_PATH"

productbuild --synthesize --package "$COMPONENT_PKG_PATH" "$DIST_XML_PATH"

"$PYTHON_BIN" - <<'PY'
from pathlib import Path
import re

dist_path = Path("build/desktop-shell/distribution.xml")
xml = dist_path.read_text(encoding="utf-8")
title_tag = "    <title>BXB Student</title>"
license_tag = '    <license file="License.txt"/>'
if "License.txt" not in xml and "<installer-gui-script" in xml:
    match = re.search(r"(<installer-gui-script[^>]*>)", xml)
    if match:
        insertion = f"{match.group(1)}\n{title_tag}\n{license_tag}"
        xml = xml.replace(match.group(1), insertion, 1)
dist_path.write_text(xml, encoding="utf-8")
PY

productbuild \
  --distribution "$DIST_XML_PATH" \
  --resources "$PKG_RESOURCES_ROOT" \
  --package-path "$BUILD_ROOT" \
  "$PKG_VERSIONED_PATH"

cp -f "$PKG_VERSIONED_PATH" "$PKG_ALIAS_PATH"

echo "[BXB Build] App bundle created at $APP_PATH"
echo "[BXB Build] PKG created at $PKG_VERSIONED_PATH"
