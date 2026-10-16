#!/bin/bash
set -euo pipefail

usage() {
  echo "Usage: build-swiftui-release.sh --version X.Y.Z --arch arm64|x86_64 [--output DIR] [--unsigned]"
}
version=""
architecture=""
output=""
unsigned=0
while [[ $# -gt 0 ]]; do
  case "$1" in
    --version|--arch|--output)
      [[ $# -ge 2 ]] || { usage >&2; exit 1; }
      case "$1" in --version) version="$2";; --arch) architecture="$2";; --output) output="$2";; esac
      shift 2;;
    --unsigned) unsigned=1; shift;;
    --help) usage; exit 0;;
    *) usage >&2; exit 1;;
  esac
done
[[ "$version" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]] || { echo "Invalid release version" >&2; exit 1; }
[[ "$architecture" == arm64 || "$architecture" == x86_64 ]] || { echo "Unsupported architecture" >&2; exit 1; }
[[ "$(uname -s)" == Darwin && "$(uname -m)" == "$architecture" ]] || {
  echo "Build on a native macOS $architecture runner (no mixed browser/native module architectures)" >&2; exit 1;
}
xcodebuild -version
if [[ "$unsigned" == 0 ]]; then
  : "${MACOS_SIGNING_IDENTITY:?Set MACOS_SIGNING_IDENTITY to your Developer ID Application identity}"
  : "${MACOS_NOTARY_PROFILE:?Set MACOS_NOTARY_PROFILE to a notarytool keychain profile}"
fi

repo_root="$(cd "$(dirname "$0")/../.." && pwd)"
output="${output:-$repo_root/dist/macos/$version/$architecture}"
[[ ! -e "$output" ]] || { echo "Output already exists: $output" >&2; exit 1; }
build_root="$(mktemp -d "${TMPDIR:-/tmp}/bxb-macos-release.XXXXXX")"
trap 'rm -rf "$build_root"' EXIT
node_version="$(tr -d 'v[:space:]' < "$repo_root/.nvmrc")"
[[ "$node_version" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]] || { echo "Invalid .nvmrc" >&2; exit 1; }
node_arch="$architecture"
[[ "$architecture" != x86_64 ]] || node_arch=x64
node_dist="node-v$node_version-darwin-$node_arch"
node_archive="$node_dist.tar.gz"
node_url="https://nodejs.org/dist/v$node_version"
curl --fail --location --retry 3 "$node_url/$node_archive" -o "$build_root/$node_archive"
curl --fail --location --retry 3 "$node_url/SHASUMS256.txt" -o "$build_root/SHASUMS256.txt"
(cd "$build_root" && awk -v name="$node_archive" '$2 == name {print}' SHASUMS256.txt > node-checksum.txt && \
  test -s node-checksum.txt && shasum -a 256 -c node-checksum.txt)
tar -xzf "$build_root/$node_archive" -C "$build_root"
node_binary="$build_root/$node_dist/bin/node"
expected_node_arch="$node_arch"
[[ "$architecture" != arm64 ]] || expected_node_arch=arm64
[[ "$("$node_binary" -p 'process.arch')" == "$expected_node_arch" ]] || { echo "Wrong Node architecture" >&2; exit 1; }

xcodebuild -project "$repo_root/apps/macos/swiftui/BXBHomework.xcodeproj" -scheme BXBHomework \
  -configuration Release -destination 'generic/platform=macOS' -derivedDataPath "$build_root/DerivedData" \
  ARCHS="$architecture" ONLY_ACTIVE_ARCH=NO MACOSX_DEPLOYMENT_TARGET=15.0 \
  MARKETING_VERSION="$version" CURRENT_PROJECT_VERSION="${MACOS_BUILD_NUMBER:-1}" \
  BXB_PACKAGE_RUNTIME_EXTERNALLY=YES CODE_SIGNING_ALLOWED=NO build
app_path="$build_root/image/BXB Homework.app"
mkdir -p "$build_root/image"
ditto "$build_root/DerivedData/Build/Products/Release/BXB Homework.app" "$app_path"
"$node_binary" "$repo_root/release/scripts/stage-macos-runtime.js" \
  --repo "$repo_root" --app "$app_path" --node "$node_binary" --version "$version"
runtime="$app_path/Contents/Resources/BXBRuntime"
cp "$build_root/$node_dist/LICENSE" "$runtime/Node-LICENSE"
browsers="$app_path/Contents/Resources/Playwright"
mkdir -p "$browsers"
# Use the pinned bundled interpreter for npm's scripts and native dependencies.
export PATH="$build_root/$node_dist/bin:$PATH"
(cd "$runtime" && "$node_binary" "$build_root/$node_dist/lib/node_modules/npm/bin/npm-cli.js" \
  ci --omit=dev --no-audit --no-fund)
PLAYWRIGHT_BROWSERS_PATH="$browsers" "$node_binary" "$runtime/node_modules/playwright/cli.js" install chromium
rm -rf "$browsers/.links"
bash "$repo_root/release/scripts/test-macos-bundle.sh" "$app_path"

notary_args=(--keychain-profile "${MACOS_NOTARY_PROFILE:-}")
signing_args=()
if [[ -n "${MACOS_SIGNING_KEYCHAIN:-}" ]]; then
  signing_args=(--keychain "$MACOS_SIGNING_KEYCHAIN")
  notary_args+=(--keychain "$MACOS_SIGNING_KEYCHAIN")
fi
notarize() {
  local target="$1"
  xcrun notarytool submit "$target" "${notary_args[@]}" --wait --output-format json > "$build_root/notary-result.json"
  if ! python3 -c 'import json,sys; sys.exit(json.load(open(sys.argv[1])).get("status") != "Accepted")' "$build_root/notary-result.json"; then
    local submission_id
    submission_id="$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1]))["id"])' "$build_root/notary-result.json")"
    xcrun notarytool log "$submission_id" "${notary_args[@]}" "$build_root/notary-failure.json"
    cat "$build_root/notary-failure.json" >&2
    exit 1
  fi
}
suffix=""
if [[ "$unsigned" == 0 ]]; then
  python3 "$repo_root/release/scripts/sign-macos-app.py" --app "$app_path" \
    --identity "$MACOS_SIGNING_IDENTITY" --entitlements "$repo_root/release/macos/javascript-runtime.entitlements.plist" ${signing_args[@]+"${signing_args[@]}"}
  # Re-run Node/Chromium after hardened-runtime signing.
  "$app_path/Contents/Helpers/node" "$repo_root/release/scripts/smoke-macos-runtime.js" "$app_path"
  ditto -c -k --keepParent "$app_path" "$build_root/notarize-app.zip"
  notarize "$build_root/notarize-app.zip"
  xcrun stapler staple "$app_path"
  xcrun stapler validate "$app_path"
  spctl --assess --type execute --verbose=2 "$app_path"
else
  suffix="-unsigned"
fi
ln -s /Applications "$build_root/image/Applications"
artifact_name="BXBHomework-v$version-macos-$architecture$suffix.dmg"
hdiutil create -volname 'BXB Homework' -srcfolder "$build_root/image" -format UDZO "$build_root/$artifact_name"
if [[ "$unsigned" == 0 ]]; then
  codesign --force --sign "$MACOS_SIGNING_IDENTITY" --timestamp ${signing_args[@]+"${signing_args[@]}"} "$build_root/$artifact_name"
  notarize "$build_root/$artifact_name"
  xcrun stapler staple "$build_root/$artifact_name"
  xcrun stapler validate "$build_root/$artifact_name"
  spctl --assess --type open --context context:primary-signature --verbose=2 "$build_root/$artifact_name"
fi
hdiutil verify "$build_root/$artifact_name"
mkdir -p "$output"
cp "$build_root/$artifact_name" "$output/"
(cd "$output" && shasum -a 256 "$artifact_name" > "$artifact_name.sha256")
echo "Built $output/$artifact_name"
