# BXB Homework for macOS (SwiftUI)

This directory contains the native macOS client shell. The existing Electron
client remains available one directory above while features migrate in stages.

## Open in Xcode

Open `BXBHomework.xcodeproj`, select the `BXBHomework` scheme, and run the app on
`My Mac`.

## Command-line build

The app build bundles the Node executable, the shared backend bridge and source,
and the repository's installed Node dependencies into the `.app`. Install the
repository dependencies first:

```sh
npm ci
```

The build script uses the Node version from `.nvmrc` when available (Node 22 or
newer) and requires it to include the architecture being built. You can override
the detected executable with `BXB_NODE_EXECUTABLE`. The packaged app starts this
bundled runtime and does not need the repository checkout or a separately
installed Node.js. User data continues to live under
`~/Library/Application Support/bxb-homework-electron`.

Playwright's Chromium browser is not bundled in this first packaging step; the
browser-backed login still needs its browser dependency to be present or
downloaded separately.

```sh
xcodebuild \
  -project BXBHomework.xcodeproj \
  -scheme BXBHomework \
  -destination 'platform=macOS' \
  -derivedDataPath /tmp/BXBHomeworkDerivedData \
  CODE_SIGNING_ALLOWED=NO \
  build
```

The command above produces an app for the current build architecture. A
universal or other-architecture release also needs a matching Node.js binary
and architecture-compatible native Node modules before building that target.

The native shell starts the shared Node JSONL bridge, reads app/session status,
and exposes a user-triggered native login form. Credentials are sent only to the
local Node process for login and are optionally stored in the macOS Keychain
after a successful login. Attachment download is connected; submission and other
external homework actions remain disconnected.

The native homework center uses the shared read-only course, task-list, and task
content tools. It supports course selection, all/pending filtering, and detail
views for task text, reference content, and attachment metadata. Users can
download task attachments into the managed workspace, see the saved location or
a retryable failure, and open a successful download in the workspace preview.
Submission and draft-delivery actions remain disconnected until the reviewed
delivery flow is implemented.

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
Approved drafts can open a structured task-submission preview with the full text,
destination, mode, and retained attachments; the user must click a separate
confirmation button before submission. A persistent delivery record blocks
automatic retries when a network failure leaves the remote result uncertain.
Private-message delivery remains disconnected.

The native assistant page reads local conversations and model configuration,
supports text and workspace image prompts, and streams the response and tool
steps through the shared agent backend. It can stop generation, search and
manage conversations, reset or compact context, and preview attached images.
Sending a message can invoke the shared agent's tools. Draft review and real
delivery remain separate flows in the native UI.

The native Settings screen provides separate chat and optional image-caption
provider profiles, model discovery and connection checks, assistant limits and
instructions, session refresh/sign-out, and Finder shortcuts for the local
data directories. macOS API keys live in Keychain; the backend receives them
only for a model check or assistant request, and they are removed from the
local model-config file. Existing keys in that file are migrated to Keychain
before the settings screen allows edits. Signing out only clears the saved
Banxuebang session and leaves conversations, drafts, and workspace files alone.

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

The bridge progress, cancellation, and interruption protocol can be checked with an isolated
fixture. This does not modify the user's conversation history:

```sh
xcrun swiftc -parse-as-library \
  apps/macos/swiftui/BXBHomework/Shared/JSONValue.swift \
  apps/macos/swiftui/BXBHomework/Shared/NodeBackendClient.swift \
  apps/macos/swiftui/Runtime/BridgeStreamSmoke.swift \
  -o /tmp/bxb-bridge-stream-smoke
/tmp/bxb-bridge-stream-smoke
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

The draft review screen requires a second explicit confirmation before either task
submission or teacher messaging. Teacher messages are previewed with a selected
existing contact and exact chunks; a definite rejection resumes at the failed
chunk, while an uncertain result locks the draft until the conversation is checked.

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

## Academic term switching

The Overview screen includes a term picker for logged-in accounts. The current
term is resolved by its ID, including numeric IDs returned by the backend.
Switching loads and persists the new courses before publishing the selection;
a failed request rechecks the real session rather than guessing whether it committed.
Homework lists, detail requests, and attachment display state are invalidated
when the account, class, or term changes. Draft text remains editable locally,
while delivery previews must be prepared again in the new context.

Switching is disabled during account operations or an assistant run. The native
bridge enforces the same rule for direct requests, including submission and
teacher messaging. The pending card uses the paginated home.pendingCount
summary, with explicit loading and unavailable states.

Run the account-free parser and state smoke tests from the repository root:

~~~sh
bash apps/macos/swiftui/Runtime/check-academic-context.sh
npm run check
~~~

The Swift runner accepts additional compiler arguments (for example a module
cache path) after the script name. It uses an isolated Node fixture and never
logs in, sends a message, submits homework, or reads the real session.
Full Xcode build and UI checks are still required before release.
