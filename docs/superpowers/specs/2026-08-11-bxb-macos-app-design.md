# BXB 学业助手（macOS 版）设计文档

- 日期：2026-08-11
- 状态：已获用户口头批准（方案一：在同学仓库基础上做 macOS 适配 + 功能扩展）
- 基线：`GRAY-XY/BXB_tools`（无开源许可证，个人自用；公开发布前需征得原作者同意）
- 目标平台：macOS（Electron 桌面应用）

## 1. 背景与目标

用户是伴学邦学生端用户，需要一个能在 macOS 上运行的本地桌面应用，围绕伴学邦作业与成绩提供：

1. 自动识别作业；
2. AI 自动生成答案草稿，人工审核后提交（实验版，可开关）；
3. 从作业附件整理知识点，生成复习材料；
4. 危险 GPA 提醒（默认等级 B 及以下预警，阈值可调）；
5. 未交作业提醒（截止前分级提醒 + 逾期提醒）；
6. 全局功能开关，每个功能可独立启用/关闭；
7. 内置浏览器登录（一次登录，本地持久化会话），不依赖用户日常 Chrome。

## 2. 总体架构

沿用基线仓库的三层结构：

- **Electron 主进程**（`frontend/electron/electron/main.cjs`）：窗口管理、IPC、Agent 运行时、模型配置、本地通知、功能配置存储。
- **React 渲染进程**（`frontend/electron/src/`）：页面 UI，仅通过 `window.bxb` 访问能力。
- **Node/Playwright 后端**（`backend/src/`）：伴学邦登录、课程/作业/成绩/附件/提交等真实数据操作；`tool-definitions.js` 定义 Agent 可用工具。

数据全部保存在本机（`app.getPath("userData")`），会话、API key、草稿、复习笔记、功能配置均不离开本地。

## 3. 现有能力盘点与复用

直接复用，不改动核心逻辑：

- 登录：浏览器交互登录 / 账号密码登录 / localStorage 会话持久化；
- 作业：`list_tasks`（待交/全部）、`open_task`、`read_task_content`；
- 成绩：`getAchievementOverview`（GPA level、成绩曲线、分数等级）、`getCurrentSubjectGpa`；
- 附件：`download_task_attachment`、PDF（pdf-parse）、DOCX（mammoth）文本提取；
- 草稿与提交：`collect_task_submission_context`、`draft_task_submission`、`approve_submission_draft`、`prepare_submission_preview`、`submitApprovedDraft`（确认令牌机制）；
- AI：OpenAI 兼容接口（`model-config.json`：baseUrl / apiKey / modelName / systemPrompt），Agent 工具调用循环；
- 现有页面：主页、助手、作业、工作区、私信、草稿、设置。

## 4. 新增功能设计

### 4.1 全局功能开关

新增本地配置文件 `feature-config.json`（位于 userData），由设置页读写，主进程向渲染进程暴露读写 IPC。

开关清单与默认值：

| 开关 | 默认 | 说明 |
| --- | --- | --- |
| 自动识别作业 | 开 | 启动/刷新时扫描未交作业并展示 |
| AI 自动完成（实验） | 关 | 对识别到的作业自动生成草稿 |
| 知识点复习 | 开 | 附件解析 + 可选 LLM 总结 |
| GPA 预警 | 开 | 等级 ≤ B 预警（阈值可调） |
| 未交作业提醒 | 开 | 截止前 24h/6h/1h + 逾期提醒 |
| 自动提交 | 关 | 课程级模式：仅草稿 / 审核后提交 / 自动提交（5 秒可取消） |
| 图片 OCR | 开 | macOS Vision 框架本地识别，无网络 |
| 桌面通知 | 开 | 所有提醒走系统通知 |

关闭的功能不启动对应定时器、不弹通知、不显示对应页面入口（或显示灰态）。

### 4.2 自动完成 + 人工审核提交（实验版）

流水线：

1. 登录态有效时，扫描未交作业（`list_tasks`）；
2. 对每个启用 AI 自动完成的课程作业，收集题目正文与附件（`collect_task_submission_context`）；
3. 由 Agent 生成答案草稿与解题思路（新增工具 `draft_task_submission` 复用现有草稿存储）；
4. 写入本地草稿，触发桌面通知"草稿已生成，等待审核"；
5. 用户在草稿页审核：查看正文、思路、随附附件；确认后调用现有 `prepare_submission_preview` → `submitApprovedDraft`（确认令牌）；
6. 课程级模式：
   - **仅草稿**：永不自动提交；
   - **审核后提交**（默认）：必须人工确认；
   - **自动提交（可取消）**：生成草稿后自动进入提交预览，弹窗 5 秒倒计时可取消；取消后回到审核态。

提交动作永远使用现有"确认令牌"机制，未审核的草稿不可能直接发出。

### 4.3 知识点复习（从作业附件整理）

处理管线（新增 `backend/src/knowledge-engine.js` + 对应工具）：

1. **收集**：遍历当前学期已交/未交作业的附件与正文；
2. **解析**：
   - PDF → `pdf-parse`；
   - DOCX → `mammoth`；
   - 图片（png/jpg/jpeg/webp/bmp）→ macOS Vision 框架 OCR（新增 `scripts/ocr_vision.swift`，本地执行，支持中文）；
   - 其他类型记录"不可读"，不阻塞流程；
3. **聚合**：按学科 + 学期归类，去重、按作业时间排序；
4. **总结**（可开关）：调用已配置的 OpenAI 兼容模型，将聚合文本总结为知识点卡片（概念、公式/要点、例题、易错点），输出纯文本 + 结构化 JSON；
5. **存储**：`userData/review/<subject>/<topic>.md` + `index.json`；
6. **展示**：新增"复习"页，按学科浏览卡片、全文检索、导出 Markdown。

LLM 关闭时仍保留 OCR + 原文摘录模式。

### 4.4 危险 GPA 预警

- 复用 `getAchievementOverview`：读取 `averageLevel`（等级）与成绩曲线；
- 预警规则：`level` 优于阈值（默认 B）→ 正常；等于或低于阈值 → 红色预警；
- 触发方式：登录后与刷新时检查；每次会话对同一科目最多提醒一次（状态解除后重置）；
- 展示：主页预警卡片（红色）、设置页阈值调整（A/B/C/D）、成绩趋势图保留现有实现；
- 通知：受"GPA 预警"与"桌面通知"两个开关共同控制。

### 4.5 未交作业提醒

- 数据源：`list_tasks` 待交列表 + 截止时间；
- 规则：截止前 24h / 6h / 1h 各提醒一次（提前量可配置），逾期未交每日提醒一次并标红；
- 实现：主进程定时器（默认每 10 分钟检查一次，可配置），提醒状态持久化避免重复弹窗；
- 受"未交作业提醒"与"桌面通知"开关控制。

### 4.6 macOS 适配

- `frontend/electron/package.json`：`electron-builder` 增加 `mac` 目标（dmg + zip，arm64/x64 按当前架构输出）；
- `backend/src/banxuebang-client.js` `launchBrowser`：增加 macOS 路径候选（`~/Library/Caches/ms-playwright/chromium-*/chrome-mac/Chromium.app/...` 与 headless shell），并支持 `PLAYWRIGHT_BROWSERS_PATH`；
- 首次运行检测：`browserDependency.ready=false` 时提示 `npx playwright install chromium`（或打包时预置）；
- Windows 专属自动更新（GitHub Releases 检查、NSIS）在 `darwin` 上禁用，先不提供 macOS 自动更新；
- 数据目录使用 Electron 标准 userData（`~/Library/Application Support/BXB_Assistant`）；
- 登录窗口弹出逻辑与窗口图标适配 macOS。

## 5. 新增/变更接口

### 渲染进程 `window.bxb` 新增

- `getFeatureConfig(): Promise<FeatureConfig>`
- `saveFeatureConfig(patch): Promise<FeatureConfig>`
- `listReviewNotes(): Promise<ReviewIndex>`
- `getReviewNote(subject, topic): Promise<string>`
- `runKnowledgeRefresh(): Promise<KnowledgeRefreshResult>`
- `getAlertSummary(): Promise<AlertSummary>`（GPA 预警 + 未交提醒合并视图）
- `onAlert(callback)`：主进程主动推送预警/提醒事件

### 后端新增工具（Agent 可见）

- `ocr_image_attachment`（图片 → 文本）
- `summarize_task_knowledge`（聚合文本 → 知识点卡片，可关 LLM）
- `list_review_notes` / `read_review_note`
- `get_alert_summary`
- `get_submission_mode_for_course` / `set_submission_mode_for_course`（课程级提交模式）

## 6. 数据模型

```
userData/
  feature-config.json          # 功能开关
  model-config.json            # 已有：模型配置
  .banxuebang/                 # 已有：会话/工作区/草稿
  review/
    index.json                 # 学科 → 主题 → 文件路径/时间/来源作业
    <subject>/<topic>.md       # 复习笔记（纯文本/Markdown）
  alert-state.json             # 已提醒状态（GPA、未交作业）
```

## 7. 数据流示例

自动完成一条作业：

```
定时器/手动刷新
  → list_tasks（未交）
  → collect_task_submission_context（正文 + 附件）
  → OCR/PDF/DOCX 解析（按需）
  → Agent 生成草稿（draft_task_submission）
  → 通知"待审核"
  → 用户审核 → prepare_submission_preview → 确认令牌 → submitApprovedDraft
  → 本地记录提交状态
```

知识点复习一次：

```
复习页点"刷新"
  → 收集附件 → 解析文本/OCR
  → 按学科聚合 → （可选）LLM 总结
  → 写入 review/ → 更新 index.json → 页面展示
```

## 8. 错误处理

- 未登录：所有自动流程暂停，提示登录；
- 附件不可读：跳过并标记原因，不中断整批处理；
- 模型不可用（无 key/超时）：自动完成退回"仅收集上下文"模式，复习退回"无总结"模式；
- 提交失败：保留草稿，标记失败原因，不自动重试；
- 定时器检查异常：吞掉单次错误，记录日志，不影响下次检查。

## 9. 安全与隐私

- API key、会话、草稿、复习笔记只存本机 userData；
- 所有"提交"动作走确认令牌 + 人工审核（或白名单课程 + 可取消窗口）；
- 实验功能带"实验版"标识；
- OCR 使用本地 macOS Vision，不发送图片到网络；
- 不修改仓库中"不上传/不自动提交"的既有 Agent 系统提示（新增开关才放宽，且默认关闭）。

## 10. 测试计划

1. macOS 冷启动：未登录 → 浏览器登录 → 会话持久化；
2. 作业识别：待交列表与截止时间正确；
3. 附件解析：PDF / DOCX / 图片 OCR（中文样张）各一条；
4. 知识总结：用一个真实作业附件跑通"原文模式"与"LLM 模式"；
5. 自动完成：先在"仅草稿"模式验证完整链路，不真发；
6. GPA 预警：用真实成绩数据验证 B 级预警与阈值调整；
7. 提醒：构造临近截止作业，验证 24h/6h/1h 与逾期通知不重复；
8. 开关：逐项关闭，确认对应功能静默。

真实提交测试需用户提供登录会话并在"审核后提交"模式下人工确认。

## 11. 里程碑

- **M1（macOS 可运行）**：mac 构建配置、Playwright mac 路径、登录可用；
- **M2（基础新功能）**：功能开关、GPA 预警、未交提醒、复习页（原文模式）；
- **M3（AI 增强）**：OCR、LLM 知识点总结、AI 自动完成 + 审核提交；
- **M4（打磨）**：打包 .app/.dmg、错误处理、文档。

## 12. 风险与开放问题

- 伴学邦接口变更可能导致部分工具失效（基线仓库已有容错）；
- 图片 OCR 对模糊/手写样张识别率不保证，需实测；
- 无许可证：仅个人自用，不公开发布；
- 自动提交模式即便带取消窗口也有误发风险，默认保持"审核后提交"。
