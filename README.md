# BXB Homework

BXB Homework is a local desktop assistant for the Banxuebang student portal. It brings homework, attachments, grades, private messages, workspace files, and an AI assistant into one desktop app.

The current primary client is the WinUI app in `frontend/winui/`. The Electron + React app remains in `frontend/electron/`, and the legacy Tk shell remains in `frontend/tk/`. The local capability layer in `backend/src/` handles Banxuebang login state, course and homework APIs, attachment reading, workspace file operations, browser-based web search, and MCP-compatible tool access.

Older UI experiments remain in the repository for reference, but they are not the active desktop baseline.

## Features

- Browser-based Banxuebang login with local session persistence.
- Term and course switching, including an `全部课程` context for aggregating homework across all current-term courses.
- Homework center with pending/all task views and readable task details.
- Task content and attachment reading, including PDF and DOCX text extraction.
- Workspace file management for imported user files, downloaded attachments, and assistant-created files.
- Built-in AI assistant that can call local Banxuebang tools, read workspace files, organize homework context, and create local submission drafts.
- Local browser-based web search with Bing as the default search engine, without requiring users to configure a search API key.
- Private messages page for reading contacts, opening message threads, and sending text messages.
- Model settings page for OpenAI-compatible endpoints, including `/models` discovery and model selection.
- Review page for approving or rejecting local AI-generated submission drafts.

## Safety Model

- Banxuebang sessions, model API keys, workspace files, and drafts stay local by default.
- The autonomous assistant is not allowed to upload homework, submit homework, or send private messages by default.
- Real account actions such as upload and submit must be confirmed by the user through the UI.
- User-facing screens should avoid showing raw JSON, tokens, API keys, internal paths, or stack traces.

## Local Development

BXB Homework requires Node.js 22 or newer.

Install root dependencies:

```powershell
npm install
```

Install desktop dependencies:

```powershell
cd frontend/electron
npm install
```

Start the desktop development app:

```powershell
cd frontend/electron
npm run start
```

Build the desktop frontend:

```powershell
cd frontend/electron
npm run build
```

Package the Windows desktop app:

```powershell
.\frontend\winui\package-winui.ps1 -Configuration Release
```

The packaged Windows app is generated under `dist-winui-app/`.

## Local Tool Layer

The root package can also be used directly as a local Banxuebang tool layer or MCP server.

Start the MCP server:

```powershell
npm start
```

Call tools through MCP stdio:

```powershell
npm run tool:mcp -- session_status
npm run tool:mcp -- list_courses
```

Call tools directly without MCP:

```powershell
npm run tool:direct -- session_status
npm run tool:direct -- list_tasks list_type=pending
```

First-time use usually requires browser login:

```powershell
npm run tool:direct -- login_in_browser
```

## macOS 运行（BXB 学业助手）

本项目在 macOS 上使用 pnpm 运行与打包。

### 开发运行

```bash
# 安装根依赖（Playwright、pdf-parse 等）
pnpm install

# 安装 Electron 前端依赖（首次会下载 Electron 二进制，国内可用镜像）
cd frontend/electron
ELECTRON_MIRROR="https://npmmirror.com/mirrors/electron/" pnpm install

# 安装 Playwright Chromium（macOS）
cd ../..
PLAYWRIGHT_DOWNLOAD_HOST="https://npmmirror.com/mirrors/playwright" pnpm exec playwright install chromium

# 启动应用
cd frontend/electron
pnpm start
```

### 打包 macOS 应用

```bash
cd frontend/electron
pnpm run dist:mac
```

产物输出到 `dist-electron-app/`（.app 与 .dmg）。

### macOS 版新增功能

- 功能开关：设置页可独立开关自动识别作业、AI 自动完成、知识点复习、GPA 预警、未交作业提醒、自动提交、图片 OCR、桌面通知；
- 知识点复习：从作业正文与附件整理复习笔记（PDF/DOCX 文本 + 本地 Vision OCR，需安装 Xcode Command Line Tools 才能启用 OCR），可调用已配置的模型生成 AI 总结卡片；
- GPA 预警：等级达到危险线（默认 B，可调）时在主页显示红色预警并发送桌面通知；
- 未交作业提醒：截止前 24h/6h/1h 与逾期提醒；
- AI 自动完成（实验版）：自动识别未交作业并生成答案草稿；默认提交模式为"审核后提交"，真正发出前必须由你在草稿页确认。

### 说明

- 自动更新在 macOS 上暂不提供；
- 本仓库无开源许可证，仅限个人自用；
- 登录态、API Key、草稿、复习笔记均只保存在本机应用数据目录。

## Main Tool Capabilities

The local tool layer includes:

- Login and session tools: `session_status`, `login_in_browser`, `login_with_credentials`, `refresh_context`
- Term and course tools: `list_terms`, `set_current_term`, `list_courses`, `set_current_subject`
- Homework tools: `list_tasks`, `open_task`, `read_task_content`
- Grade tools: `get_current_subject_gpa`, `get_achievement_overview`
- Attachment and document tools: `download_task_attachment`, `read_task_attachment`, `extract_pdf_text`, `extract_docx_text`
- Workspace tools: `list_workspace_files`, `read_workspace_file`, `rename_workspace_file`, `write_workspace_text_file`
- Web tools: `web_search`, `read_web_page`
- Private message tools: `list_private_message_contacts`, `get_private_message_thread`, `send_private_message_text`
- Draft review tools: `collect_task_submission_context`, `draft_task_submission`, `list_submission_drafts`, `get_submission_draft`, `approve_submission_draft`, `reject_submission_draft`
- Submission tools: `upload_submission_file`, `submit_task_result`

`upload_submission_file` and `submit_task_result` affect real Banxuebang account data and must not be exposed as default autonomous assistant actions.

## Maintainer Notes

- Native Windows UI work should usually happen in `frontend/winui/`.
- Legacy Electron UI work should usually happen in `frontend/electron/`.
- Shared Banxuebang capability work should usually happen in `backend/src/`.
- New renderer-facing capabilities should be exposed through `window.bxb` and Electron IPC, not direct Node access from the renderer.
- Do not commit local sessions, model configs, attachments, drafts, build outputs, or browser caches.
