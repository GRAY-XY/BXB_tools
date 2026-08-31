# Frontend API

This document describes the API surface exposed to the desktop frontend by the Electron preload layer.

The frontend must access backend features only through `window.bxb`. Do not import Node modules from React code and do not read local files directly from the renderer.

## Runtime Shape

Defined in:

- `apps/legacy/electron/electron/preload.cjs`
- `apps/legacy/electron/electron/main.cjs`

```ts
declare global {
  interface Window {
    bxb: {
      getAppInfo(): Promise<AppInfo>;
      getSession(): Promise<SessionStatus>;
      callTool<T = unknown>(name: string, args?: Record<string, unknown>): Promise<T>;
      importWorkspaceFiles(): Promise<WorkspaceImportResult>;
      saveWorkspacePastes(items: WorkspacePasteInput[]): Promise<WorkspacePasteResult>;
      openWorkspaceFolder(): Promise<{ ok: true; workspaceDir: string }>;
      getWorkspaceImageDataUrl(filePath: string): Promise<WorkspaceImagePreview>;
      checkForUpdates(): Promise<UpdateCheckResult>;
      downloadUpdate(): Promise<UpdateState>;
      installUpdate(): Promise<UpdateState>;
      cancelUpdateDownload(): Promise<UpdateState>;
      getUpdateStatus(): Promise<UpdateState>;
      openUpdateUrl(url: string): Promise<{ ok: true; url: string }>;
      loadModelConfig(): Promise<ModelConfig>;
      saveModelConfig(config: ModelConfigInput): Promise<ModelConfig>;
      clearModelConfig(): Promise<ModelConfig>;
      listModelOptions(config: ModelConfigInput): Promise<ModelListResult>;
      testModelConfig(config: ModelConfigInput): Promise<ModelTestResult>;
      chat(payload: AgentChatInput): Promise<AgentChatResult>;
      compactChat(): Promise<AgentCompactResult>;
      listConversations(): Promise<AgentConversationState>;
      createConversation(payload?: { title?: string }): Promise<AgentConversationState>;
      selectConversation(conversationId: string): Promise<AgentConversationState>;
      renameConversation(conversationId: string, title: string): Promise<AgentConversationState>;
      deleteConversation(conversationId: string): Promise<AgentConversationState>;
      resetChat(): Promise<{ ok: true }>;
      onUpdateProgress(callback: (payload: UpdateState) => void): () => void;
      onAgentProgress(callback: (payload: AgentProgressPayload) => void): () => void;
    };
  }
}
```

## App Info

```ts
window.bxb.getAppInfo(): Promise<AppInfo>
window.bxb.openAppPath(key: string): Promise<{ ok: true; key: string; path: string }>
```

Returns runtime and data directory information.

```ts
type AppInfo = {
  isPackaged: boolean;
  version: string;
  platform: string;
  updateChannel: "Windows stable";
  userDataRoot: string;
  dataRoot: string;
  workspaceDir: string;
  draftDir: string;
  updateDir: string;
  modelConfigPath: string;
  conversationsPath: string;
  payloadRoot: string;
  browserDependency: {
    ready: boolean;
    browserRoot: string;
    candidates: string[];
    source: "existing-cache" | "missing";
  };
};
```

Frontend usage:

- Display these paths in a dedicated Settings path card with short descriptions and open buttons.
- Do not render the raw `AppInfo` JSON in normal Settings UI.

## Updates

```ts
window.bxb.checkForUpdates(): Promise<UpdateCheckResult>
window.bxb.downloadUpdate(): Promise<UpdateState>
window.bxb.installUpdate(): Promise<UpdateState>
window.bxb.cancelUpdateDownload(): Promise<UpdateState>
window.bxb.getUpdateStatus(): Promise<UpdateState>
window.bxb.onUpdateProgress(callback: (payload: UpdateState) => void): () => void
window.bxb.openUpdateUrl(url: string): Promise<{ ok: true; url: string }>
```

The Windows updater checks GitHub Releases, downloads the matched installer into the local update cache, verifies file size and SHA256, then lets the user restart into the installer from inside the app. Keep the release page link as a manual fallback.

Windows stable releases are identified by release title, not tag name:

```text
BXB Homework v<major>.<minor>.<patch>
```

Historical preview titles such as `BXB Homework Win v1.1.0-pre.3` may still be parsed for compatibility, but update checks should only consider normal GitHub Releases, not prereleases. New releases increment `major.minor.patch` without `-pre` and should be marked as latest.

```ts
type UpdateCheckResult = {
  ok: boolean;
  currentVersion: string;
  currentChannel: "Windows stable";
  hasUpdate: boolean;
  latestVersion?: string;
  latestTitle?: string;
  latestTag?: string;
  latestUrl?: string;
  publishedAt?: string;
  latestNotes?: string;
  message: string;
  releasesUrl: string;
  installerAsset?: {
    name: string;
    size?: number;
    downloadUrl: string;
  } | null;
  sha256Asset?: {
    name: string;
    size?: number;
    downloadUrl: string;
  } | null;
};

type UpdateState = {
  status:
    | "idle"
    | "checking"
    | "available"
    | "downloading"
    | "verifying"
    | "ready_to_install"
    | "installing"
    | "error";
  update?: UpdateCheckResult | null;
  downloadedBytes?: number;
  totalBytes?: number;
  percent?: number;
  filePath?: string | null;
  message?: string;
};
```

Application-internal installation requires the release to include a SHA256 asset named like the installer plus `.sha256`, for example `BXB Homework Setup 1.1.7.exe.sha256`.

## Session

```ts
window.bxb.getSession(): Promise<SessionStatus>
```

Returns the current Banxuebang login and context summary.

Important: never render this object as raw JSON in normal UI. It may include technical fields such as local session paths or masked token metadata. Use a user-facing summary instead.

```ts
type SessionStatus = {
  ready: boolean;
  baseUrl?: string;
  capturedAt?: string;
  loginSource?: string;
  user?: {
    id?: string;
    name?: string;
    loginName?: string;
  };
  currentClass?: {
    id?: string;
    name?: string;
    campusId?: string;
  };
  currentTermId?: string;
  currentTermName?: string;
  currentSubject?: {
    id?: string;
    classId?: string;
    name?: string;
    allSubjects?: boolean;
    unSubmitCount?: number;
  };
  availableTerms?: Array<{
    id?: string;
    name?: string;
    status?: boolean;
  }>;
  availableSubjects?: Array<{
    id?: string;
    classId?: string;
    name?: string;
    color?: string;
    unSubmitCount?: number;
  }>;
};
```

Recommended summary fields:

- Account name: `session.user.name`
- Class name: `session.currentClass.name`
- Current term: active term by `session.currentTermId`
- Number of courses: `session.availableSubjects.length`
- Pending count: sum `unSubmitCount` from `session.availableSubjects` when available.

## Generic Tool Call

```ts
window.bxb.callTool<T>(name: string, args?: Record<string, unknown>): Promise<T>
```

This is the main bridge from UI to the local Banxuebang tool registry.

Common frontend calls:

```ts
await window.bxb.callTool("login_in_browser", {});
await window.bxb.callTool("list_terms", {});
await window.bxb.callTool("set_current_term", { term_name: "2025-2026下学期" });
await window.bxb.callTool("list_courses", {});
await window.bxb.callTool("list_tasks", { subject_name: "全部课程", list_type: "pending", page: 1, size: 30 });
await window.bxb.callTool("list_tasks", { subject_name: "AP宏观经济学", class_id: "CLASS_ID", list_type: "all", page: 1, size: 30 });
await window.bxb.callTool("read_task_content", { task_id: "TASK_ID", max_chars: 6000 });
await window.bxb.callTool("download_task_attachment", { task_id: "TASK_ID", file_id: "FILE_ID" });
await window.bxb.callTool("read_task_attachment", { task_id: "TASK_ID", file_id: "FILE_ID", max_chars: 6000 });
await window.bxb.callTool("list_workspace_files", {});
await window.bxb.callTool("read_workspace_file", { file: "assignment.pdf", max_chars: 8000 });
await window.bxb.callTool("rename_workspace_file", { file: "assignment.pdf", new_name: "AP Macro Unit 4 Homework.pdf" });
await window.bxb.callTool("write_workspace_text_file", { file_name: "notes.md", content: "..." });
await window.bxb.callTool("extract_pdf_text", { local_path: "D:/path/to/file.pdf", max_chars: 6000 });
await window.bxb.callTool("extract_docx_text", { local_path: "D:/path/to/file.docx", max_chars: 6000 });
await window.bxb.callTool("run_python_snippet", { code: "print(sum(range(101)))", timeout_ms: 5000 });
await window.bxb.callTool("web_search", { query: "AP economics latest news", max_results: 5 });
await window.bxb.callTool("read_web_page", { url: "https://example.com/article", max_chars: 8000 });
await window.bxb.callTool("list_private_message_contacts", {});
await window.bxb.callTool("get_private_message_thread", { contact, size: 30 });
await window.bxb.callTool("send_private_message_text", { contact, content: "TEXT" });
await window.bxb.callTool("draft_task_submission", {
  task_id: "TASK_ID",
  subject_name: "Course name",
  task_title: "Task title",
  draft_text: "Draft body...",
  summary: "User-created draft",
  preferred_target: "task",
  intended_targets: ["task", "teacher_private_message"],
  teacher_message_hint: "作业可能已过期，可询问老师是否开放补交。",
});
await window.bxb.callTool("list_submission_drafts", { status: "pending_review" });
await window.bxb.callTool("get_submission_draft", { draft_id: "DRAFT_ID" });
await window.bxb.callTool("update_submission_draft", { draft_id: "DRAFT_ID", draft_text: "..." });
await window.bxb.callTool("approve_submission_draft", { draft_id: "DRAFT_ID", review_note: "UI approved" });
await window.bxb.callTool("reject_submission_draft", { draft_id: "DRAFT_ID", review_note: "UI rejected" });
await window.bxb.callTool("delete_submission_draft", { draft_id: "DRAFT_ID" });
const preview = await window.bxb.callTool("prepare_draft_submission", { draft_id: "APPROVED_DRAFT_ID" });
// Only after the user reviews preview and explicitly confirms:
await window.bxb.callTool("submit_approved_draft", {
  draft_id: "APPROVED_DRAFT_ID",
  confirmation_token: preview.confirmationToken,
});
const messagePreview = await window.bxb.callTool("prepare_draft_private_message", {
  draft_id: "APPROVED_DRAFT_ID",
});
const contact = messagePreview.contacts[0];
const contactPreview = await window.bxb.callTool("prepare_draft_private_message", {
  draft_id: "APPROVED_DRAFT_ID",
  contact,
});
// Only after the user reviews contactPreview chunks and explicitly confirms:
await window.bxb.callTool("send_approved_draft_private_message", {
  draft_id: "APPROVED_DRAFT_ID",
  contact,
  confirmation_token: contactPreview.confirmationToken,
});
```

### Tool Results

Tool result shapes are intentionally close to Banxuebang API responses and may vary by endpoint. The frontend should use tolerant extraction:

```ts
const rows =
  result.items ||
  result.records ||
  result.rows ||
  result.data?.records ||
  [];
```

Homework course filtering:

- `list_courses` includes a synthetic first option named `全部课程`.
- The homework page should use selected course values as `list_tasks` arguments instead of requiring the user to change global current subject.
- Selecting `全部课程` should call `list_tasks({ subject_name: "全部课程", ... })`.
- When `subject_name` is `全部课程`, `list_tasks` aggregates current-term tasks across all courses.
- Achievement/GPA tools still require a concrete course; prompt the user to select one first.

### Workspace Import

```ts
type WorkspaceImportResult = {
  canceled: boolean;
  imported: Array<{
    name: string;
    path: string;
    relativePath: string;
    sourcePath: string;
  }>;
};
```

The renderer must not read arbitrary local files directly. Use `importWorkspaceFiles()` to let the user pick files and copy them into the managed workspace. The Agent should reference workspace files by `relativePath` or filename.

Composer paste saving:

```ts
type WorkspacePasteInput =
  | { kind: "image"; name?: string; mimeType: string; bytes: Uint8Array }
  | { kind: "text"; name?: string; text: string };

type WorkspacePasteResult = {
  saved: Array<{
    kind: "image" | "text";
    name: string;
    path: string;
    relativePath: string;
    sizeBytes: number;
    charCount: number | null;
    mimeType: string;
  }>;
};
```

`saveWorkspacePastes()` only accepts image bytes or text and always chooses a unique destination inside the managed workspace. It rejects unsupported image types and items over 25 MB.

Image previews:

```ts
type WorkspaceImagePreview = {
  fileName: string;
  path: string;
  mimeType: string;
  sizeBytes: number;
  dataUrl: string;
};
```

`getWorkspaceImageDataUrl(filePath)` only accepts files inside the managed workspace and is intended for UI previews after imports or attachment downloads. It rejects unsupported image types and oversized files.

### Upload And Submit Safety

These tools exist in the backend registry:

- `upload_submission_file`
- `submit_task_result`
- `prepare_draft_submission`
- `submit_approved_draft`
- `prepare_draft_private_message`
- `send_approved_draft_private_message`

Frontend rule:

- Never call them without explicit user confirmation in the same interaction.
- Never expose them to autonomous Agent execution by default.
- The draft page must call `prepare_draft_submission` first and show the target task, course, submit/resubmit/supplement mode, retained files, full text, and destination.
- Only call `submit_approved_draft` after a second explicit user click on the confirmation screen.
- Pass the `confirmationToken` returned by `prepare_draft_submission`; submission is rejected if the task state or draft content changed after preview.
- `submit_approved_draft` repeats validation server-side, submits to the task's own class, and marks the local draft `submitted` only after Banxuebang reports success.
- Submission failures leave the draft `approved` and must be shown to the user.
- Task submission failures should expose a `改用私信老师` path, but must not automatically send private messages.
- The draft page must call `prepare_draft_private_message` first and show the selected contact, course, task, full preview text split into roughly 800-character chunks, and destination.
- Only call `send_approved_draft_private_message` after a second explicit user click on the confirmation screen.
- Pass the `confirmationToken` returned by the contact-specific `prepare_draft_private_message`; sending is rejected if the draft, task, contact, or chunk text changed after preview.
- `send_approved_draft_private_message` sends chunks sequentially. If chunk N fails, it stops, leaves the draft `approved`, and returns the sent count plus the error.
- A fully successful teacher message marks the local draft `sent_to_teacher`, not `submitted`.

### Autonomous Agent Tool Set

The desktop Agent currently receives the safe read/draft helper subset:

- `session_status`
- `login_in_browser`
- `refresh_context`
- `list_terms`
- `set_current_term`
- `list_courses`
- `set_current_subject`
- `list_tasks`
- `open_task`
- `read_task_content`
- `get_current_subject_gpa`
- `get_achievement_overview`
- `download_task_attachment`
- `read_task_attachment`
- `list_workspace_files`
- `read_workspace_file`
- `rename_workspace_file`
- `write_workspace_text_file`
- `extract_pdf_text`
- `extract_docx_text`
- `run_python_snippet`
- `web_search`
- `read_web_page`
- `collect_task_submission_context`
- `draft_task_submission`

`run_python_snippet` is time-limited and output-limited, but it is not a full security sandbox. It should be used for short calculations or small deterministic transformations only.

`web_search` runs through the local Playwright browser, defaults to Bing, and does not require the user to configure a search API key. `read_web_page` should be used only for a selected result when the Agent needs page-level detail.

Workspace files live under the local Electron user data directory at `workspaceDir`. User imports should use `importWorkspaceFiles()` so files are copied into that directory before the Agent references them.

Private-message send safety:

- `send_private_message_text` must only be triggered by a direct user action in the UI.
- Do not expose `send_private_message_text`, `prepare_draft_private_message`, or `send_approved_draft_private_message` to autonomous Agent execution by default.
- The current UI supports text messages only; image/file message display may be represented as placeholders.

## Model Config

```ts
window.bxb.loadModelConfig(): Promise<ModelConfig>
window.bxb.saveModelConfig(config: ModelConfigInput): Promise<ModelConfig>
window.bxb.clearModelConfig(): Promise<ModelConfig>
window.bxb.listModelOptions(config: ModelConfigInput): Promise<ModelListResult>
window.bxb.testModelConfig(config: ModelConfigInput): Promise<ModelTestResult>
```

```ts
type ModelConfigInput = {
  modelRole?: "chat" | "image_caption";
  enabled?: boolean;
  activeProviderId?: string;
  providerName?: string;
  provider?: ModelProviderInput;
  providers?: ModelProviderInput[];
  apiKey?: string;
  baseUrl?: string;
  modelName?: string;
  contextLength?: number | string;
  chatTemperature?: number | string;
  compactTemperature?: number | string;
  longPasteThreshold?: number | string;
  maxToolRounds?: number | string;
  systemPrompt?: string;
};

type ModelProviderInput = {
  id?: string;
  type?: string;
  name?: string;
  apiKey?: string;
  baseUrl?: string;
  modelName?: string;
};

type ModelProvider = {
  id: string;
  type: string;
  name: string;
  baseUrl: string;
  modelName: string;
  hasApiKey: boolean;
  apiKeyMasked: string;
  availableModels: string[];
};

type ModelConfig = ModelConfigInput & {
  activeProviderId: string;
  providerName: string;
  modelRoles: {
    chat: {
      enabled: true;
      activeProviderId: string;
      providers: ModelProvider[];
    };
    image_caption: {
      enabled: boolean;
      activeProviderId: string;
      providers: ModelProvider[];
    };
  };
  providers: ModelProvider[];
  defaultSystemPrompt: string;
  hasApiKey: boolean;
  apiKeyMasked: string;
  configPath: string;
};

type ModelListResult = {
  modelsUrl: string;
  modelsCount: number;
  modelIds: string[];
  sampleModels: string[];
  message: string;
};

type ModelTestResult = {
  ok: boolean;
  modelsUrl: string;
  modelName: string;
  modelsCount: number;
  sampleModels: string[];
  message: string;
};
```

Security requirements:

- Use password input for `apiKey`.
- Do not render raw `apiKey` after saving unless the user is actively editing it.
- `apiKeyMasked` is safe for display.
- `configPath` is diagnostic information; prefer hiding it outside advanced settings.
- The current model provider is selected by `activeProviderId`. Frontends should edit the selected provider through `provider` and keep legacy top-level `baseUrl`/`modelName` only for compatibility.
- Existing single-provider `apiKey`/`baseUrl`/`modelName` configs are migrated into a default provider automatically.

## Agent Chat

```ts
window.bxb.chat(payload: AgentChatInput): Promise<AgentChatResult>
window.bxb.compactChat(): Promise<AgentCompactResult>
window.bxb.listConversations(): Promise<AgentConversationState>
window.bxb.createConversation(payload?: { title?: string }): Promise<AgentConversationState>
window.bxb.selectConversation(conversationId: string): Promise<AgentConversationState>
window.bxb.renameConversation(conversationId: string, title: string): Promise<AgentConversationState>
window.bxb.deleteConversation(conversationId: string): Promise<AgentConversationState>
window.bxb.resetChat(): Promise<{ ok: true }>
window.bxb.onAgentProgress(callback): () => void
```

```ts
type AgentChatInput = {
  text: string;
  requestId?: string;
  conversationId?: string;
};

type AgentChatResult = {
  message: string;
  steps: AgentStep[];
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    total_tokens?: number;
    promptTokens?: number;
    completionTokens?: number;
    totalTokens?: number;
  } | null;
};

type AgentCompactResult = {
  ok: true;
  summary: string;
  keptTurns: number;
  previousTurns: number;
  usage?: AgentChatResult["usage"];
  conversation?: AgentConversationSummary;
};

type AgentConversationState = {
  activeId: string | null;
  conversations: AgentConversationSummary[];
  activeConversation: {
    id: string;
    title: string;
    createdAt: string;
    updatedAt: string;
    messages: Array<{ role: "user" | "assistant" | string; text: string; at?: string }>;
  } | null;
};

type AgentConversationSummary = {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  messageCount: number;
};

type AgentProgressPayload = {
  requestId?: string;
  step: AgentStep;
};

type AgentStep = {
  kind: "llm" | "tool" | "done" | string;
  title: string;
  detail?: string;
  at: string;
};
```

Recommended flow:

1. Add the user message to the chat list.
2. Clear prior progress steps.
3. Generate a `requestId`.
4. Subscribe with `onAgentProgress`.
5. Call `chat({ text, requestId, conversationId })`.
6. Render `message` as Markdown.
7. Show `steps` in a right-side timeline or expandable panel.
8. Treat user input `/compact` as a call to `compactChat()`.
9. Use `createConversation()` for a new conversation and `selectConversation()` to enter an old one.

## IPC Mapping

Renderer API to IPC channel mapping:

| Frontend API | IPC channel |
| --- | --- |
| `getAppInfo()` | `app:info` |
| `getSession()` | `bxb:session` |
| `callTool(name, args)` | `bxb:tool` |
| `importWorkspaceFiles()` | `workspace:import` |
| `saveWorkspacePastes(items)` | `workspace:save-pastes` |
| `openWorkspaceFolder()` | `workspace:open` |
| `getWorkspaceImageDataUrl(filePath)` | `workspace:image-data-url` |
| `loadModelConfig()` | `config:model:load` |
| `saveModelConfig(config)` | `config:model:save` |
| `createModelProvider(payload)` | `config:model:provider:create` |
| `deleteModelProvider(payload)` | `config:model:provider:delete` |
| `selectModelProvider(payload)` | `config:model:provider:select` |
| `clearModelConfig()` | `config:model:clear` |
| `listModelOptions(config)` | `config:model:list` |
| `testModelConfig(config)` | `config:model:test` |
| `chat(payload)` | `agent:chat` |
| `compactChat()` | `agent:compact` |
| `listConversations()` | `agent:conversations:list` |
| `createConversation(payload)` | `agent:conversations:create` |
| `selectConversation(conversationId)` | `agent:conversations:select` |
| `renameConversation(conversationId, title)` | `agent:conversations:rename` |
| `deleteConversation(conversationId)` | `agent:conversations:delete` |
| `resetChat()` | `agent:reset` |
| `onAgentProgress(callback)` | `agent:progress` event |

## Error Handling

All methods may reject with `Error`.

Frontend requirements:

- Show `error.message` in the status bar or toast.
- Do not expose stack traces in normal UI.
- Keep the UI interactive after a failed tool call.
- For login and browser dependency errors, guide the user back to the Login card.
