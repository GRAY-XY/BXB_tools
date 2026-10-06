#!/usr/bin/env bash
set -euo pipefail

repo_root="${1:?Usage: package-swiftui-runtime.sh <repo-root> <app-contents> <target-archs>}"
app_contents="${2:?Usage: package-swiftui-runtime.sh <repo-root> <app-contents> <target-archs>}"
target_archs="${3:-$(uname -m)}"

node_modules_source="$repo_root/node_modules"
backend_source="$repo_root/backend"
manifest_source="$repo_root/package.json"
bridge_source="$repo_root/apps/macos/swiftui/Runtime/macos-backend.js"

for required_path in "$node_modules_source" "$backend_source/bridge/winui-backend.js" "$backend_source/src" "$manifest_source" "$bridge_source"; do
  if [[ ! -e "$required_path" ]]; then
    printf 'SwiftUI runtime packaging failed: required path is missing: %s\n' "$required_path" >&2
    printf 'Run npm ci from the repository root, then build the BXBHomework scheme again.\n' >&2
    exit 1
  fi
done

node_executable="${BXB_NODE_EXECUTABLE:-}"
if [[ -z "$node_executable" ]]; then
  node_version="$(tr -d '[:space:]' < "$repo_root/.nvmrc" 2>/dev/null || true)"
  if [[ -n "$node_version" ]]; then
    [[ "$node_version" == v* ]] || node_version="v$node_version"
    nvm_node="$HOME/.nvm/versions/node/$node_version/bin/node"
    if [[ -x "$nvm_node" ]]; then
      node_executable="$nvm_node"
    fi
  fi
fi
if [[ -z "$node_executable" ]]; then
  node_executable="$(command -v node || true)"
fi
if [[ -z "$node_executable" || ! -x "$node_executable" ]]; then
  for candidate in /opt/homebrew/bin/node /usr/local/bin/node /usr/bin/node; do
    if [[ -x "$candidate" ]]; then
      node_executable="$candidate"
      break
    fi
  done
fi
if [[ -z "$node_executable" || ! -x "$node_executable" ]]; then
  printf 'SwiftUI runtime packaging failed: Node.js was not found. Install the version in .nvmrc or set BXB_NODE_EXECUTABLE.\n' >&2
  exit 1
fi

node_version_output="$("$node_executable" --version)"
node_major="${node_version_output#v}"
node_major="${node_major%%.*}"
if [[ ! "$node_major" =~ ^[0-9]+$ ]] || (( node_major < 22 )); then
  printf 'SwiftUI runtime packaging failed: Node.js 22 or newer is required; found %s.\n' "$node_version_output" >&2
  exit 1
fi

if ! node_archs="$(lipo -archs "$node_executable" 2>/dev/null)"; then
  printf 'SwiftUI runtime packaging failed: unable to inspect Node.js architectures: %s\n' "$node_executable" >&2
  exit 1
fi
for target_arch in $target_archs; do
  if [[ " $node_archs " != *" $target_arch "* ]]; then
    printf 'SwiftUI runtime packaging failed: Node.js (%s) does not include target architecture %s.\n' "$node_archs" "$target_arch" >&2
    printf 'Build the native architecture or set BXB_NODE_EXECUTABLE to a compatible Node.js binary.\n' >&2
    exit 1
  fi
done

runtime_root="$app_contents/Resources/BXBRuntime"
helpers_root="$app_contents/Helpers"
rm -rf "$runtime_root"
mkdir -p "$runtime_root/Runtime" "$runtime_root/backend" "$helpers_root"

ditto "$node_executable" "$helpers_root/node"
ditto "$manifest_source" "$runtime_root/package.json"
ditto "$backend_source/bridge" "$runtime_root/backend/bridge"
ditto "$backend_source/src" "$runtime_root/backend/src"
ditto "$node_modules_source" "$runtime_root/node_modules"
ditto "$bridge_source" "$runtime_root/Runtime/macos-backend.js"

printf 'Bundled SwiftUI runtime: node=%s architectures=%s dependencies=%s\n' \
  "$node_executable" "$node_archs" "$node_modules_source"
