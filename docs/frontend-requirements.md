# Frontend Requirements

This document describes the expected frontend behavior for the BXB Homework desktop client.

The current production client is the Electron + React app in `desktop/`. The older Tk UI and the archived Flutter prototype are not the active frontend baseline.

## Product Goals

- Provide a non-technical desktop UI for Banxuebang homework, grades, drafts, and AI assistance.
- Keep all user credentials, Banxuebang session data, model API keys, attachments, and drafts local.
- Let the Agent read and organize homework information, but never upload, submit, or delete content without explicit user confirmation.
- Keep the UI usable for students who do not understand JSON, tokens, file paths, or command line concepts.

## Primary Navigation

The left sidebar should contain:

- `主页`
- `助手`
- `作业`
- `审核`
- `模型`
- `设置`

The bottom-left `Session` card is interactive:

- Shows login state, account display name, and current course.
- Opens upward when clicked.
- Contains a term switcher and course switcher.
- Term switching must refresh the available courses.
- Only the actual current term/course should show selected styling.

## Home Page

Required cards:

- Runtime summary: UI runtime, Agent availability, login status.
- Login card:
  - Browser login button.
  - Refresh session button.
  - Explain that login state is stored locally.
- Current session summary:
  - Account name.
  - Class name.
  - Current term.
  - Current course.
  - Number of available courses.
  - Current course pending count.

Do not render raw `session_status` JSON in normal UI.

## Session And Course Switching

When the Session card opens:

1. Call `list_terms`.
2. Call `list_courses`.
3. Render `切换学期` and `切换课程` sections.

When the user selects a term:

1. Call `set_current_term` with `term_name` or `term_id`.
2. Refresh `getSession`.
3. Refresh `list_terms`.
4. Refresh `list_courses`.
5. Recompute selected state from `session.currentTermId`, not stale `term.status`.

When the user selects a course:

1. Call `set_current_subject` with `subject_name` or `subject_id` and optional `class_id`.
2. Refresh `getSession`.
3. Close the menu.

Acceptance criteria:

- Switching terms updates the course list.
- The previous term does not remain highlighted after switching.
- Switching courses updates the sidebar current course.
- The menu opens upward and remains usable on small desktop windows.

## Agent Page

Layout:

- Left column: chat messages and input box.
- Right column: expandable work-process timeline.
- Top toolbar: quick prompts, new conversation, context usage meter.

Chat requirements:

- User messages align right.
- Assistant messages align left.
- User and assistant bubbles should use visibly different colors.
- Assistant messages must render Markdown.
- Markdown tables should not overflow the whole page; the message body should support horizontal scrolling.
- New messages should auto-scroll into view.

Agent progress requirements:

- Subscribe to `onAgentProgress`.
- Show elapsed running time while a request is active.
- Display each step as expandable details.
- Preserve final `steps` returned by `chat()`.

Context meter:

- Prefer `usage.prompt_tokens` or `usage.promptTokens` when available.
- Fallback to estimated tokens from recent messages.
- `contextLength` is configured on the Model page.

## Homework Page

Required actions:

- Refresh all tasks: `list_tasks({ list_type: "all", page: 1, size: 30 })`
- Refresh pending tasks: `list_tasks({ list_type: "pending", page: 1, size: 30 })`
- Open task detail: `read_task_content({ task_id, max_chars: 6000 })`

Table columns:

- ID
- Course
- Task title
- Deadline
- Score/status

Implementation notes:

- Task result fields vary. Use tolerant extraction for `task_id`, `taskId`, `id`, or `activityId`.
- The detail panel may use diagnostic JSON for now, but should move toward a user-facing task reader.

## Review Page

Purpose:

- Review local AI-generated submission drafts.
- Approve or reject local drafts.
- Do not submit to Banxuebang automatically.

Required actions:

- List pending drafts: `list_submission_drafts({ status: "pending_review" })`
- List all drafts: `list_submission_drafts({ status: "all" })`
- Open draft: `get_submission_draft({ draft_id })`
- Approve draft: `approve_submission_draft({ draft_id, review_note })`
- Reject draft: `reject_submission_draft({ draft_id, review_note })`

Future upload/submit requirement:

- If submission is added later, the UI must show a confirmation screen with task, target course, text, files, and destination before calling upload or submit tools.

## Model Page

Fields:

- API Key.
- Base URL.
- Model name.
- Context length.

Actions:

- Save config.
- Test connectivity.
- Clear config.

Security requirements:

- API Key input must use password mode.
- Do not print raw API Key in JSON blocks or logs.
- Show only `apiKeyMasked` after save/test.
- Model config is local-only.

## Settings Page

Required controls:

- Theme: light/dark.
- Max tool rounds.
- Memory turns.
- AI system prompt textarea.
- Restore default system prompt.
- Save settings.
- GitHub repository link or copyable URL.

Default system prompt:

```text
你是伴学邦桌面助手。需要真实数据时必须调用工具，不要猜测。不要上传、提交或删除任何内容。处理作业草稿时先调用 collect_task_submission_context；信息不足就说明缺什么；信息足够才调用 draft_task_submission 保存草稿等待用户审核。
```

## Safety Rules

Frontend must enforce these rules:

- Never display raw Banxuebang tokens.
- Never display raw API keys.
- Never commit local session files, model config, attachments, build output, or cache.
- Never call upload/submit tools without explicit user confirmation.
- The autonomous Agent should not be given upload/submit tools by default.
- Use `npm run scan:publish` before publishing or release packaging.

## Build And Verification

Local development:

```powershell
cd desktop
npm install
npm run dev
```

Production build:

```powershell
cd desktop
npm run build
npm run dist
```

Verification checklist:

- `node --check electron/main.cjs`
- `node --check electron/preload.cjs`
- `npm run build`
- Start `dist-electron-app/win-unpacked/BXB Homework.exe`.
- Confirm the app window title is `BXB Homework`.
- Confirm login/session summary works.
- Confirm term switching has only one selected term.
- Confirm course switching updates current course.
- Confirm Model config can save, test, and clear without exposing raw API Key.
- Confirm Agent can call at least `list_courses` and `list_tasks`.

## Known Constraints

- The renderer uses a narrow IPC facade. Any new backend capability should be added behind `window.bxb`, not by enabling Node integration.
- Tool results are not fully normalized. Frontend code must tolerate multiple field names.
- PDF/DOCX advanced editing and code sandbox tools are not yet part of the current frontend/backend contract.
- The archived Flutter prototype exists only for future reference and is not the active UI.
