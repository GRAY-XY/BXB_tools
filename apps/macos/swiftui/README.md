# BXB Homework for macOS (SwiftUI)

This directory contains the native macOS client shell. The existing Electron
client remains available one directory above while features migrate in stages.

## Open in Xcode

Open `BXBHomework.xcodeproj`, select the `BXBHomework` scheme, and run the app on
`My Mac`.

## Command-line build

```sh
xcodebuild \
  -project BXBHomework.xcodeproj \
  -scheme BXBHomework \
  -destination 'platform=macOS' \
  -derivedDataPath /tmp/BXBHomeworkDerivedData \
  CODE_SIGNING_ALLOWED=NO \
  build
```

The native shell starts the shared Node JSONL bridge, reads app/session status,
and exposes a user-triggered native login form. Credentials are sent only to the
local Node process for login and are optionally stored in the macOS Keychain
after a successful login. Mutating homework tools are not connected yet.

The native homework center uses the shared read-only course, task-list, and task
content tools. It supports course selection, all/pending filtering, and detail
views for task text, reference content, and attachment metadata. Download and
submission actions remain intentionally disconnected.

The native workspace browser can search and read the shared local workspace
without a Banxuebang login. Text files use the bounded backend reader; images,
PDF, DOCX, audio, video, and other supported local formats use macOS Quick Look.
Import, rename, and delete actions are not connected yet.

## Bridge smoke test

Compile and run the bridge smoke test from the repository root:

```sh
xcrun swiftc -parse-as-library \
  apps/macos/swiftui/BXBHomework/Shared/JSONValue.swift \
  apps/macos/swiftui/BXBHomework/Shared/BackendModels.swift \
  apps/macos/swiftui/BXBHomework/Shared/NodeBackendClient.swift \
  apps/macos/swiftui/Runtime/BackendBridgeSmoke.swift \
  -o /tmp/bxb-bridge-smoke
/tmp/bxb-bridge-smoke
```

The homework response parser has a separate account-free smoke test:

```sh
xcrun swiftc -parse-as-library \
  apps/macos/swiftui/BXBHomework/Shared/JSONValue.swift \
  apps/macos/swiftui/BXBHomework/Features/HomeworkModels.swift \
  apps/macos/swiftui/Runtime/HomeworkParsingSmoke.swift \
  -o /tmp/bxb-homework-parsing-smoke
/tmp/bxb-homework-parsing-smoke
```

The workspace response parser can be verified without reading the real local
workspace:

```sh
xcrun swiftc -parse-as-library \
  apps/macos/swiftui/BXBHomework/Shared/JSONValue.swift \
  apps/macos/swiftui/BXBHomework/Features/WorkspaceModels.swift \
  apps/macos/swiftui/Runtime/WorkspaceParsingSmoke.swift \
  -o /tmp/bxb-workspace-parsing-smoke
/tmp/bxb-workspace-parsing-smoke
```
