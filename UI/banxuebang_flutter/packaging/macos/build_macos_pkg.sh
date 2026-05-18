#!/bin/bash
set -euo pipefail

SCRIPT_ROOT="$(cd "$(dirname "$0")" && pwd)"
FLUTTER_ROOT="$(cd "$SCRIPT_ROOT/../.." && pwd)"
WORKSPACE_ROOT="$(cd "$FLUTTER_ROOT/../.." && pwd)"

APP_NAME="BXB Student"
APP_ID="com.grayxy.bxbstudent"
BUILD_STAMP="$(date +%Y%m%d-%H%M%S)"
VERSION_LINE="$(grep '^version:' "$FLUTTER_ROOT/pubspec.yaml" | awk '{print $2}')"
VERSION="${VERSION_LINE%%+*}"

if [ -z "${VERSION:-}" ]; then
  echo "Unable to resolve version from $FLUTTER_ROOT/pubspec.yaml"
  exit 1
fi

BUILD_ROOT="$WORKSPACE_ROOT/build/banxuebang-flutter-macos"
RUNTIME_BUILD_ROOT="$BUILD_ROOT/runtime"
NPM_RUNTIME_ROOT="$BUILD_ROOT/npm-runtime"
PKG_RESOURCES_ROOT="$BUILD_ROOT/pkg-resources"
DIST_ROOT="$WORKSPACE_ROOT/dist/banxuebang-flutter-release-$BUILD_STAMP"
APP_SOURCE_ROOT="$FLUTTER_ROOT/build/macos/Build/Products/Release"
APP_SOURCE_PATH="$APP_SOURCE_ROOT/$APP_NAME.app"
APP_PATH="$DIST_ROOT/$APP_NAME.app"
COMPONENT_PKG_PATH="$BUILD_ROOT/${APP_NAME}.component.pkg"
DIST_XML_PATH="$BUILD_ROOT/distribution.xml"
PKG_VERSIONED_PATH="$DIST_ROOT/BXB_Student_macOS_v${VERSION}.pkg"
PKG_ALIAS_PATH="$DIST_ROOT/BXB_Student_macOS.pkg"
LEGAL_TEXT_PATH="$WORKSPACE_ROOT/docs/legal/BXB_Student_User_Agreement_Installer_zh-CN.txt"
PLAYWRIGHT_CACHE_ROOT="${PLAYWRIGHT_CACHE_ROOT:-$HOME/Library/Caches/ms-playwright}"
NODE_BIN="${NODE_BIN:-$(command -v node || true)}"
NPM_BIN="${NPM_BIN:-$(command -v npm || true)}"
FLUTTER_BIN="${FLUTTER_BIN:-$(command -v flutter || true)}"

if [ -z "${FLUTTER_BIN:-}" ] && [ -x "$HOME/.local/flutter/bin/flutter" ]; then
  FLUTTER_BIN="$HOME/.local/flutter/bin/flutter"
fi

HOST_ARCH="$(uname -m)"

if [ ! -x "${FLUTTER_BIN:-}" ]; then
  echo "Flutter binary not found."
  exit 1
fi

if [ ! -x "${NODE_BIN:-}" ]; then
  echo "Node binary not found."
  exit 1
fi

if [ ! -x "${NPM_BIN:-}" ]; then
  echo "npm binary not found."
  exit 1
fi

if [ ! -f "$LEGAL_TEXT_PATH" ]; then
  echo "Installer agreement text not found: $LEGAL_TEXT_PATH"
  exit 1
fi

PLAYWRIGHT_DIRS=()
while IFS= read -r entry; do
  PLAYWRIGHT_DIRS+=("$entry")
done < <(find "$PLAYWRIGHT_CACHE_ROOT" -maxdepth 1 -type d -name 'chromium-*' | sort)
if [ "${#PLAYWRIGHT_DIRS[@]}" -eq 0 ]; then
  echo "Missing Playwright Chromium cache under $PLAYWRIGHT_CACHE_ROOT"
  echo "Run: npx playwright install chromium"
  exit 1
fi

ensure_flutter_snapshot_alias() {
  local engine_root

  engine_root="$(cd "$(dirname "$FLUTTER_BIN")/cache/artifacts/engine/darwin-x64-release" && pwd)"
  if [ ! -f "$engine_root/gen_snapshot" ]; then
    return 0
  fi

  for snapshot_name in gen_snapshot_arm64 gen_snapshot_x64; do
    if [ ! -e "$engine_root/$snapshot_name" ]; then
      ln -sf gen_snapshot "$engine_root/$snapshot_name"
    fi
  done
}

rm -rf "$BUILD_ROOT" "$DIST_ROOT"
mkdir -p "$BUILD_ROOT" "$RUNTIME_BUILD_ROOT/ms-playwright" "$NPM_RUNTIME_ROOT" "$PKG_RESOURCES_ROOT" "$DIST_ROOT"

ensure_flutter_snapshot_alias

build_flutter_release() {
  case "$HOST_ARCH" in
    arm64)
      ARCHS=arm64 EXCLUDED_ARCHS=x86_64 ONLY_ACTIVE_ARCH=YES "$FLUTTER_BIN" build macos --release
      ;;
    x86_64)
      ARCHS=x86_64 EXCLUDED_ARCHS=arm64 ONLY_ACTIVE_ARCH=YES "$FLUTTER_BIN" build macos --release
      ;;
    *)
      "$FLUTTER_BIN" build macos --release
      ;;
  esac
}

pushd "$FLUTTER_ROOT" >/dev/null
build_flutter_release
popd >/dev/null

if [ ! -d "$APP_SOURCE_PATH" ]; then
  echo "Built app bundle not found: $APP_SOURCE_PATH"
  exit 1
fi

cp -R "$APP_SOURCE_PATH" "$APP_PATH"

cp -L "$NODE_BIN" "$RUNTIME_BUILD_ROOT/node"
chmod +x "$RUNTIME_BUILD_ROOT/node"

for entry in "${PLAYWRIGHT_DIRS[@]}"; do
  rsync -a "$entry/" "$RUNTIME_BUILD_ROOT/ms-playwright/$(basename "$entry")/"
done

cp "$WORKSPACE_ROOT/package.json" "$NPM_RUNTIME_ROOT/package.json"
cp "$WORKSPACE_ROOT/package-lock.json" "$NPM_RUNTIME_ROOT/package-lock.json"
(cd "$NPM_RUNTIME_ROOT" && "$NPM_BIN" ci --omit=dev)

APP_RUNTIME_ROOT="$APP_PATH/Contents/Resources/app_runtime"
mkdir -p "$APP_RUNTIME_ROOT/desktop-shell" "$APP_RUNTIME_ROOT/docs"

cp "$WORKSPACE_ROOT/desktop-shell/node_bridge.js" "$APP_RUNTIME_ROOT/desktop-shell/node_bridge.js"
rsync -a "$WORKSPACE_ROOT/src/" "$APP_RUNTIME_ROOT/src/"
rsync -a "$WORKSPACE_ROOT/docs/legal/" "$APP_RUNTIME_ROOT/docs/legal/"
cp "$WORKSPACE_ROOT/package.json" "$APP_RUNTIME_ROOT/package.json"
cp "$WORKSPACE_ROOT/package-lock.json" "$APP_RUNTIME_ROOT/package-lock.json"
rsync -a "$NPM_RUNTIME_ROOT/node_modules/" "$APP_RUNTIME_ROOT/node_modules/"
mkdir -p "$APP_RUNTIME_ROOT/runtime"
cp "$RUNTIME_BUILD_ROOT/node" "$APP_RUNTIME_ROOT/runtime/node"
chmod +x "$APP_RUNTIME_ROOT/runtime/node"
rsync -a "$RUNTIME_BUILD_ROOT/ms-playwright/" "$APP_RUNTIME_ROOT/runtime/ms-playwright/"

codesign --force --deep --sign - "$APP_PATH" >/dev/null 2>&1 || true

cp "$LEGAL_TEXT_PATH" "$PKG_RESOURCES_ROOT/License.txt"

pkgbuild \
  --component "$APP_PATH" \
  --install-location /Applications \
  --identifier "$APP_ID" \
  --version "$VERSION" \
  "$COMPONENT_PKG_PATH"

productbuild --synthesize --package "$COMPONENT_PKG_PATH" "$DIST_XML_PATH"

python3 - "$HOST_ARCH" <<'PY'
from pathlib import Path
import re
import sys

dist_path = Path("build/banxuebang-flutter-macos/distribution.xml")
xml = dist_path.read_text(encoding="utf-8")
host_arch = sys.argv[1]
title_tag = "    <title>BXB Student</title>"
license_tag = '    <license file="License.txt"/>'
if "License.txt" not in xml and "<installer-gui-script" in xml:
    match = re.search(r"(<installer-gui-script[^>]*>)", xml)
    if match:
        insertion = f"{match.group(1)}\n{title_tag}\n{license_tag}"
        xml = xml.replace(match.group(1), insertion, 1)
xml = re.sub(r'hostArchitectures="[^"]+"', f'hostArchitectures="{host_arch}"', xml)
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
