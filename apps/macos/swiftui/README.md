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
It also manages the workspace through the shared user-action bridge methods:
importing files and folders with a native open panel, saving clipboard text as a
new file, renaming with inline validation, deleting a single confirmed item, and
revealing workspace items in Finder. Import and rename never overwrite an
existing workspace file; the page reports each conflicting or blocked item
instead. The list shows files and folders, and deleting always names the target
and cannot be undone. A folder is only deletable while it is empty, because the
app never deletes recursively, and there is no batch or wildcard delete action.

The workspace guard lives in `backend/src/banxuebang-client.js` so the page and
the assistant share one boundary: every target must resolve inside the
configured workspace directory, symlinks are never followed, and the workspace
root itself cannot be renamed or deleted.

The native draft review center works without a Banxuebang login. It lists and
filters local submission drafts, shows review warnings and missing information,
and supports local plain-text edits plus explicit approve/reject confirmations.
Approving a draft never submits an assignment or sends a private message; all
delivery actions remain disconnected.

The native assistant page reads local conversations and model configuration,
supports creating and selecting conversations, and can send text prompts through
the shared agent backend. This first increment displays the completed response
and saved execution steps; live token streaming and image attachments are not
connected yet.

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

Draft list and detail parsing has an account-free smoke test as well:

```sh
xcrun swiftc -parse-as-library \
  apps/macos/swiftui/BXBHomework/Shared/JSONValue.swift \
  apps/macos/swiftui/BXBHomework/Features/DraftModels.swift \
  apps/macos/swiftui/Runtime/DraftParsingSmoke.swift \
  -o /tmp/bxb-draft-parsing-smoke
/tmp/bxb-draft-parsing-smoke
```

Assistant conversation and model-summary parsing can be verified without a
configured model:

```sh
xcrun swiftc -parse-as-library \
  apps/macos/swiftui/BXBHomework/Shared/JSONValue.swift \
  apps/macos/swiftui/BXBHomework/Features/AssistantModels.swift \
  apps/macos/swiftui/Runtime/AssistantParsingSmoke.swift \
  -o /tmp/bxb-assistant-parsing-smoke
/tmp/bxb-assistant-parsing-smoke
```
