# Frontend Requirements

This document is the current frontend baseline for the BXB Homework desktop client.

The active frontend is the Electron + React app in `desktop/`. The older Tk UI and archived Flutter prototype are reference material only.

## Product Principles

- Provide a desktop UI for Banxuebang homework, drafts, private messages, workspace files, model settings, and AI assistance.
- Keep Banxuebang sessions, model API keys, conversations, attachments, drafts, update downloads, and local workspace files on the user's machine.
- Hide raw tokens, raw API keys, raw session JSON, diagnostic path dumps, and command-line details from normal users.
- Let the Agent read, summarize, draft, and organize information, but do not let it upload, submit, delete, or send content by itself.
- Use readable page-specific views instead of raw JSON blocks unless a diagnostic view is explicitly needed.

## Navigation

The left sidebar contains:

- `主页`
- `助手`
- `作业`
- `工作区`
- `私信`
- `草稿`
- `设置`

The bottom-left Session card:

- Shows login state and account display name.
- Opens upward when clicked.
- Provides term switching only.
- Does not expose a global course selector. Course selection belongs to the pages that need it, such as `作业` and manual draft creation.
- Refreshes session state after term switching and clears page-level task/course selections that depend on the old term.

## Home Page

Purpose:

- Show that the app is ready, whether Banxuebang is logged in, and the current account/session summary.

Required content:

- Runtime summary: Electron UI, Agent availability, and login state.
- Login card:
  - Browser login.
  - Refresh session.
  - Local-session storage note.
- Session summary:
  - Account name.
  - Class name.
  - Current term.
  - Number of courses in the current term.
  - Pending homework count when available.

Rules:

- Do not show the current course on the home page.
- Do not render raw `session_status` JSON in normal UI.

## Agent Page

Purpose:

- Provide local AI chat with tool-backed Banxuebang and workspace access.

Layout:

- Left: conversation list.
- Middle: chat messages and composer.
- Right: expandable work-process timeline.
- Top toolbar: quick prompts, new conversation, and context usage meter.

Conversation requirements:

- Create a new conversation.
- Select a saved conversation and restore messages.
- Rename a conversation.
- Delete a conversation after in-app confirmation.
- Store conversations only in Electron userData.
- Do not use native blocking dialogs for destructive chat actions because they can break composer focus in Electron.

Chat requirements:

- User messages align right; assistant messages align left.
- User and assistant bubbles use visibly different colors.
- Assistant messages render Markdown, tables, code blocks, and inline/display math such as `$...$`, `$$...$$`, `\(...\)`, and `\[...\]`.
- Message bodies must not overflow the page; wide tables/code scroll inside the bubble.
- New messages auto-scroll into view.
- The composer remains focusable after new-chat, select-chat, rename, and delete flows.
- `/compact` summarizes older conversation context and keeps the compressed summary plus recent turns.

Agent progress requirements:

- Subscribe to `onAgentProgress`.
- Show elapsed time while a request is running.
- Display each tool/model step as expandable details.
- Preserve final `steps` returned by `chat()`.

Context meter:

- Prefer `usage.prompt_tokens` or `usage.promptTokens`.
- Fall back to an estimated count from recent messages.
- Use the configured context length from Settings.

Default Agent safety:

- Need real Banxuebang data: call tools, do not guess.
- Need web/current information: call `web_search`, then `read_web_page` for selected results.
- Need workspace files: call `list_workspace_files`, then `read_workspace_file` or `rename_workspace_file`.
- Homework drafts must be saved with `draft_task_submission` only after collecting context.
- If a task appears expired and may not allow supplement, the Agent may save target hints for private-message fallback, but still must only save a draft for review.
- Draft body text in `draft_text` must be plain text, not Markdown.
- The Agent must not upload, submit, delete, or send content.

## Homework Page

Purpose:

- Browse current-term homework without making the user manage a global current course.

Required actions:

- Load course choices: `list_courses({})`
- Refresh all tasks: `list_tasks({ subject_name, class_id, list_type: "all", page: 1, size: 30 })`
- Refresh pending tasks: `list_tasks({ subject_name, class_id, list_type: "pending", page: 1, size: 30 })`
- Open readable task detail: `read_task_content({ task_id, max_chars: 6000 })`

Course filtering:

- The page owns its course dropdown.
- The dropdown includes `全部课程`.
- Selecting `全部课程` aggregates tasks across current-term courses.
- Rows must keep course names visible.
- Do not require users to change global current subject before browsing homework.

Task table columns:

- ID
- Course
- Task title
- Deadline
- Score/status

Detail panel:

- Show task facts, readable content, reference text, and attachments.
- Use tolerant extraction for `task_id`, `taskId`, `id`, and `activityId`.
- Image attachments render inline by downloading to the managed workspace and previewing through workspace image IPC.
- The renderer must not read arbitrary local paths directly.

## Draft Page

Purpose:

- Let users create, review, approve, reject, delete, and explicitly deliver local homework drafts to either a homework Task or a teacher private message.

Draft states:

- `pending_review`: waiting for user review.
- `approved`: approved and eligible for explicit submission.
- `rejected`: rejected locally.
- `submitted`: successfully submitted to Banxuebang Task and read-only locally.
- `sent_to_teacher`: successfully sent to a teacher private-message contact and read-only locally.

Required actions:

- Load manual-draft courses: `list_courses({})`
- Load manual-draft tasks: `list_tasks({ subject_name, class_id, list_type: "all", page: 1, size })`
- Create draft: `draft_task_submission({ task_id, subject_name, task_title, draft_text, summary })`
- List pending drafts: `list_submission_drafts({ status: "pending_review" })`
- List approved drafts: `list_submission_drafts({ status: "approved" })`
- List submitted drafts: `list_submission_drafts({ status: "submitted" })`
- List teacher-message drafts: `list_submission_drafts({ status: "sent_to_teacher" })`
- List all drafts: `list_submission_drafts({ status: "all" })`
- Open draft: `get_submission_draft({ draft_id })`
- Save edited draft text: `update_submission_draft({ draft_id, draft_text })`
- Approve draft: `approve_submission_draft({ draft_id, review_note })`
- Reject draft: `reject_submission_draft({ draft_id, review_note })`
- Delete local draft: `delete_submission_draft({ draft_id })`
- Prepare submission preview: `prepare_draft_submission({ draft_id })`
- Submit after confirmation: `submit_approved_draft({ draft_id, confirmation_token })`
- Prepare teacher private-message preview: `prepare_draft_private_message({ draft_id, contact? })`
- Send after confirmation: `send_approved_draft_private_message({ draft_id, contact, confirmation_token })`

Manual draft creation:

- Open from an explicit `新建草稿` button.
- Closed by default.
- Uses normal controls for course, task, summary, and body.
- Does not ask users to write JSON.
- Hides the draft list and detail preview while the creation form is open.
- Returns to list/detail after successful creation or cancellation.
- User-created drafts default to `pending_review`.

Review and editing:

- Draft detail shows task, course, status, summary, editable draft body, warnings, missing information, evidence, review history, and delivery history.
- Saving edits updates only the local draft JSON.
- Saving must not upload or submit anything.
- Editing a rejected draft moves it back to `pending_review`.
- Delivered drafts (`submitted` or `sent_to_teacher`) are read-only. A later resubmission or re-send should use a new draft and a new review.
- Delete uses an in-app two-step confirmation, not native `confirm()`.

Delivery target flow:

- Only `approved` drafts may show delivery controls.
- Show a target selector with `提交到作业 Task` and `私信老师`.
- Default target is `提交到作业 Task`, unless the draft's preferred target is `teacher_private_message`.
- If there are unsaved edits, block delivery preparation and ask the user to save first.

Task submission flow:

- On submit preparation, call `prepare_draft_submission`.
- Show a confirmation screen with:
  - Target course.
  - Task title and task ID.
  - Destination.
  - Submit mode: submit, supplement, resubmit, or correction.
  - Full text that will be submitted.
  - Retained existing files, if any.
  - Warning or reason when automatic submission is not safe.
- Require a second explicit click on `确认并提交`.
- Pass the `confirmationToken` returned by `prepare_draft_submission`.
- Reject submission if the draft text or task state changed after the preview.
- Prevent duplicate submissions while a draft is already submitting.
- Use the task's own class ID, not the current global subject's class ID.
- If an existing submission is detected but no existing submission ID can be determined, block automatic submission to avoid duplicate records.
- If Banxuebang rejects the operation, keep the local draft `approved`, show the error, and show a `改用私信老师` entry.
- Mark the local draft `submitted` only after Banxuebang reports success.

Teacher private-message flow:

- First call `prepare_draft_private_message({ draft_id })` to get contact suggestions, full preview text, chunks, and a confirmation token.
- Contact suggestions are sorted by teacher name, task creator, course name, and class/course matches.
- Matching is only a suggestion; do not send automatically.
- If no contact is selected, show the full contact dropdown and keep send disabled.
- Selecting a contact calls `prepare_draft_private_message({ draft_id, contact })` again so the confirmation token covers the chosen contact.
- Preview must show contact, course, task title, task ID, and every chunk labeled `第 1/N 条`.
- Default preview text includes course, homework title, Task ID, a request asking the teacher to open/handle supplement, and the full draft body.
- The confirmation screen does not edit the body; users return to the draft editor to change text.
- Require a second explicit click on `确认并分条发送`.
- Pass the `confirmationToken` returned by the contact-specific preview.
- Reject send if the draft, task, contact, or chunk text changed after the preview.
- Prevent duplicate private-message sends while a draft is already sending.
- Send chunks sequentially through `sendPrivateMessageText`.
- If chunk N fails, stop subsequent chunks, keep the local draft `approved`, and show sent count plus the error.
- Mark the local draft `sent_to_teacher` only after all chunks succeed.

Agent boundary:

- `prepare_draft_submission`, `submit_approved_draft`, `prepare_draft_private_message`, `send_approved_draft_private_message`, `upload_submission_file`, `send_private_message_text`, and `submit_task_result` must not be exposed to the autonomous Agent tool set.

## Workspace Page

Purpose:

- Show the managed local workspace for user-imported files, downloaded task attachments, and assistant-created text files.

Required actions:

- Refresh files: `list_workspace_files({})`
- Preview readable files: `read_workspace_file({ file, max_chars: 8000 })`
- Rename files: `rename_workspace_file({ file, new_name })`
- Create assistant text artifacts: `write_workspace_text_file({ file_name, content })`

UI requirements:

- Include buttons for importing files, refreshing files, and opening the workspace folder.
- File import uses Electron IPC to copy selected files into the managed workspace.
- The renderer must not read arbitrary local paths directly.
- File list shows name, relative path, size, modified time, and type.
- Preview panel shows images inline, readable text for supported files, and a diagnostic summary for unsupported files.
- Task attachment downloads default to the workspace so generated/downloaded files remain visible.

## Private Messages Page

Purpose:

- Let the user read and send Banxuebang private messages from the desktop client.

Required actions:

- Refresh contacts: `list_private_message_contacts({})`
- Open thread: `get_private_message_thread({ contact, size: 30 })`
- Send text: `send_private_message_text({ contact, content })`

Rules:

- Sending is always a direct user action.
- The autonomous Agent must not send private messages.
- Text sending is the current supported mode.
- Image and attachment messages may render as `[图片]` or `[附件]`.
- Automated verification must not send test messages.

## Settings Page

Purpose:

- Combine model configuration, appearance, Agent behavior, path visibility, and software update controls in one `设置` page.

Model settings:

- API Key, shown as a password field.
- Base URL.
- Model name.
- Model picker:
  - Before reading models, allow manual text entry.
  - After reading models, show one dropdown using returned model IDs.
  - Do not render raw model-list JSON after reading models.
- Context length.
- Assistant chat Temperature.
- Context-compaction Temperature.
- Save config.
- Read available models from an OpenAI-compatible `/models` endpoint.
- Test connectivity.
- Clear config.

Security:

- Never show raw API Key.
- Show only masked key information after save/test.
- Model config is local-only.

Interface and Agent controls:

- Theme: light/dark.
- Max tool rounds.
- AI system prompt textarea.
- Restore default system prompt.
- Save settings.
- GitHub repository link or copyable URL.

Path card:

- Do not render raw `appInfo` JSON.
- Show readable rows for:
  - App data directory.
  - Banxuebang data directory.
  - Workspace.
  - Draft store.
  - Update cache.
  - Model config file.
  - Conversation store.
  - Payload directory.
  - Browser dependency directory.
- Each row explains what is stored there.
- Each row has an `打开路径` action.

Software update card:

- Channel: Windows preview.
- Show the current Electron app version.
- Check GitHub Releases for non-draft prereleases whose title starts with `BXB Homework Win v`.
- Current title/tag convention uses `BXB Homework Win v<major>.<minor>.<patch>-pre`.
- Keep parsing older titles like `BXB Homework Win v1.1.0-pre.3` for compatibility.
- Show latest version, installer size, publish time, and release notes when an update is found.
- In-app download/install is allowed only when the release has both the `.exe` installer and matching `.sha256` asset.
- Download into the local update cache.
- Show download progress.
- Verify file size and SHA256.
- After verification, show `现在重启安装` and `稍后`.
- On `现在重启安装`, launch the verified installer and quit the app.
- The NSIS installer should overwrite the current installation and reopen the new version after installation.
- Keep the Release page button as the manual fallback.

## Default System Prompt

```text
你是伴学邦桌面助手。需要真实数据时必须调用工具，不要猜测。需要联网资料时先调用 web_search；需要阅读某个搜索结果时再调用 read_web_page。用户提到工作区文件时，先调用 list_workspace_files 定位文件，再按需调用 read_workspace_file；需要整理文件名时可调用 rename_workspace_file。不要上传、提交、私信或删除任何内容。处理作业草稿时先调用 collect_task_submission_context；信息不足就说明缺什么；信息足够才调用 draft_task_submission 保存草稿等待用户审核。如果作业已过期且可能无法补交，可以在草稿提示字段中建议用户私信老师，但只能保存草稿等待用户审核。给出或保存草稿正文时，draft_text 必须是纯文本正文，不要使用 Markdown 标题、列表、表格、代码块、加粗、引用或其他 Markdown 格式；如果需要给用户说明保存状态，可以在助手回复里用 Markdown，但草稿正文内容本身必须保持纯文本。
```

## Safety Rules

Frontend must enforce:

- Never display raw Banxuebang tokens.
- Never display raw API keys.
- Never commit local session files, model config, attachments, build output, cache, or backups.
- Never call upload/submit tools without explicit user confirmation in the same interaction.
- Never expose upload/submit tools to the autonomous Agent by default.
- Never send private messages from the Agent.
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

Required checks before release packaging:

- `npm run check` from the repository root.
- `npm run check` from `desktop/`.
- `npm run scan:publish` from the repository root.
- `cd desktop; npm run dist`.
- Start `dist-electron-app/win-unpacked/BXB Homework.exe`.

Manual smoke checklist:

- App window title is `BXB Homework`.
- Login/session summary works without raw JSON.
- Term switching has exactly one selected term.
- Home page shows pending homework count instead of current course.
- Homework page course dropdown can load `全部课程` and concrete courses.
- Task detail renders readable text and attachments.
- Agent can call at least `list_courses` and `list_tasks`.
- Agent composer remains usable after chat create/select/delete flows.
- Markdown math renders in assistant messages.
- Draft creation opens as a form and returns to list/detail after creation.
- Approved draft submission shows the confirmation screen and requires a second click.
- Submission failures remain visible and do not mark drafts submitted.
- Model config can save, read models, test, and clear without exposing raw API Key.
- Path card shows readable paths with open actions, not raw `appInfo`.
- Update card can check releases and keeps manual Release page fallback.

## Known Constraints

- The renderer uses a narrow IPC facade. New backend capabilities should be added behind `window.bxb`; keep Node integration disabled.
- Banxuebang tool result shapes vary. Frontend code must tolerate multiple field names.
- PDF/DOCX text extraction and short Python snippets are available; full document editing and a general code sandbox are not part of the current frontend contract.
- The archived Flutter prototype is not the active UI baseline.
