# Banxuebang Achievement MCP

这是一个面向 `https://student.banxuebang.com/achievement_list` 的 MCP 服务。

## Prerequisites

- Node.js >= 22

设计目标不是“纯 DOM 自动化”，而是混合模式：

- 登录和首登确认通过浏览器完成
- 数据读取优先走站点已有 HTTP API
- 页面打开和截图校验由 Playwright 兜底

## Repo Layout

```text
src/
  index.js                 MCP server entry
  banxuebang-client.js     Banxuebang session + API client
  session-store.js         local session persistence
  tool-definitions.js      shared tool registry for MCP + direct CLI
scripts/
  call-tool.js             local CLI for calling MCP tools over stdio
  direct-tool.js           local CLI that bypasses MCP and calls the client directly
  setup-agent.js           generate a ready-to-use local MCP config snippet
  ui-server.js             local browser UI for tool debugging
  publish-scan.js          pre-publish safety scan
ui/
  index.html               local debug UI
README.md
PROMPTS.md
COPOLICY.md
package.json
```

本地运行产生的会话、附件、截图和调试输出统一放在这些目录，并且默认被忽略：

- `.banxuebang/`
- `.playwright-cli/`
- `artifacts/`

## Current Tools

当前 MCP 暴露的工具包括：

- `session_status`
- `interactive_login`
- `login_in_browser`
- `login_with_credentials`
- `import_browser_storage`
- `refresh_context`
- `list_terms`
- `set_current_term`
- `list_courses`
- `set_current_subject`
- `list_homework`
- `list_tasks`
- `get_achievement_overview`
- `get_current_subject_gpa`
- `open_task`
- `read_task_content`
- `download_task_attachment`
- `read_task_attachment`
- `upload_submission_file`
- `submit_task_result`
- `browser_capture_achievement_page`
- `clear_session`

## Install

```bash
git clone <repository-url>
cd BXB_tools
npm install
```

如果要使用浏览器登录、自动登录或截图能力，还需要准备 Chromium：

```bash
npx playwright install chromium
```

如果你的 MCP 客户端或本机环境提示缺少 `modelcontextprotocol`，请按该客户端的要求额外安装它。
部分 macOS 环境下，可能需要这一步后才能正常启动本服务。

启动 MCP：

```bash
npm start
```

通过 MCP over stdio 调试某个工具：

```bash
node scripts/call-tool.js session_status
node scripts/call-tool.js set_current_subject subject_name= COURSE_NAME
```

如果当前 AI 或终端已经直接在仓库目录里运行，不想额外经过 MCP，也可以直接调用本地 CLI：

```bash
node scripts/direct-tool.js session_status
node scripts/direct-tool.js set_current_subject subject_name= COURSE_NAME
```

等价的 npm script：

```bash
npm run tool:mcp -- session_status
npm run tool:direct -- session_status
```

## Usage

**首次使用前必须先登录**，登录后才能使用 `session_status`、`list_terms`、`list_courses` 等工具。

如果你需要给上层模型一套更稳定的调用提示词，可直接参考 [PROMPTS.md](./PROMPTS.md)。
如果你需要一份协作/安全约束，可直接参考 [COPOLICY.md](./COPOLICY.md)。

`list_tasks` 支持直接指定上下文，而不必先手工切换：

```bash
node scripts/call-tool.js list_tasks term_name=2025-2026下学期 subject_name=国际公民素养 list_type=pending page=1 size=5
node scripts/direct-tool.js list_tasks term_name=2025-2026下学期 subject_name=国际公民素养 list_type=pending page=1 size=5
```

`open_task` 默认不再附带其他同学的提交状态列表；如果你确实需要它，再显式打开：

```bash
node scripts/call-tool.js open_task task_id=2046748211590590465 include_other_submissions=true
node scripts/direct-tool.js open_task task_id=2046748211590590465 include_other_submissions=true
```

## Cross-Platform Notes

macOS / Linux 也可以直接运行本项目，主要差异只有命令格式和 Playwright 浏览器依赖：

- 克隆后执行 `npm install`
- 如果需要浏览器登录或截图，再执行 `npx playwright install chromium`
- 本地调试时，用 `node scripts/call-tool.js ...` 或 `node scripts/direct-tool.js ...`
- 在 `bash` / `zsh` 下，JSON 参数推荐用单引号包整段

示例：

```bash
node scripts/call-tool.js session_status
node scripts/direct-tool.js list_tasks term_name="2025-2026下学期" subject_name="国际公民素养" list_type=all page=1 size=3
node scripts/call-tool.js login_with_credentials '{"username":"your-account","password":"your-password","headless":false}'
```

## One-Click Agent Setup

如果你想快速给支持 MCP 的 AI 客户端准备本地配置，可以执行：

```bash
npm run setup:agent
```

它会在仓库根目录生成 `mcp.local.json`，内容会自动带上当前机器上的绝对路径，方便直接复制到客户端配置里。

## Local UI

如果你想用浏览器调试工具，而不是手敲命令行：

```bash
npm run ui
```

然后打开：

```text
http://127.0.0.1:4317
```

本地 UI 会列出所有工具，并对 `upload_submission_file` / `submit_task_result` 强制要求额外确认。

## CI Workflow

仓库现在带有 GitHub Actions 工作流：

- `npm ci`
- `npm run check`
- `npm run scan:publish`

## Login Flow

推荐首登方式有两种：

1. 手动浏览器登录

```bash
node scripts/call-tool.js login_in_browser
node scripts/direct-tool.js login_in_browser
```

2. 浏览器填表自动登录

```bash
node scripts/call-tool.js login_with_credentials '{"username":"your-account","password":"your-password","headless":false}'
node scripts/direct-tool.js login_with_credentials '{"username":"your-account","password":"your-password","headless":false}'
```

登录成功后，建议立刻执行：

```bash
node scripts/call-tool.js session_status
node scripts/call-tool.js list_terms
node scripts/call-tool.js list_courses
node scripts/direct-tool.js session_status
node scripts/direct-tool.js list_terms
node scripts/direct-tool.js list_courses
```

