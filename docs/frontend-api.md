# Frontend API

This document describes the API surface exposed to the desktop frontend by the Electron preload layer.

The frontend must access backend features only through `window.bxb`. Do not import Node modules from React code and do not read local files directly from the renderer.

## Runtime Shape

Defined in:

- `desktop/electron/preload.cjs`
- `desktop/electron/main.cjs`

```ts
declare global {
  interface Window {
    bxb: {
      getAppInfo(): Promise<AppInfo>;
      getSession(): Promise<SessionStatus>;
      callTool<T = unknown>(name: string, args?: Record<string, unknown>): Promise<T>;
      importWorkspaceFiles(): Promise<WorkspaceImportResult>;
      openWorkspaceFolder(): Promise<{ ok: true; workspaceDir: string }>;
      getWorkspaceImageDataUrl(filePath: string): Promise<WorkspaceImagePreview>;
      checkForUpdates(): Promise<UpdateCheckResult>;
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
      onAgentProgress(callback: (payload: AgentProgressPayload) => void): () => void;
    };
  }
}
```

## App Info

```ts
window.bxb.getAppInfo(): Promise<AppInfo>
```

Returns runtime and data directory information.

```ts
type AppInfo = {
  isPackaged: boolean;
  version: string;
  platform: string;
  updateChannel: "Windows preview";
  userDataRoot: string;
  dataRoot: string;
  workspaceDir: string;
  draftDir: string;
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

- Display diagnostic state in Settings.
- Do not show full paths on first-run screens unless the user asks for diagnostics.

## Updates

```ts
window.bxb.checkForUpdates(): Promise<UpdateCheckResult>
window.bxb.openUpdateUrl(url: string): Promise<{ ok: true; url: string }>
```

The first-stage updater checks GitHub Releases and lets the user open the release page or installer download in the system browser. It does not install updates automatically.

Windows preview releases are identified by release title, not tag name:

```text
BXB Homework Win v<major>.<minor>.<patch>-pre
```

Historical titles such as `BXB Homework Win v1.1.0-pre.3` may still be parsed for compatibility, but new releases should increment `major.minor.patch` and keep `-pre` as the preview-channel marker.

```ts
type UpdateCheckResult = {
  ok: boolean;
  currentVersion: string;
  currentChannel: "Windows preview";
  hasUpdate: boolean;
  latestVersion?: string;
  latestTitle?: string;
  latestTag?: string;
  latestUrl?: string;
  publishedAt?: string;
  message: string;
  releasesUrl: string;
  installerAsset?: {
    name: string;
    size?: number;
    downloadUrl: string;
  } | null;
};
```

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
- Current course: `session.currentSubject.name`
- Number of courses: `session.availableSubjects.length`
- Pending count: `session.currentSubject.unSubmitCount`

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
await window.bxb.callTool("set_current_subject", { subject_name: "AP宏观经济学" });
await window.bxb.callTool("set_current_subject", { subject_name: "全部课程" });
await window.bxb.callTool("list_tasks", { list_type: "pending", page: 1, size: 30 });
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
});
await window.bxb.callTool("list_submission_drafts", { status: "pending_review" });
await window.bxb.callTool("get_submission_draft", { draft_id: "DRAFT_ID" });
await window.bxb.callTool("update_submission_draft", { draft_id: "DRAFT_ID", draft_text: "..." });
await window.bxb.callTool("approve_submission_draft", { draft_id: "DRAFT_ID", review_note: "UI approved" });
await window.bxb.callTool("reject_submission_draft", { draft_id: "DRAFT_ID", review_note: "UI rejected" });
await window.bxb.callTool("delete_submission_draft", { draft_id: "DRAFT_ID" });
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

Course switching:

- `list_courses` includes a synthetic first option named `全部课程`.
- Selecting `全部课程` should call `set_current_subject({ subject_name: "全部课程" })`.
- When `session.currentSubject.allSubjects` is true, `list_tasks` aggregates current-term tasks across all courses.
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

Frontend rule:

- Never call them without explicit user confirmation in the same interaction.
- Never expose them to autonomous Agent execution by default.
- The draft page may offer these actions later, but it must show the target task, files, text, and destination before calling either tool.

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
- Do not expose `send_private_message_text` to autonomous Agent execution by default.
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
  apiKey?: string;
  baseUrl?: string;
  modelName?: string;
  contextLength?: number | string;
  maxToolRounds?: number | string;
  systemPrompt?: string;
};

type ModelConfig = ModelConfigInput & {
  defaultSystemPrompt: string;
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
| `openWorkspaceFolder()` | `workspace:open` |
| `getWorkspaceImageDataUrl(filePath)` | `workspace:image-data-url` |
| `loadModelConfig()` | `config:model:load` |
| `saveModelConfig(config)` | `config:model:save` |
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
