#!/bin/bash
set -euo pipefail

SCRIPT_ROOT="$(cd "$(dirname "$0")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_ROOT/../.." && pwd)"
DIST_ROOT="$PROJECT_ROOT/dist/macos"
APP_NAME="BXB Client"
PYTHON_BIN="${PYTHON_BIN:-python3}"
if ! command -v "$PYTHON_BIN" >/dev/null 2>&1; then
  PYTHON_BIN="python"
fi
MACOS_RUNTIME_PYTHON="/Library/Frameworks/Python.framework/Versions/3.14/bin/python3"
MACOS_RUNTIME_VERSION="3.14"
APP_VERSION="$("$PYTHON_BIN" -c 'from app_metadata import APP_VERSION; print(APP_VERSION)')"
APP_DIR="$DIST_ROOT/$APP_NAME.app"
CONTENTS_DIR="$APP_DIR/Contents"
MACOS_DIR="$CONTENTS_DIR/MacOS"
RESOURCES_DIR="$CONTENTS_DIR/Resources"
FRAMEWORKS_DIR="$CONTENTS_DIR/Frameworks"
PAYLOAD_DIR="$RESOURCES_DIR/app"
SITE_PACKAGES_DIR="$RESOURCES_DIR/site-packages"
STAGING_DIR="$DIST_ROOT/dmg-staging"
DMG_PATH="$DIST_ROOT/BXB_Client_macOS_v${APP_VERSION}.dmg"
DMG_ALIAS_PATH="$DIST_ROOT/BXB_Client_macOS.dmg"
LAUNCHER_SOURCE="$PROJECT_ROOT/packaging/macos/Launcher.swift"
ICNS_PATH="$PROJECT_ROOT/assets/app_icon.icns"

if ! command -v hdiutil >/dev/null 2>&1; then
  echo "hdiutil is required to build a DMG."
  exit 1
fi

if [ ! -x "$MACOS_RUNTIME_PYTHON" ]; then
  echo "Bundled runtime source is missing: $MACOS_RUNTIME_PYTHON"
  exit 1
fi

mkdir -p "$MACOS_DIR" "$RESOURCES_DIR" "$FRAMEWORKS_DIR" "$DIST_ROOT"
rm -rf "$APP_DIR" "$STAGING_DIR" "$DMG_PATH" "$DMG_ALIAS_PATH"
mkdir -p "$MACOS_DIR" "$RESOURCES_DIR" "$FRAMEWORKS_DIR" "$STAGING_DIR"

if [ -f "$PROJECT_ROOT/generate_ui_assets.py" ]; then
  "$PYTHON_BIN" "$PROJECT_ROOT/generate_ui_assets.py" >/dev/null 2>&1 || true
fi

rsync -a \
  --delete \
  --exclude ".git" \
  --exclude ".github" \
  --exclude "__pycache__" \
  --exclude "build" \
  --exclude "dist" \
  "$PROJECT_ROOT/" "$PAYLOAD_DIR/"

rm -rf "$FRAMEWORKS_DIR/Python.framework" "$SITE_PACKAGES_DIR"
mkdir -p "$SITE_PACKAGES_DIR"
rsync -a "/Library/Frameworks/Python.framework/Versions/$MACOS_RUNTIME_VERSION/" "$FRAMEWORKS_DIR/Python.framework/Versions/$MACOS_RUNTIME_VERSION/"
ln -sfn "$MACOS_RUNTIME_VERSION" "$FRAMEWORKS_DIR/Python.framework/Versions/Current"
ln -sfn "Versions/Current/Headers" "$FRAMEWORKS_DIR/Python.framework/Headers"
ln -sfn "Versions/Current/Python" "$FRAMEWORKS_DIR/Python.framework/Python"
ln -sfn "Versions/Current/Resources" "$FRAMEWORKS_DIR/Python.framework/Resources"

install_name_tool -id "@rpath/Python.framework/Versions/$MACOS_RUNTIME_VERSION/Python" "$FRAMEWORKS_DIR/Python.framework/Versions/$MACOS_RUNTIME_VERSION/Python"
install_name_tool -change "/Library/Frameworks/Python.framework/Versions/$MACOS_RUNTIME_VERSION/Python" "@executable_path/../Python" "$FRAMEWORKS_DIR/Python.framework/Versions/$MACOS_RUNTIME_VERSION/bin/python3.14"
install_name_tool -change "/Library/Frameworks/Python.framework/Versions/$MACOS_RUNTIME_VERSION/Python" "@executable_path/../Python" "$FRAMEWORKS_DIR/Python.framework/Versions/$MACOS_RUNTIME_VERSION/bin/python3.14-intel64"
install_name_tool -change "/Library/Frameworks/Python.framework/Versions/$MACOS_RUNTIME_VERSION/Python" "@executable_path/../../../../Python" "$FRAMEWORKS_DIR/Python.framework/Versions/$MACOS_RUNTIME_VERSION/Resources/Python.app/Contents/MacOS/Python"

"$MACOS_RUNTIME_PYTHON" -m pip install --upgrade --target "$SITE_PACKAGES_DIR" "requests>=2.31" "playwright>=1.40"

chmod +x \
  "$PAYLOAD_DIR/macos_bootstrap_headless.sh" \
  "$PAYLOAD_DIR/macos_launcher.sh" \
  "$PAYLOAD_DIR/macos_bootstrap_and_launch.command" \
  "$PAYLOAD_DIR/start_gui.command" \
  "$PAYLOAD_DIR/start_cli.command" \
  "$PAYLOAD_DIR/bootstrap_runtime.py" \
  "$PAYLOAD_DIR/banxuebang_gui.py" \
  "$PAYLOAD_DIR/banxuebang.py"

swiftc "$LAUNCHER_SOURCE" -o "$MACOS_DIR/$APP_NAME"

if [ -f "$ICNS_PATH" ]; then
  cp "$ICNS_PATH" "$RESOURCES_DIR/app_icon.icns"
fi

cat > "$CONTENTS_DIR/Info.plist" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleDevelopmentRegion</key>
  <string>en</string>
  <key>CFBundleExecutable</key>
  <string>BXB Client</string>
  <key>CFBundleIdentifier</key>
  <string>com.igpig.bxbclient</string>
  <key>CFBundleInfoDictionaryVersion</key>
  <string>6.0</string>
  <key>CFBundleName</key>
  <string>BXB Client</string>
  <key>CFBundleDisplayName</key>
  <string>BXB Client</string>
  <key>CFBundlePackageType</key>
  <string>APPL</string>
  <key>CFBundleIconFile</key>
  <string>app_icon</string>
  <key>CFBundleShortVersionString</key>
  <string>${APP_VERSION}</string>
  <key>CFBundleVersion</key>
  <string>${APP_VERSION}</string>
  <key>LSMinimumSystemVersion</key>
  <string>12.0</string>
</dict>
</plist>
EOF

cp -R "$APP_DIR" "$STAGING_DIR/"
ln -s /Applications "$STAGING_DIR/Applications"

hdiutil create -volname "$APP_NAME $APP_VERSION" -srcfolder "$STAGING_DIR" -ov -format UDZO "$DMG_PATH"
cp -f "$DMG_PATH" "$DMG_ALIAS_PATH"

echo "[BXB Build] DMG created at $DMG_PATH"
