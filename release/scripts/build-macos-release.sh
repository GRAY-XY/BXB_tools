#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd -- "$SCRIPT_DIR/../.." && pwd)"
APP_DIR="$REPO_ROOT/apps/macos"
OUTPUT_DIR="$REPO_ROOT/release/artifacts/macos"
APP_VERSION="$(node -p "require('$APP_DIR/package.json').version")"
WINDOWS_VERSION="$(node -p "require('$REPO_ROOT/apps/legacy/electron/package.json').version")"
RELEASE_TAG="${1:-}"

if [[ "$(uname -s)" != "Darwin" ]]; then
  echo "macOS release packaging must run on macOS." >&2
  exit 1
fi

if [[ "$WINDOWS_VERSION" != "$APP_VERSION" ]]; then
  echo "Windows version $WINDOWS_VERSION and macOS version $APP_VERSION do not match." >&2
  echo "Align both app versions before creating a shared desktop release." >&2
  exit 1
fi

if [[ -n "$RELEASE_TAG" ]]; then
  case "$RELEASE_TAG" in
    bxb-homework-v*) TAG_VERSION="${RELEASE_TAG#bxb-homework-v}" ;;
    v*) TAG_VERSION="${RELEASE_TAG#v}" ;;
    *)
      echo "Release tag must be v<version> or bxb-homework-v<version>." >&2
      exit 1
      ;;
  esac
  if [[ "$TAG_VERSION" != "$APP_VERSION" ]]; then
    echo "Tag version $TAG_VERSION does not match apps/macos/package.json version $APP_VERSION." >&2
    echo "Update the app version and create a matching release tag before packaging." >&2
    exit 1
  fi
fi

if [[ ! -x "$APP_DIR/node_modules/.bin/electron-builder" ]]; then
  echo "macOS app dependencies are missing. Run npm ci --prefix apps/macos first." >&2
  exit 1
fi
if [[ ! -d "$REPO_ROOT/node_modules/playwright" ]]; then
  echo "Root dependencies are missing. Run npm ci from the repository root first." >&2
  exit 1
fi

(
  cd "$REPO_ROOT"
  npm run scan:publish
)

case "$OUTPUT_DIR" in
  "$REPO_ROOT/release/artifacts/macos") ;;
  *) echo "Refusing to clean an unexpected output path: $OUTPUT_DIR" >&2; exit 1 ;;
esac
rm -rf "$OUTPUT_DIR"
mkdir -p "$OUTPUT_DIR"

echo "Building BXB Homework $APP_VERSION for Intel and Apple silicon..."
npm --prefix "$APP_DIR" run dist:mac

shopt -s nullglob
DMG_FILES=("$OUTPUT_DIR"/*.dmg)
if (( ${#DMG_FILES[@]} == 0 )); then
  echo "No DMG files were produced under $OUTPUT_DIR." >&2
  exit 1
fi

for dmg_file in "${DMG_FILES[@]}"; do
  dmg_name="$(basename "$dmg_file")"
  (
    cd "$OUTPUT_DIR"
    shasum -a 256 "$dmg_name" > "$dmg_name.sha256"
  )
done

echo "macOS release files are ready in $OUTPUT_DIR"
