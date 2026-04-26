#!/bin/bash
set -euo pipefail

SCRIPT_ROOT="$(cd "$(dirname "$0")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_ROOT/../.." && pwd)"
DIST_ROOT="$PROJECT_ROOT/dist/macos"
APP_PATH="${APP_PATH:-$DIST_ROOT/BXB Client.app}"
DMG_PATH="${DMG_PATH:-$DIST_ROOT/BXB_Client_macOS_v1.0.0.dmg}"
ENTITLEMENTS_PATH="${ENTITLEMENTS_PATH:-$SCRIPT_ROOT/entitlements.plist}"
CODESIGN_IDENTITY="${CODESIGN_IDENTITY:-}"
NOTARYTOOL_PROFILE="${NOTARYTOOL_PROFILE:-}"
APPLE_ID="${APPLE_ID:-}"
TEAM_ID="${TEAM_ID:-}"
APP_PASSWORD="${APP_PASSWORD:-}"

if [ ! -d "$APP_PATH" ]; then
  echo "App bundle not found: $APP_PATH"
  exit 1
fi

if [ -z "$CODESIGN_IDENTITY" ]; then
  CODESIGN_IDENTITY="-"
  SIGN_RUNTIME=0
  echo "[macOS sign] No Developer ID identity provided. Falling back to ad-hoc signing."
else
  SIGN_RUNTIME=1
fi

sign_file() {
  local target="$1"
  local -a cmd=(codesign --force --timestamp)
  if [ "$SIGN_RUNTIME" -eq 1 ]; then
    cmd+=(--options runtime --entitlements "$ENTITLEMENTS_PATH")
  fi
  cmd+=(--sign "$CODESIGN_IDENTITY" "$target")
  "${cmd[@]}"
}

echo "[macOS sign] Signing nested binaries..."
while IFS= read -r -d '' path; do
  sign_file "$path"
done < <(
  find "$APP_PATH" -type f \
    \( -name "*.dylib" -o -name "*.so" -o -perm -111 \) \
    ! -path "*/Contents/_CodeSignature/*" \
    -print0
)

echo "[macOS sign] Signing nested bundles..."
while IFS= read -r bundle; do
  sign_file "$bundle"
done < <(
  find "$APP_PATH" \
    \( -name "*.framework" -o -name "*.app" -o -name "*.xpc" \) \
    -mindepth 1 \
    -print | awk '{ print length($0) ":" $0 }' | sort -rn | cut -d: -f2-
)

echo "[macOS sign] Signing app bundle..."
sign_file "$APP_PATH"

echo "[macOS sign] Verifying app signature..."
codesign --verify --deep --strict --verbose=2 "$APP_PATH"

if [ -f "$DMG_PATH" ]; then
  echo "[macOS sign] Signing DMG..."
  codesign --force --timestamp --sign "$CODESIGN_IDENTITY" "$DMG_PATH"
  codesign --verify --verbose=2 "$DMG_PATH"
fi

if [ "$SIGN_RUNTIME" -eq 1 ]; then
  if [ -n "$NOTARYTOOL_PROFILE" ]; then
    echo "[macOS sign] Submitting DMG for notarization using profile $NOTARYTOOL_PROFILE..."
    xcrun notarytool submit "$DMG_PATH" --keychain-profile "$NOTARYTOOL_PROFILE" --wait
    echo "[macOS sign] Stapling notarization tickets..."
    xcrun stapler staple "$APP_PATH"
    xcrun stapler staple "$DMG_PATH"
  elif [ -n "$APPLE_ID" ] && [ -n "$TEAM_ID" ] && [ -n "$APP_PASSWORD" ]; then
    echo "[macOS sign] Submitting DMG for notarization using Apple ID..."
    xcrun notarytool submit "$DMG_PATH" --apple-id "$APPLE_ID" --team-id "$TEAM_ID" --password "$APP_PASSWORD" --wait
    echo "[macOS sign] Stapling notarization tickets..."
    xcrun stapler staple "$APP_PATH"
    xcrun stapler staple "$DMG_PATH"
  else
    echo "[macOS sign] Developer ID signing complete. Skipping notarization because no notarytool credentials were provided."
  fi
else
  echo "[macOS sign] Ad-hoc signing complete. Notarization is unavailable without a Developer ID identity."
fi

echo "[macOS sign] Done."
