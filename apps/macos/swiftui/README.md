# BXB Homework for macOS (SwiftUI)

For self-contained, signed and notarized native DMG releases, see
[`release/macos/README.md`](../../../release/macos/README.md). This release path
includes a pinned Node runtime and Chromium for Apple Silicon or Intel Macs.

## In-app updates

Settings → **应用更新** checks public stable SwiftUI releases, shows the native
installed/available versions and downloads the matching arm64 or Intel DMG.
Only `bxb-homework-swiftui-vX.Y.Z` releases with a matching
`BXBHomework-vX.Y.Z-macos-ARCH.dmg` and `.dmg.sha256` sidecar are eligible.
Drafts, prereleases, unsigned CI packages and Electron/Windows releases are
excluded. The native signed release pipeline is tracked separately in #34.

Checking does not download or interrupt the app. Download progress, cancellation
and retry are available in Settings. A verified download enables **打开安装包并退出…**:
confirm the dialog, save unfinished input, and the app rechecks SHA-256 before
opening the DMG. It exits only if opening succeeds. Drag the app into
Applications to replace it, then launch the new version manually. Canceling
confirmation does not install, exit or relaunch. Installation is never automatic.

Update commands are native UI IPC only and are not exposed as assistant tools.
The flow can be tested without downloading or opening a real installer:

```sh
node --test backend/test/macos-updater.test.js backend/test/macos-update-bridge.test.js
xcrun swiftc -swift-version 6 -target arm64-apple-macos15.0 -parse-as-library \
  apps/macos/swiftui/BXBHomework/Shared/JSONValue.swift \
  apps/macos/swiftui/BXBHomework/Features/MacOSUpdateModel.swift \
  apps/macos/swiftui/Runtime/UpdateFlowSmoke.swift -o /tmp/bxb-update-flow
/tmp/bxb-update-flow
```

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

Assistant tool steps show generated code previews inline, including each page's
filename and line range. Images fit the message width, and the enlargement button
opens the original image in a scrollable view. Missing or damaged images show a
fallback without hiding the step's text. Images are loaded asynchronously from
inside the configured workspace, both during streaming and when reopening a chat.

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

The native code-preview loader also has an account-free smoke test:

```sh
xcrun swiftc -swift-version 6 -target arm64-apple-macos15.0 -parse-as-library \
  apps/macos/swiftui/BXBHomework/Shared/JSONValue.swift \
  apps/macos/swiftui/BXBHomework/Features/AssistantModels.swift \
  apps/macos/swiftui/BXBHomework/Features/AssistantCodePreviewView.swift \
  apps/macos/swiftui/Runtime/AssistantCodePreviewSmoke.swift \
  -o /tmp/bxb-assistant-code-preview-smoke
/tmp/bxb-assistant-code-preview-smoke
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


## Cloud validation and downloadable test app

The Validate macOS SwiftUI workflow runs automatically for relevant pull requests,
including draft PRs, on a GitHub-hosted macOS 15 Apple Silicon runner. It installs
the Node version in .nvmrc, runs backend and Swift smoke tests, builds the complete
native app with Xcode, and verifies its bundled bridge with isolated user data.
No local Xcode installation or account credentials are needed for these checks.

Open the PR's Checks tab, then the workflow run. A successful run offers:

- BXBHomework-macos-arm64-test-RUN_ID: a ZIP containing the app ZIP, SHA-256 checksum
  and build notes. Extract the inner app ZIP to preserve executable permissions.
- macos-swiftui-validation-logs-RUN_ID: test logs, toolchain information and Xcode
  build results, including failed runs.

Artifacts are retained for seven days. The test app requires macOS 15 or newer
on Apple Silicon, is ad hoc signed and is not a notarized release. Browser-backed
login still needs the existing separate Chromium dependency. Automated success
does not replace checking the real term picker and homework screens with a
legitimate test account. The workflow never logs in, submits work or sends messages.

After the workflow is merged to the default branch it can also be started from
Actions using Run workflow. The existing Electron release workflow is separate.

### 助手首次设置引导

后端连接及旧密钥迁移完成后，没有有效 chat 提供商和 Keychain 凭据的用户会看到两页引导。
可以选择已有提供商或共享服务预设、输入 Key、读取模型列表，也可以直接填写模型 ID。
“测试模型回复”发送一次固定短文本到所选服务，不携带聊天或课程信息，不调用助手工具，可能产生少量费用。
测试通过后才能完成配置；修改连接字段会使测试结果失效。Key 只在完成时保存到本机 Keychain，输入框不会回填已保存值。

“稍后设置”不会保存候选配置，并记住跳过选择。设置页的“助手设置引导”和助手页的“设置智能助理”可重新进入。
读取配置或 Keychain 失败会显示重试，不能误判为新安装。保存结果不明确时先“确认保存结果”，避免覆盖原凭据。

状态测试（内存 Keychain 替身及隔离 UserDefaults，不读取真实用户数据）：

```bash
bash apps/macos/swiftui/Runtime/check-assistant-setup.sh
node --test backend/test/model-config-setup.test.js
```

原生 UI 测试启动时，直接启动下载产物的可执行文件，并同时设置三个隔离变量：

```bash
BXB_TEST_APPDATA=/tmp/bxb-setup-acceptance \
BXB_TEST_KEYCHAIN_SERVICE=com.grayxy.bxbhomework.setup-acceptance \
BXB_TEST_DEFAULTS_SUITE=com.grayxy.bxbhomework.setup-acceptance \
  '/path/to/BXB Homework.app/Contents/MacOS/BXB Homework'
```

可执行文件名以应用 Info.plist 中 CFBundleExecutable 为准。正常启动不设置这些变量，继续使用现有数据路径、Keychain service 和偏好设置。
详细验收与限制见 `docs/implementation/2026-10-13-macos-assistant-setup.md`。

macOS 登录时会复用与当前 Playwright 版本匹配的 Chromium 缓存；缺失时自动下载，登录页显示准备提示。
下载保留其他版本缓存，失败后可重试。缓存就绪以当前架构的可执行文件存在为准，空目录或旧版本目录不算就绪。
`BXB_TEST_KEYCHAIN_SERVICE` 同时隔离模型 Key 和登录凭据（登录 service 增加 `.login-credentials` 后缀）。
CI 使用 `Runtime/BrowserRuntimeSmoke.mjs` 验证打包运行时的真实浏览器启动，不提交真实账号。
