#!/bin/bash
set -euo pipefail

if [[ $# -ne 1 || ! -d "$1/Contents/Resources/BXBRuntime" ]]; then
  echo "Usage: test-macos-bundle.sh /path/to/BXB Homework.app" >&2
  exit 1
fi
repo_root="$(cd "$(dirname "$0")/../.." && pwd)"
app_path="$(cd "$1" && pwd)"
test_root="$(mktemp -d "${TMPDIR:-/tmp}/bxb-bundle-test.XXXXXX")"
trap 'rm -rf "$test_root"' EXIT

# Work on a relocated copy, never modify the app that will be signed/shipped.
ditto "$app_path" "$test_root/Relocated Homework.app"
test_app="$test_root/Relocated Homework.app"
executable_name="$(/usr/libexec/PlistBuddy -c 'Print :CFBundleExecutable' "$test_app/Contents/Info.plist")"
smoke_executable="$test_app/Contents/MacOS/$executable_name"
sources="$repo_root/apps/macos/swiftui/BXBHomework/Shared"
cat "$sources/NodeBackendClient.swift" "$repo_root/apps/macos/swiftui/Runtime/RuntimeLocatorSmoke.swift" > "$test_root/Locator.swift"
xcrun swiftc -swift-version 6 -parse-as-library "$sources/JSONValue.swift" "$test_root/Locator.swift" -o "$smoke_executable"
# Decoy developer overrides must not redirect bundled resource discovery.
BXB_REPO_ROOT="$repo_root" BXB_NODE_EXECUTABLE=/missing/developer/node "$smoke_executable"
mv "$test_app/Contents/Helpers/node" "$test_root/saved-node"
BXB_REPO_ROOT="$repo_root" "$smoke_executable" --expect-incomplete
mv "$test_root/saved-node" "$test_app/Contents/Helpers/node"

mkdir "$test_root/home"
xcrun swiftc -swift-version 6 -parse-as-library "$sources/JSONValue.swift" "$sources/NodeBackendClient.swift" \
  "$repo_root/apps/macos/swiftui/Runtime/PackagedBridgeSmoke.swift" -o "$smoke_executable"
# The smoke checks Foundation's home before starting any backend process.
env -i PATH=/usr/bin:/bin:/usr/sbin:/sbin HOME="$test_root/home" \
  CFFIXED_USER_HOME="$test_root/home" BXB_SMOKE_HOME="$test_root/home" "$smoke_executable"

env -i PATH=/usr/bin:/bin:/usr/sbin:/sbin HOME="$test_root/home" \
  "$app_path/Contents/Helpers/node" "$repo_root/release/scripts/smoke-macos-runtime.js" "$app_path"
