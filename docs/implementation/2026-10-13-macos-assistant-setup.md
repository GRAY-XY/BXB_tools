# macOS 助手首次设置引导（Issue #31）

实施基线：`ae04c9f458ecc983164cdf21631fec1bf70d4256`（main）。
分支：`codex/macos-assistant-setup`。本文件记录已实施内容；原工作方案另存为同目录 `2026-10-13-macos-assistant-setup-plan.md`。

## 已实施

- 原生 SwiftUI 两页 sheet：选择共享预设或已有提供商、编辑名称及 Base URL、SecureField 输入 Key、读取列表或直接填模型 ID、主动测试回复、完成或稍后设置。
- 启动与设置窗口共用一个协调状态和展示 owner；后端连接及迁移完成后，根据当前 chat 提供商、模型、URL 与实际 Keychain 凭据判断。读取失败显示重试，不当作新安装。
- 跳过选择存于 UserDefaults；之后可从设置或助手页重新打开。退出清空 Key 输入、作废异步请求结果；旧请求最多在 30 秒内超时，不改变重新进入后的界面。
- 提供商、URL、模型、名称或 Key 变化使测试结果失效。列表成功与回复成功分别显示。测试不保存、不激活、不发送聊天/课程/作业、不调用工具；只发送 `Reply with OK.` 到 `/chat/completions`，并提前提示可能有调用费用。
- 共用 ModelConfigurationService、提供商模型/预设及 Keychain 协议，支持内存替身。原高级设置及 Windows modelConfig.test 行为保持。
- 迁移先确认或写入 Keychain，再清除旧明文；保留已有 Keychain 项优先于旧明文。已保存 Key 仅显示“已保存”，输入框不回填。
- 保存先写 Keychain，然后使用当前 chat 快照作冲突检查，原子替换无密钥 JSON。其他角色和高级设置通过原有合并接口保留。保存后读回确认；失败时恢复原 Key；响应丢失不盲目重复创建或保存。
- 无法确认保存或恢复凭据时，停留在引导，通过“确认保存结果”重试确认。在此状态禁止编辑、退出和新助手请求，避免丢失恢复信息。
- 所有 macOS 模型列表和探测请求设超时、拒绝跳转，错误不包含远端正文或底层请求异常。配置文件解析失败返回固定提示，不覆盖文件。
- 教程沿用 https://www.bilibili.com/opus/1248657725804511251；2026-10-13 HTTP 检查返回 200。

## 自动验证

基线：安装依赖后现有 76 项后端测试通过，发布扫描通过。

本轮已完成：

- `npm run check`：原回归及新增引导 bridge 测试。
- `node --test backend/test/model-config-setup.test.js`：真实 JSONL bridge、隔离 APPDATA、本地 HTTP 服务。覆盖固定请求/无工具/不写盘、401/403/429、超时、无效/空回复、空列表可直接调用、错误隐藏敏感值、保存冲突、保留 image_caption、磁盘无 Key、Windows 原测试行为、损坏配置不覆盖。
- `check-assistant-setup.sh`：使用内存 Keychain、内存配置读写替身和独立 UserDefaults。覆盖首次启动、已配置、跳过后重启、手动重开、读取失败、Keychain 拒绝、迁移失败不清明文、编辑失效、取消与迟到响应、Keychain/配置保存失败、读回确认、未确认时禁止退出、不重复保存、多窗口单 owner、已存 Key 不回填。
- `check-academic-context.sh`：现有学期/草稿/桥状态回归。
- 全部应用 Swift 源码的 Swift 6 / macOS 15 类型检查；本机采用临时源码副本移除缺少 Xcode Preview 插件的宏，仅有已有 DraftReviewView Sendable 警告。
- `plutil -lint` 验证 Xcode project，`git diff --check`，发布扫描。

本机只有 Command Line Tools，其 SwiftBridging 模块映射重复。Swift 状态测试和类型检查使用临时 VFS overlay 隐藏重复映射并指定临时模块缓存；不修改系统文件。此结果不等于完整 Xcode 构建。
CI 已加入引导状态测试，并沿用 macOS 15 arm64 Release Xcode 构建、打包内置 Node、临时签名和可下载测试 app。

## 原生产物验收

必须使用 CI 下载的 app，记录对应提交及 Actions 运行。直接启动 app 可执行文件，同时设置以下三个隔离变量，避免使用真实用户数据：

- `BXB_TEST_APPDATA`：空临时目录；NodeBackendClient 将它传为后端 APPDATA。
- `BXB_TEST_KEYCHAIN_SERVICE`：测试专用 Keychain service。
- `BXB_TEST_DEFAULTS_SUITE`：测试专用偏好 suite。

检查：

1. 全新目录启动自动展示一次引导；每页都能跳过，其他功能可以进入。
2. 跳过后关闭并以相同隔离变量重启，不自动展示；设置页可手动重开。
3. 用本地 HTTP fixture 测试成功/失败；失败不落盘；模型列表失败时仍可直接填写模型 ID。
4. 完成后重启不自动展示；设置重开显示“已保存”，Key 输入为空。更改任一连接字段后必须再次测试。
5. 使用配置损坏、Keychain 拒绝场景确认错误及重试；不能覆盖已有配置。
6. 检查浅色、深色、760×500 窗口、长错误、Tab/回车/Esc、VoiceOver 和多窗口；表单滚动，底部操作保持可见。
7. 用户在本机 SecureField 输入测试 API Key，主动点击一次“测试模型回复”，保存后在助手中确认正常回复。不要把 Key 发到聊天、PR、日志或截图。

真实服务与 UI 最终验收完成前，PR 保持 draft，Issue #31 保持 open。完成用户验收后再合并及关闭 issue。

## 限制

- 尚不能据自动测试声明真实服务的正常助手回复、VoiceOver 体验、Intel 或旧 macOS 支持已验证。
- 请求退出后作废结果，HTTP 请求仍受超时约束；退出不等待远端完成。
- 跨进程异常退出发生在 Keychain 写入和 JSON 提交之间时没有持久化恢复日志；当前恢复覆盖应用仍运行时的失败、响应丢失和重试。不要在“保存结果暂时无法确认”期间强制退出应用。
- 若外部进程同时修改同一个提供商，读回发现冲突后不盲目覆盖 Keychain，需恢复连接并确认结果。本应用内所有设置窗口在引导/保存期间禁用编辑。
- 测试 app 临时签名不代表正式公证发布；#32、#33、#34 不在本次范围内。

## 2026-10-14 后续修复与验证

- 补上保存结果尚未确认时的窗口移交：关闭承载引导的窗口只释放展示权，不丢弃事务或候选 Key；其余可见窗口接管恢复界面。已先用状态测试复现旧行为失败，再验证修复通过。
- 进一步覆盖退出后重新打开再收到旧测试回复，以及只配置 image_caption 的启动状态。旧回复不能改变新的编辑内容，图片凭据保留。
- 用户提供的登录错误显示 Chromium 1217 缺失，且共享代码只检查 Windows 路径。新增 `backend/src/playwright-runtime.js` 从当前 Playwright manifest 获取正确版本，按 macOS 架构找到可执行文件；缓存检查不再仅判断目录存在。
- macOS 登录前会异步准备缺失的 Chromium，安装操作按目标缓存去重，失败后可以重试。安装输出不会污染 JSONL，安装时保留其他 Playwright 缓存。Windows 原安装/查找分支保持不变。
- 登录页显示首次准备浏览器提示。测试用 `BXB_TEST_KEYCHAIN_SERVICE` 同时派生独立登录凭据 service，避免测试窗口读取正常登录凭据；普通启动继续沿用原 service。
- 本机使用已打包 app 的 Playwright CLI 安装其所需 Chromium 1217，未清除原有 1234/1243 缓存。匹配版本 Chromium 已真实启动并渲染本地测试页面；未提交真实账号或调用真实模型。
- 新增缓存版本/架构匹配、失败/不完整安装、去重重试测试；后端共 86 项通过。独立登录 Keychain 测试仅创建临时 service，覆盖读写、隔离及清理。
- 新增配置完成后通过正常 agent.chat 流式回复的本地端到端检查：使用临时传入的 Keychain Key，确认模型路由正确，模型配置和会话文件均不含 Key。此检查不调用真实服务或账号工具。
- CI 增加打包 app 的 Chromium 下载和实际启动 smoke，验证运行时切换浏览器缓存后的可执行路径选择，不访问账号页面。

仍需保持真实账号/模型验收与自动检查的区别；下载和启动 Chromium 通过不代表账号登录及真实助手回复已经通过。
