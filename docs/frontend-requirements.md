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
- `工作区`
- `私信`
- `草稿`
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
  - Number of available courses.
  - Pending task count across available courses when available.

Do not render raw `session_status` JSON in normal UI.

## Session And Term Switching

When the Session card opens:

1. Call `list_terms`.
2. Render `切换学期`.
3. Do not ask the user to choose a global current subject here.

When the user selects a term:

1. Call `set_current_term` with `term_name` or `term_id`.
2. Refresh `getSession`.
3. Refresh `list_terms`.
4. Clear homework-page course/task state so the next homework refresh reloads current-term courses.
5. Recompute selected state from `session.currentTermId`, not stale `term.status`.

Acceptance criteria:

- The previous term does not remain highlighted after switching.
- The menu opens upward and remains usable on small desktop windows.

## Agent Page

Layout:

- Left column: conversation list.
- Middle column: chat messages and input box.
- Right column: expandable work-process timeline.
- Top toolbar: quick prompts, new conversation, context usage meter.

Conversation list requirements:

- Create a new conversation.
- Select an old conversation and restore its messages.
- Rename a conversation.
- Delete a conversation after confirmation.
- Keep conversations local in Electron userData; do not store them in the repository.

Chat requirements:

- User messages align right.
- Assistant messages align left.
- User and assistant bubbles should use visibly different colors.
- Assistant messages must render Markdown.
- Markdown tables should not overflow the whole page; the message body should support horizontal scrolling.
- New messages should auto-scroll into view.
- User input `/compact` should summarize older conversation history and keep only the compressed summary plus recent turns.
- When current or external information is needed, the Agent may call `web_search` first and `read_web_page` for selected result URLs. The default search engine is Bing and no user-provided search API key is required.
- When the user references a workspace file, the Agent should call `list_workspace_files` to locate it, then `read_workspace_file` or `rename_workspace_file` as needed.

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

- Load course filter choices: `list_courses({})`
- Refresh all tasks for selected course: `list_tasks({ subject_name, class_id, list_type: "all", page: 1, size: 30 })`
- Refresh pending tasks for selected course: `list_tasks({ subject_name, class_id, list_type: "pending", page: 1, size: 30 })`
- Open task detail: `read_task_content({ task_id, max_chars: 6000 })`

The homework page must own subject selection with a dropdown that includes `全部课程`; users should not need to switch a global current subject to browse homework. When `全部课程` is selected, task lists aggregate all current-term courses and keep course names visible in rows.

Table columns:

- ID
- Course
- Task title
- Deadline
- Score/status

Implementation notes:

- Task result fields vary. Use tolerant extraction for `task_id`, `taskId`, `id`, or `activityId`.
- The detail panel should show readable task facts, content, reference text, and attachments instead of raw diagnostic JSON.
- Image attachments should render inline in the detail panel. Download them to the managed workspace first, then preview them through the workspace image-preview IPC instead of reading arbitrary local paths in the renderer.

## Draft Page

Purpose:

- Create local submission drafts manually without raw JSON editing.
- Review local AI-generated or user-created submission drafts.
- Approve or reject local drafts.
- Do not submit to Banxuebang automatically.
- Show drafts as readable review cards with task context, draft text, missing information, warnings, evidence, and review history instead of raw JSON.

Required actions:

- Load courses for manual draft creation: `list_courses({})`
- Load tasks for the selected course: `list_tasks({ subject_name, class_id, list_type: "all", page: 1, size })`
- Create draft: `draft_task_submission({ task_id, subject_name, task_title, draft_text, summary })`
- List pending drafts: `list_submission_drafts({ status: "pending_review" })`
- List all drafts: `list_submission_drafts({ status: "all" })`
- Open draft: `get_submission_draft({ draft_id })`
- Save edited draft text: `update_submission_draft({ draft_id, draft_text })`
- Approve draft: `approve_submission_draft({ draft_id, review_note })`
- Reject draft: `reject_submission_draft({ draft_id, review_note })`
- Delete local draft: `delete_submission_draft({ draft_id })`

UI requirements:

- The sidebar label should be `草稿`.
- Manual draft creation must use normal form controls for course, task, summary, and draft body; do not ask users to write JSON.
- Manual draft creation should be closed by default and opened from an explicit `新建草稿` button.
- While the manual draft form is open, hide the draft list and detail preview. Return to the list/detail layout after successful creation or cancellation.
- User-created drafts must default to `pending_review`.
- The draft body preview must be editable.
- Saving edits updates only the local draft JSON file and must not upload or submit anything.
- Deleting a draft must ask for confirmation and delete only the local draft JSON file.

Future upload/submit requirement:

- If submission is added later, the UI must show a confirmation screen with task, target course, text, files, and destination before calling upload or submit tools.

## Workspace Page

Purpose:

- Show the managed local workspace where user-imported files, assistant-downloaded attachments, and assistant-created text files are stored.
- Let non-technical users import local files without exposing raw filesystem mechanics.
- Let the Agent read and rename workspace files by filename or relative path.

Required actions:

- Refresh files: `list_workspace_files({})`
- Preview readable files: `read_workspace_file({ file, max_chars: 8000 })`
- Rename files: `rename_workspace_file({ file, new_name })`
- Create assistant text artifacts: `write_workspace_text_file({ file_name, content })`

UI requirements:

- Sidebar includes `工作区`.
- Page has buttons for importing files, refreshing files, and opening the workspace folder.
- File import uses Electron IPC to copy selected files into the managed workspace directory; the renderer must not read arbitrary paths directly.
- File list shows name, relative path, size, modified time, and type.
- Preview panel shows images inline, readable text for supported text-like files, and a diagnostic summary for unsupported files.
- Task attachment downloads should default to the workspace so files created by assistant actions are visible there.

## Private Messages Page

Purpose:

- Let the user read and send Banxuebang private messages inside the desktop client.
- Keep sending as a direct user action; the autonomous Agent must not send private messages by itself.

Required actions:

- Refresh contacts: `list_private_message_contacts({})`
- Open thread: `get_private_message_thread({ contact, size: 30 })`
- Send text: `send_private_message_text({ contact, content })`

Initial constraints:

- Text sending only.
- Image and attachment messages may render as `[图片]` or `[附件]` placeholders.
- Do not send any test message during automated verification.

## Model Settings

Model configuration lives inside the `设置` page, not in a separate sidebar page.

Fields:

- API Key.
- Base URL.
- Model name.
- Context length.

Actions:

- Save config.
- Read available models from the configured OpenAI-compatible `/models` endpoint.
- Test connectivity.
- Clear config.

Model name field:

- Allow manual text entry.
- After reading available models, show a dropdown so the user can choose a returned model id.
- Do not require a model name before reading the model list; only the base URL is required, with API Key included when provided.

Security requirements:

- API Key input must use password mode.
- Do not print raw API Key in JSON blocks or logs.
- Show only `apiKeyMasked` after save/test.
- Model config is local-only.

## Settings Page

Required controls:

- Model settings:
  - API Key.
  - Base URL.
  - Model name.
  - Model picker should render as one control: a manual text field before loading available models, then one dropdown after models are loaded.
  - Reading available models should only update the dropdown and status text; do not render the model-list JSON in the page.
  - Context length.
  - Assistant chat Temperature.
  - Context-compaction Temperature.
  - Save config.
  - Read available models.
  - Test connectivity.
  - Clear config.
- Theme: light/dark.
- Max tool rounds.
- AI system prompt textarea.
- Restore default system prompt.
- Save settings.
- GitHub repository link or copyable URL.
- Path card:
  - Do not render raw `appInfo` JSON.
  - Show app data, Banxuebang data, workspace, draft store, update cache, model config, conversation store, payload, and browser dependency paths as readable rows.
  - Each row should explain what is stored there and include an `打开路径` action.
- Update card for the Windows preview channel:
  - Show the current app version from Electron.
  - Check GitHub Releases for non-draft prereleases whose title starts with `BXB Homework Win v`.
  - Treat new Windows preview release titles as `BXB Homework Win v<major>.<minor>.<patch>-pre`.
  - Keep parsing older titles such as `BXB Homework Win v1.1.0-pre.3` for compatibility.
  - Show the latest version, installer size, publish time, and release notes when an update is found.
  - Let the user download and install inside the app only when the release includes both the `.exe` installer and the matching `.sha256` asset.
  - Download to the local update cache, show progress, verify file size and SHA256, then show `现在重启安装` and `稍后`.
  - On `现在重启安装`, launch the verified installer and quit the app. The NSIS installer should reopen the new version after installation.
  - Keep the Release page button as the manual fallback.

Default system prompt:

```text
你是伴学邦桌面助手。需要真实数据时必须调用工具，不要猜测。需要联网资料时先调用 web_search；需要阅读某个搜索结果时再调用 read_web_page。用户提到工作区文件时，先调用 list_workspace_files 定位文件，再按需调用 read_workspace_file；需要整理文件名时可调用 rename_workspace_file。不要上传、提交或删除任何内容。处理作业草稿时先调用 collect_task_submission_context；信息不足就说明缺什么；信息足够才调用 draft_task_submission 保存草稿等待用户审核。
```

## Safety Rules

Frontend must enforce these rules:

- Never display raw Banxuebang tokens.
- Never display raw API keys.
- Never commit local session files, model config, attachments, build output, or cache.
- Never call upload/submit tools without explicit user confirmation.
- The autonomous Agent should not be given upload/submit tools by default.
- Browser-based web search should stay low-volume and user-facing; do not use it for batch scraping.
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
- Confirm Agent can read task attachments through `download_task_attachment`, `read_task_attachment`, `extract_pdf_text`, and `extract_docx_text`.
- Confirm Agent can run a short calculation through `run_python_snippet`.

## Known Constraints

- The renderer uses a narrow IPC facade. Any new backend capability should be added behind `window.bxb`, not by enabling Node integration.
- Tool results are not fully normalized. Frontend code must tolerate multiple field names.
- PDF/DOCX text extraction and short Python snippets are available; PDF/DOCX editing and a full code sandbox are not yet part of the current frontend/backend contract.
- The archived Flutter prototype exists only for future reference and is not the active UI.
