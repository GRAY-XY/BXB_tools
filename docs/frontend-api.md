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
      loadModelConfig(): Promise<ModelConfig>;
      saveModelConfig(config: ModelConfigInput): Promise<ModelConfig>;
      clearModelConfig(): Promise<ModelConfig>;
      testModelConfig(config: ModelConfigInput): Promise<ModelTestResult>;
      chat(payload: AgentChatInput): Promise<AgentChatResult>;
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
  userDataRoot: string;
  dataRoot: string;
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
await window.bxb.callTool("list_tasks", { list_type: "pending", page: 1, size: 30 });
await window.bxb.callTool("read_task_content", { task_id: "TASK_ID", max_chars: 6000 });
await window.bxb.callTool("list_submission_drafts", { status: "pending_review" });
await window.bxb.callTool("get_submission_draft", { draft_id: "DRAFT_ID" });
await window.bxb.callTool("approve_submission_draft", { draft_id: "DRAFT_ID", review_note: "UI approved" });
await window.bxb.callTool("reject_submission_draft", { draft_id: "DRAFT_ID", review_note: "UI rejected" });
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

### Upload And Submit Safety

These tools exist in the backend registry:

- `upload_submission_file`
- `submit_task_result`

Frontend rule:

- Never call them without explicit user confirmation in the same interaction.
- Never expose them to autonomous Agent execution by default.
- The review page may offer these actions later, but it must show the target task, files, text, and destination before calling either tool.

## Model Config

```ts
window.bxb.loadModelConfig(): Promise<ModelConfig>
window.bxb.saveModelConfig(config: ModelConfigInput): Promise<ModelConfig>
window.bxb.clearModelConfig(): Promise<ModelConfig>
window.bxb.testModelConfig(config: ModelConfigInput): Promise<ModelTestResult>
```

```ts
type ModelConfigInput = {
  apiKey?: string;
  baseUrl?: string;
  modelName?: string;
  contextLength?: number | string;
  maxToolRounds?: number | string;
  maxMemoryTurns?: number | string;
  systemPrompt?: string;
};

type ModelConfig = ModelConfigInput & {
  defaultSystemPrompt: string;
  apiKeyMasked: string;
  configPath: string;
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
window.bxb.resetChat(): Promise<{ ok: true }>
window.bxb.onAgentProgress(callback): () => void
```

```ts
type AgentChatInput = {
  text: string;
  requestId?: string;
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
5. Call `chat({ text, requestId })`.
6. Render `message` as Markdown.
7. Show `steps` in a right-side timeline or expandable panel.
8. Use `resetChat()` for a new conversation.

## IPC Mapping

Renderer API to IPC channel mapping:

| Frontend API | IPC channel |
| --- | --- |
| `getAppInfo()` | `app:info` |
| `getSession()` | `bxb:session` |
| `callTool(name, args)` | `bxb:tool` |
| `loadModelConfig()` | `config:model:load` |
| `saveModelConfig(config)` | `config:model:save` |
| `clearModelConfig()` | `config:model:clear` |
| `testModelConfig(config)` | `config:model:test` |
| `chat(payload)` | `agent:chat` |
| `resetChat()` | `agent:reset` |
| `onAgentProgress(callback)` | `agent:progress` event |

## Error Handling

All methods may reject with `Error`.

Frontend requirements:

- Show `error.message` in the status bar or toast.
- Do not expose stack traces in normal UI.
- Keep the UI interactive after a failed tool call.
- For login and browser dependency errors, guide the user back to the Login card.
