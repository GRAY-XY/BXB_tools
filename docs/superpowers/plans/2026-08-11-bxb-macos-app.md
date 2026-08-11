# BXB 学业助手 macOS 版 Implementation Plan

> **For agentic workers:** 本计划按任务顺序执行，任务使用 `- [ ]` 复选框跟踪。执行方式：本会话内联执行（当前协作模式不允许派发子代理）。

**Goal:** 把 GRAY-XY/BXB_tools 改造成可在 macOS 上运行、带全局功能开关、自动完成+人工审核提交、附件知识点复习、危险 GPA 预警、未交作业提醒的 Electron 桌面应用。

**Architecture:** 沿用现有 Electron 主进程 + React 渲染进程 + Node/Playwright 后端三层结构。新功能以独立模块（feature-config、alerts、knowledge-engine、auto-pipeline、ocr）加入，主进程通过 IPC 暴露给渲染进程，后端通过 tool-definitions 暴露给 Agent。

**Tech Stack:** Electron 39、React 19、Vite 7、Node >=22、Playwright 1.54、pdf-parse、mammoth、macOS Vision（OCR，本地 Swift 脚本）。

## Global Constraints

- 平台：macOS（arm64 与 x64 兼顾），Node >= 22。
- 不推送到 GitHub，仅本地 git 提交。
- 所有提交动作必须走现有确认令牌机制；课程默认提交模式 =「审核后提交」。
- API key、会话、草稿、复习笔记、功能配置只存本机 userData，绝不外发。
- OCR 仅用本地 macOS Vision；LLM 仅用用户配置的 OpenAI 兼容接口。
- 功能开关默认值以设计文档 4.1 表格为准（AI 自动完成默认关、自动提交默认关）。
- 渲染进程只能通过 `window.bxb` 访问能力，不得直接读 Node 模块。
- 不在代码中提交登录会话、API key、草稿、构建产物。

---

## File Structure

| 文件 | 责任 | 动作 |
| --- | --- | --- |
| `frontend/electron/package.json` | mac 构建配置、脚本 | 修改 |
| `frontend/electron/electron/feature-config.cjs` | 功能开关默认值/读写/合并 | 新建 |
| `frontend/electron/electron/alerts.cjs` | GPA 预警 + 未交作业提醒状态机 | 新建 |
| `frontend/electron/electron/auto-pipeline.cjs` | 自动完成+审核提交编排 | 新建 |
| `frontend/electron/electron/main.cjs` | IPC、平台适配、更新禁用、定时器 | 修改 |
| `frontend/electron/electron/preload.cjs` | 暴露新增 IPC | 修改 |
| `frontend/electron/src/main.jsx` | 新增页面：开关、复习、预警 | 修改 |
| `frontend/electron/src/styles.css` | 新页面样式 | 修改 |
| `backend/src/banxuebang-client.js` | Playwright mac 启动路径 | 修改 |
| `backend/src/tool-definitions.js` | 新增工具注册 | 修改 |
| `backend/src/ocr.js` | Swift Vision OCR 封装 | 新建 |
| `backend/src/knowledge-engine.js` | 附件解析→聚合→LLM 总结 | 新建 |
| `scripts/ocr_vision.swift` | macOS Vision OCR 可执行脚本 | 新建 |
| `README.md` | macOS 运行说明 | 修改 |
| `docs/superpowers/plans/2026-08-11-bxb-macos-app.md` | 本计划 | 新建 |

---

## M1：macOS 可运行

### Task 1: Electron mac 构建配置

**Files:**
- Modify: `frontend/electron/package.json`

**Interfaces:**
- Consumes: 无
- Produces: `npm run dist:mac` 命令；`build.mac` 配置；`extraResources` 移除不存在的 Windows 浏览器压缩包。

- [ ] **Step 1: 修改 scripts 与 build 配置**

在 `scripts` 中新增：
```json
"dist:mac": "npm run build && electron-builder --mac"
```

在 `build` 中新增 `mac` 段，并从 `extraResources` 删除 `build_assets/ms-playwright-browsers.zip` 一行：
```json
"mac": {
  "target": [
    { "target": "dmg", "arch": ["arm64", "x64"] },
    { "target": "zip", "arch": ["arm64", "x64"] }
  ],
  "category": "public.app-category.education",
  "artifactName": "BXB-Assistant-${version}-${arch}.${ext}"
}
```

- [ ] **Step 2: 校验 JSON**

运行：`node -e "JSON.parse(require('fs').readFileSync('frontend/electron/package.json','utf8')); console.log('ok')"`
预期：输出 `ok`

- [ ] **Step 3: 提交**

```bash
git add frontend/electron/package.json
git commit -m "build: add mac target and dist:mac script"
```

### Task 2: Playwright macOS 启动支持

**Files:**
- Modify: `backend/src/banxuebang-client.js:269-295`
- Modify: `frontend/electron/electron/main.cjs`（`browserDependency` 候选路径）

**Interfaces:**
- Consumes: 无
- Produces: `launchBrowser(headless)` 在 darwin 上可启动；`getAppInfo().browserDependency.candidates` 含 mac 路径。

- [ ] **Step 1: 修改 launchBrowser 候选路径**

将 `executableCandidates` 构造改为按平台生成：
```js
const isMac = process.platform === "darwin";
const executableCandidates = browserRootCandidates.flatMap((browserRoot) => {
  const win = [
    path.join(browserRoot, "chromium-1217", "chrome-win64", "chrome.exe"),
    path.join(browserRoot, "chromium-1217", "chrome-win", "chrome.exe"),
  ];
  const mac = [
    path.join(browserRoot, "chromium-1217", "chrome-mac", "Chromium.app", "Contents", "MacOS", "Chromium"),
    path.join(browserRoot, "chromium-1217", "chrome-mac-arm64", "Chromium.app", "Contents", "MacOS", "Chromium"),
    path.join(browserRoot, "chromium_headless_shell-1217", "chrome-mac", "headless_shell"),
  ];
  return isMac ? mac : win;
});
```

mac 下若候选不存在，回退为 Playwright 默认解析（去掉 `channel: "chromium"`）：
```js
if (executablePath) {
  launchOptions.executablePath = executablePath;
} else if (!isMac) {
  launchOptions.channel = "chromium";
}
```

- [ ] **Step 2: 修改 main.cjs 的 browserDependency 候选**

找到 `getAppInfo` 中 `browserDependency` 的 `candidates` 计算处，按同样规则追加 mac 路径（与 Step 1 的候选列表一致），并让 `source` 在 darwin 下显示 `"existing-cache" | "missing"`。

- [ ] **Step 3: 语法校验**

运行：`node --check backend/src/banxuebang-client.js && node --check frontend/electron/electron/main.cjs`
预期：无输出（通过）

- [ ] **Step 4: 提交**

```bash
git add backend/src/banxuebang-client.js frontend/electron/electron/main.cjs
git commit -m "feat: support Playwright chromium on macOS"
```

### Task 3: 主进程平台适配（darwin 禁用更新）

**Files:**
- Modify: `frontend/electron/electron/main.cjs`

**Interfaces:**
- Consumes: `getAppInfo()` 既有返回
- Produces: `updateChannel` 在 darwin 为 `"macOS preview"`；更新相关 IPC 在 darwin 返回 `{ status: "unsupported", message }`。

- [ ] **Step 1: 修改更新相关函数**

在 `checkForUpdates`、`downloadUpdate`、`installUpdate`、`getUpdateStatus` 开头加守卫：
```js
if (process.platform === "darwin") {
  return { status: "unsupported", message: "macOS 版本暂不提供自动更新", update: null, downloadedBytes: 0, totalBytes: 0, percent: 0, filePath: null };
}
```

将 `getAppInfo` 返回中的 `updateChannel` 改为：
```js
updateChannel: process.platform === "darwin" ? "macOS preview" : "Windows stable",
```

- [ ] **Step 2: 语法校验 + 提交**

运行：`node --check frontend/electron/electron/main.cjs`

```bash
git add frontend/electron/electron/main.cjs
git commit -m "feat: disable auto-update on macOS"
```

### Task 4: 依赖安装与冷启动验证

**Files:**
- 无代码改动

- [ ] **Step 1: 安装依赖**

```bash
cd frontend/electron && pnpm install
cd ../.. && pnpm install
```
若 electron 二进制下载失败，改用 `pnpm install --no-optional` 后单独 `pnpm exec electron --version` 验证。

- [ ] **Step 2: 安装 Playwright Chromium（mac）**

```bash
pnpm exec playwright install chromium
```
预期：`~/Library/Caches/ms-playwright/chromium-*/chrome-mac/...` 存在。

- [ ] **Step 3: 启动应用**

```bash
cd frontend/electron && pnpm start
```
预期：窗口打开，主页显示 Electron UI 可用、Agent 未配置、未登录。

---

## M2：开关、预警、提醒、复习（原文模式）

### Task 5: 功能开关模块 + IPC

**Files:**
- Create: `frontend/electron/electron/feature-config.cjs`
- Modify: `frontend/electron/electron/main.cjs`、`frontend/electron/electron/preload.cjs`

**Interfaces:**
- Consumes: 无
- Produces:
  - `loadFeatureConfig(): FeatureConfig`
  - `saveFeatureConfig(patch: Partial<FeatureConfig>): FeatureConfig`
  - `FeatureConfig` 字段：`{ autoDetect: boolean; autoComplete: boolean; knowledgeReview: boolean; gpaAlert: boolean; reminder: boolean; autoSubmit: boolean; ocr: boolean; notifications: boolean; gpaThreshold: "A"|"B"|"C"|"D"; remindLeadHours: number[]; checkIntervalMinutes: number }`

- [ ] **Step 1: 新建 feature-config.cjs**

```js
const fs = require("node:fs/promises");
const path = require("node:path");

const DEFAULTS = {
  autoDetect: true,
  autoComplete: false,
  knowledgeReview: true,
  gpaAlert: true,
  reminder: true,
  autoSubmit: false,
  ocr: true,
  notifications: true,
  gpaThreshold: "B",
  remindLeadHours: [24, 6, 1],
  checkIntervalMinutes: 10,
};

async function loadFeatureConfig(filePath) {
  try {
    const raw = await fs.readFile(filePath, "utf8");
    return { ...DEFAULTS, ...JSON.parse(raw) };
  } catch {
    return { ...DEFAULTS };
  }
}

async function saveFeatureConfig(filePath, patch) {
  const current = await loadFeatureConfig(filePath);
  const next = { ...current, ...patch };
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, JSON.stringify(next, null, 2), "utf8");
  return next;
}

module.exports = { DEFAULTS, loadFeatureConfig, saveFeatureConfig };
```

- [ ] **Step 2: main.cjs 接线**

新增 `featureConfigPath = path.join(userDataRoot, "feature-config.json")`；注册 IPC：
```js
ipcMain.handle("feature:get", () => loadFeatureConfig(featureConfigPath));
ipcMain.handle("feature:save", (_e, patch) => saveFeatureConfig(featureConfigPath, patch));
```

- [ ] **Step 3: preload.cjs 暴露**

```js
getFeatureConfig: () => ipcRenderer.invoke("feature:get"),
saveFeatureConfig: (patch) => ipcRenderer.invoke("feature:save", patch),
```

- [ ] **Step 4: 校验 + 提交**

```bash
node --check frontend/electron/electron/feature-config.cjs && node --check frontend/electron/electron/main.cjs && node --check frontend/electron/electron/preload.cjs
git add frontend/electron/electron
git commit -m "feat: add feature config store and IPC"
```

### Task 6: 设置页「功能开关」UI

**Files:**
- Modify: `frontend/electron/src/main.jsx`、`frontend/electron/src/styles.css`

**Interfaces:**
- Consumes: `window.bxb.getFeatureConfig()`、`window.bxb.saveFeatureConfig(patch)`
- Produces: 设置页新增"功能开关"分组，每个开关为 checkbox，变更即保存。

- [ ] **Step 1: 渲染开关分组**

在设置页（`page === "settings"`）的模型配置上方插入 `<FeatureToggles />` 组件：
```jsx
function FeatureToggles({ config, onChange }) {
  const rows = [
    ["autoDetect", "自动识别作业"],
    ["autoComplete", "AI 自动完成（实验）"],
    ["knowledgeReview", "知识点复习"],
    ["gpaAlert", "GPA 预警"],
    ["reminder", "未交作业提醒"],
    ["autoSubmit", "自动提交（实验）"],
    ["ocr", "图片 OCR"],
    ["notifications", "桌面通知"],
  ];
  return (
    <div className="feature-grid">
      {rows.map(([key, label]) => (
        <label key={key} className="feature-toggle">
          <input type="checkbox" checked={!!config[key]} onChange={(e) => onChange({ [key]: e.target.checked })} />
          <span>{label}</span>
        </label>
      ))}
    </div>
  );
}
```

设置页挂载时 `getFeatureConfig()`，每次切换调用 `saveFeatureConfig({ [key]: value })` 并更新本地 state。

- [ ] **Step 2: 样式**

在 `styles.css` 追加 `.feature-grid`、`.feature-toggle`（网格布局、hover 高亮）。

- [ ] **Step 3: 提交**

```bash
git add frontend/electron/src/main.jsx frontend/electron/src/styles.css
git commit -m "feat: add feature toggles UI in settings"
```

### Task 7: GPA 预警引擎

**Files:**
- Create: `frontend/electron/electron/alerts.cjs`
- Modify: `frontend/electron/electron/main.cjs`、`preload.cjs`、`src/main.jsx`

**Interfaces:**
- Consumes: `getFeatureConfig()`、后端 `getAchievementOverview` 返回（`averageLevel: string|null`）
- Produces:
  - `evaluateGpaAlert(overview, threshold): GpaAlert[]`，其中 `GpaAlert = { subject, level, dangerous: boolean }`
  - `getAlertSummary(): { gpa: GpaAlert[]; reminders: ReminderItem[] }`
  - `onAlert(callback)` 推送事件

- [ ] **Step 1: alerts.cjs 核心逻辑**

```js
const LEVEL_RANK = { A: 4, B: 3, C: 2, D: 1 };

function evaluateGpaAlert(overview, threshold) {
  if (!overview?.averageLevel) return [];
  const level = String(overview.averageLevel).toUpperCase();
  const dangerous = (LEVEL_RANK[level] ?? 0) <= (LEVEL_RANK[threshold] ?? 3);
  return [{
    subject: overview.context?.currentSubject?.subjectName || "当前科目",
    level,
    dangerous,
  }];
}

module.exports = { evaluateGpaAlert };
```

- [ ] **Step 2: main.cjs 集成**

登录态刷新后（复用现有 session 刷新点）调用 `getAchievementOverview`（通过 toolRuntime），用 `evaluateGpaAlert` 计算；`dangerous` 且当日未提醒过（`alert-state.json`）时发 `new Notification({ title: "GPA 预警", body: ... })`；`getAlertSummary` IPC 返回合并结果。

- [ ] **Step 3: 主页预警卡片**

主页新增卡片：读取 `getAlertSummary()`，列出 `dangerous` 科目与等级；等级恢复正常后自动消失。

- [ ] **Step 4: 校验 + 提交**

```bash
node --check frontend/electron/electron/alerts.cjs
git add frontend/electron/electron/alerts.cjs frontend/electron/electron/main.cjs frontend/electron/electron/preload.cjs frontend/electron/src/main.jsx
git commit -m "feat: GPA alert engine and home warning card"
```

### Task 8: 未交作业提醒引擎

**Files:**
- Modify: `frontend/electron/electron/alerts.cjs`、`main.cjs`、`src/main.jsx`

**Interfaces:**
- Consumes: 后端 `list_tasks`（pending）返回（含 `endTime`/`deadline` 字段）、`getFeatureConfig().remindLeadHours`
- Produces: `evaluateReminders(tasks, now, leadHours): ReminderItem[]`；`ReminderItem = { taskId, title, subject, endTime, status: "upcoming"|"overdue", hoursLeft? }`

- [ ] **Step 1: 实现 evaluateReminders**

```js
function evaluateReminders(tasks, now = new Date(), leadHours = [24, 6, 1]) {
  const items = [];
  for (const task of tasks) {
    const end = task.endTime ? new Date(task.endTime) : null;
    if (!end || Number.isNaN(end.getTime())) continue;
    const hoursLeft = (end - now) / 36e5;
    if (hoursLeft < 0) {
      items.push({ taskId: task.id, title: task.title, subject: task.subjectName || "", endTime: task.endTime, status: "overdue", hoursLeft: 0 });
    } else if (leadHours.some((h) => hoursLeft <= h && hoursLeft > h - 1)) {
      items.push({ taskId: task.id, title: task.title, subject: task.subjectName || "", endTime: task.endTime, status: "upcoming", hoursLeft: Math.ceil(hoursLeft) });
    }
  }
  return items;
}
```

- [ ] **Step 2: main.cjs 定时器**

每 `checkIntervalMinutes` 分钟执行一次（受 `reminder` 与 `notifications` 开关控制）：`list_tasks` → `evaluateReminders` → 对 `alert-state.json` 未记录过的组合发通知并记录；逾期每日一次。

- [ ] **Step 3: 提交**

```bash
git add frontend/electron/electron/alerts.cjs frontend/electron/electron/main.cjs
git commit -m "feat: unsubmitted homework reminder engine"
```

### Task 9: 复习页（原文模式：附件解析 + 本地存储）

**Files:**
- Create: `backend/src/knowledge-engine.js`
- Modify: `backend/src/tool-definitions.js`、`main.cjs`、`preload.cjs`、`src/main.jsx`

**Interfaces:**
- Consumes: 后端 `read_task_attachment`（返回 `{ fileName, text|null, readable }`）、`read_task_content`
- Produces:
  - `collectAttachmentTexts(client, taskIds): Promise<AttachmentText[]>`
  - `aggregateBySubject(entries): SubjectGroup[]`
  - `summarizeKnowledge(entries, model): Promise<ReviewCard[]>`（LLM 关闭时返回原文摘要）
  - `ReviewCard = { subject, topic, points: string[], sourceTaskIds: string[] }`

- [ ] **Step 1: knowledge-engine.js**

```js
export async function collectAttachmentTexts(client, taskIds) {
  const out = [];
  for (const taskId of taskIds.slice(0, 50)) {
    try {
      const detail = await client.readTaskAttachment({ taskId, includeText: true });
      for (const att of detail.attachments || []) {
        if (att.readable && att.text) {
          out.push({ taskId, fileName: att.fileName, text: att.text, subject: detail.subjectName || "" });
        }
      }
    } catch { /* 单条失败跳过 */ }
  }
  return out;
}
```

`aggregateBySubject` 按 `subject` 分组、拼接文本、按任务时间排序。

- [ ] **Step 2: 注册工具与 IPC**

`tool-definitions.js` 注册 `list_review_notes`、`read_review_note`；main.cjs 新增 `review/index.json` 读写与 `knowledge:refresh` IPC；preload 暴露 `listReviewNotes`、`getReviewNote`、`runKnowledgeRefresh`。

- [ ] **Step 3: 复习页 UI**

新增页面入口"复习"：左侧学科列表，右侧卡片（points 列表 + 来源作业）；顶部"刷新"按钮调用 `runKnowledgeRefresh`。

- [ ] **Step 4: 校验 + 提交**

```bash
node --check backend/src/knowledge-engine.js && node --check backend/src/tool-definitions.js
git add backend/src/knowledge-engine.js backend/src/tool-definitions.js frontend/electron
git commit -m "feat: knowledge review page with attachment extraction"
```

---

## M3：AI 增强

### Task 10: macOS Vision OCR

**Files:**
- Create: `scripts/ocr_vision.swift`、`backend/src/ocr.js`

**Interfaces:**
- Consumes: 图片文件路径
- Produces: `runOcr(imagePath): Promise<string>`（spawn `swift scripts/ocr_vision.swift <imagePath>`）

- [ ] **Step 1: ocr_vision.swift**

```swift
import Foundation
import Vision
import AppKit

guard CommandLine.arguments.count > 1,
      let image = NSImage(contentsOfFile: CommandLine.arguments[1]),
      let cg = image.cgImage(forProposedRect: nil, context: nil, hints: nil) else {
  FileHandle.standardError.write("cannot load image\n".data(using: .utf8)!)
  exit(1)
}
let request = VNRecognizeTextRequest()
request.recognitionLevel = .accurate
request.recognitionLanguages = ["zh-Hans", "en-US"]
let handler = VNImageRequestHandler(cgImage: cg, options: [:])
try handler.perform([request])
let lines = (request.results ?? []).compactMap { $0.topCandidates(1).first?.string }
print(lines.joined(separator: "\n"))
```

- [ ] **Step 2: ocr.js 封装**

```js
import { execFile } from "node:child_process";
import { promisify } from "node:util";
const execFileAsync = promisify(execFile);

export async function runOcr(imagePath) {
  const script = new URL("../../scripts/ocr_vision.swift", import.meta.url).pathname;
  const { stdout } = await execFileAsync("swift", [script, imagePath], { timeout: 60_000 });
  return stdout.trim();
}
```

- [ ] **Step 3: 接入附件读取**

`read_task_attachment` 对不可读图片且 `ocr` 开关开启时调用 `runOcr` 并返回 `{ text, readable: true, ocr: true }`（开关通过新工具参数或后端配置注入）。

- [ ] **Step 4: 实测 + 提交**

用一张中文截图验证 `swift scripts/ocr_vision.swift sample.png` 输出文本；通过后提交。

### Task 11: LLM 知识点总结

**Files:**
- Modify: `backend/src/knowledge-engine.js`、`backend/src/tool-definitions.js`

**Interfaces:**
- Consumes: `model-config.json`（baseUrl/apiKey/modelName）
- Produces: `summarizeKnowledge(entries, model): Promise<ReviewCard[]>`，输出纯文本要点 + JSON。

- [ ] **Step 1: 实现 summarizeKnowledge**

复用 main.cjs 的 `fetch(deriveChatUrl(...))` 方式；prompt 要求输出：`主题 | 概念要点 | 公式/关键点 | 例题 | 易错点`，每科最多 8 张卡片；失败时返回按章节切分的原文摘录，不中断。

- [ ] **Step 2: 工具注册 + 提交**

注册 `summarize_task_knowledge`；`node --check` 后提交。

### Task 12: 自动完成 + 审核提交流水线

**Files:**
- Create: `frontend/electron/electron/auto-pipeline.cjs`
- Modify: `main.cjs`、`preload.cjs`、`src/main.jsx`（草稿页课程模式选择）

**Interfaces:**
- Consumes: toolRuntime（`list_tasks`、`collect_task_submission_context`、`draft_task_submission`、`prepare_submission_preview`、`submitApprovedDraft`）、`getFeatureConfig()`
- Produces:
  - `runAutoCompleteForTask(taskId): Promise<{ draftId, status }>`
  - `getCourseSubmissionMode(courseId)` / `setCourseSubmissionMode(courseId, mode)`（mode ∈ `"draft" | "review" | "auto"`）

- [ ] **Step 1: 流水线主体**

`autoComplete` 开关开启时，定时器扫描未交作业；对 `mode !== "draft"` 的课程：收集上下文 → 生成草稿（复用 Agent 调用链，把答案写入 `draft_task_submission`）→ 通知"待审核"。`mode === "auto"` 时进入提交预览并弹 5 秒可取消倒计时；取消则保持草稿。

- [ ] **Step 2: 课程模式存储**

`userData/course-modes.json`，默认 `"review"`；草稿页每个课程显示模式下拉框。

- [ ] **Step 3: 提交**

```bash
node --check frontend/electron/electron/auto-pipeline.cjs
git add frontend/electron/electron/auto-pipeline.cjs frontend/electron/electron/main.cjs frontend/electron/electron/preload.cjs frontend/electron/src/main.jsx
git commit -m "feat: auto-complete pipeline with per-course submission modes"
```

---

## M4：打包与文档

### Task 13: 打包与运行文档

**Files:**
- Modify: `README.md`

- [ ] **Step 1: README 补充 macOS 章节**

记录：依赖安装、Playwright Chromium 安装、`pnpm start` 开发运行、`npm run dist:mac` 打包、首次登录流程、功能开关说明、实验版风险提示。

- [ ] **Step 2: 打包验证**

运行 `npm run dist:mac`，确认产出 `.app` 与 `.dmg`；如 electron-builder 网络失败，记录原因并保留配置。

- [ ] **Step 3: 提交**

```bash
git add README.md
git commit -m "docs: add macOS run and packaging instructions"
```

---

## Self-Review

**Spec coverage 对照：**
- 功能开关 → Task 5/6
- AI 自动完成 + 审核提交 → Task 12
- 附件知识点复习 → Task 9/10/11
- GPA 预警 → Task 7
- 未交作业提醒 → Task 8
- macOS 适配 → Task 1/2/3/4/13
- 数据流/错误处理/安全 → 各 Task 内实现 + Global Constraints

**占位符扫描：** 无 TBD/TODO；"LLM 关闭时返回原文摘要"等为明确行为。

**类型一致性：** `evaluateGpaAlert`/`evaluateReminders`/`collectAttachmentTexts`/`summarizeKnowledge` 签名在后续 Task 引用处与定义一致；`FeatureConfig` 字段在 Task 5 定义、Task 6/7/8/12 消费处一致。
