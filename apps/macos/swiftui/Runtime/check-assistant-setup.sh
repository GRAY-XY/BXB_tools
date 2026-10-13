#!/bin/bash
set -euo pipefail
cd "$(dirname "$0")/../../../.."
validation_root="$(mktemp -d /tmp/bxb-assistant-setup.XXXXXX)"
trap 'rm -rf "$validation_root"' EXIT
xcrun swiftc -swift-version 6 -target "$(uname -m)-apple-macos15.0" "$@" -parse-as-library \
  apps/macos/swiftui/BXBHomework/Shared/{JSONValue,ModelAPIKeychainStore,ModelConfigurationModels,ModelConfigurationService}.swift \
  apps/macos/swiftui/BXBHomework/Features/AssistantSetupModel.swift \
  apps/macos/swiftui/Runtime/AssistantSetupSmoke.swift \
  -o "$validation_root/setup"
"$validation_root/setup"
