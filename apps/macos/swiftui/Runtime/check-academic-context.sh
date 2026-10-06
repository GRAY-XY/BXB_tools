#!/bin/bash
set -euo pipefail

# Run from any directory; optional arguments are passed directly to swiftc.
cd "$(dirname "$0")/../../../.."
validation_root="$(mktemp -d /tmp/bxb-academic-context.XXXXXX)"
trap 'rm -rf "$validation_root"' EXIT
node_executable="${BXB_NODE_EXECUTABLE:-$(command -v node)}"

xcrun swiftc -swift-version 6 -target "$(uname -m)-apple-macos15.0" "$@" -parse-as-library \
  apps/macos/swiftui/BXBHomework/Shared/JSONValue.swift \
  apps/macos/swiftui/BXBHomework/Shared/BackendModels.swift \
  apps/macos/swiftui/Runtime/TermParsingSmoke.swift \
  -o "$validation_root/term-parser"
"$validation_root/term-parser"

xcrun swiftc -swift-version 6 -target "$(uname -m)-apple-macos15.0" "$@" -parse-as-library \
  apps/macos/swiftui/BXBHomework/Shared/{JSONValue,BackendModels,NodeBackendClient,ModelAPIKeychainStore,BackendConnectionModel}.swift \
  apps/macos/swiftui/BXBHomework/Features/{HomeworkModels,HomeworkViewModel,DraftModels,DraftViewModel}.swift \
  apps/macos/swiftui/Runtime/AcademicContextSmoke.swift \
  -o "$validation_root/academic-context"
BXB_NODE_EXECUTABLE="$node_executable" "$validation_root/academic-context"
