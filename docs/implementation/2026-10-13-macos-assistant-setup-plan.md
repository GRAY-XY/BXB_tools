# macOS 助手首次设置引导工作方案

日期：2026-10-13。阶段：供用户评估的工作方案，尚未实施。

**Goal:** 完成 Issue #31，让未配置助手的 Mac 用户能选择提供商、填写 API Key、选择模型、验证并保存，也能跳过并从设置页重新进入。

**Architecture:** 使用原生 SwiftUI 两页 sheet，共享现有提供商配置接口和 ModelAPIKeychainStore。启动协调器负责是否展示，独立的引导状态负责编辑、请求、验证和保存；设置页与引导共用配置服务，避免复制整套设置页面。

**Tech Stack:** SwiftUI、Observation、Foundation、Security/Keychain、Node JSONL bridge；沿用 macOS 15.0、Swift 6 和项目 .nvmrc。

## 已核实的任务与代码基线

- 新分配任务：[Issue #31](https://github.com/GRAY-XY/BXB_tools/issues/31)。2026-10-12 11:04 北京时间分配给 rayem-prog；当前 open，没有评论补充要求。
- rayem-prog 当前仅有这一项未关闭 issue。#32 分配给 igpig1226，#33、#34 分配给 GRAY-XY。
- 上次工作：[PR #35](https://github.com/GRAY-XY/BXB_tools/pull/35) 已在 2026-10-07 11:08 北京时间合并，#30 已关闭。
- 本次检查的远端 main：ae04c9f458ecc983164cdf21631fec1bf70d4256。本工作区仍为旧的 detached HEAD 709fdc3，后续实施从最新 main 新建 codex/macos-assistant-setup 分支。
- main 已有 SettingsView.swift、ModelAPIKeychainStore.swift、modelConfig.load/list/test/save 等接口及 macOS JSON 配置去密钥机制。
- 现有 SettingsViewModel 是 private，混合了配置、网络请求和界面状态；仅抽出引导需要共用的部分，保留高级设置。
- 现有 modelConfig.test 的成功条件是模型名称出现在 /models 结果中，没有发起模型回复请求。不能把这个结果标注为“已验证正常对话”。

## 路线选择

1. **推荐：原生两页引导 + 共用配置服务。** 能覆盖五项 issue 要求，并继续沿用现有设置页和 Keychain。
2. 启动时直接跳转完整设置页：改动少，但新用户仍面对高级参数，缺少清晰的完成/跳过流程。
3. 复制 Windows 引导及其保存逻辑：外观容易对齐，但 Windows 密钥持久化和 macOS 不同，且 Windows 当前流程主要验证模型列表；后续两套实现也容易分叉。

## 推荐用户流程

1. 后端连接成功、旧密钥迁移完成后，检查当前 chat 提供商、非空模型名、有效 endpoint 和对应 Keychain Key。配置读取失败展示重试，不当成全新用户。
2. 无可用 chat 配置且尚未跳过时，展示引导。已配置用户进入主界面。检测使用配置和 Keychain，不仅使用 JSON 中的 hasApiKey。
3. 第一页“连接模型服务”：选择已有提供商或现有预设、编辑名称/Base URL、用 SecureField 输入新 Key；给出项目现有 API Key 教程入口。
4. 第二页“选择并测试模型”：读取模型列表，也允许填写明确的模型 ID。显示所选服务与模型；用户主动点击测试。
5. 测试只使用内存中的候选配置，不保存、不激活、不调用助手工具。推荐进行一次短的纯文本模型请求验证真正回复能力，并说明会产生一次模型调用。模型列表读取成功与真实调用成功分别显示。
6. 候选 URL、模型、提供商或 Key 改动后，旧测试结果立即失效。用户返回上一步不丢失当前编辑。
7. 只有当前候选测试通过，才启用“完成配置”。完成时写入 Keychain 和无密钥配置，并设为 chat 当前模型；成功后刷新助手配置摘要，清空 Key 输入，关闭引导。
8. 每一页都提供“稍后设置”；退出时清空敏感编辑和取消/作废未完成请求，不保存候选提供商或 Key。记住主动跳过，之后从设置页“助手设置引导”随时进入。
9. 保存失败留在引导中，提示对应的配置或 Keychain 错误；不能标记完成。保留旧的当前提供商和旧 Key，重试不创建重复提供商。

## 范围和约束

- 本 issue 聚焦 chat 助手首次设置；不要求同时配置 image_caption 或调整高级模型参数。
- 不接入 #32 图片预览、#33 更新和 #34 正式发布工作。
- 沿用现有 Keychain service 和 role:providerID 定位方式；新 Key 只在本机 Keychain 持久化。
- 已保存 Key 不回填输入框、不显示完整值或末尾字符；UI 只显示“已保存”。
- 测试和模型列表请求不写磁盘，日志与远端错误响应不得泄露候选 Key。
- 不覆盖其他提供商、图片转述配置、草稿、对话、工作区和学期上下文。
- 只有用户点击测试才请求模型服务；该请求只包含固定的短测试文本，不使用历史聊天、课程或作业，不调用 agent.chat。
- 多窗口共用展示/保存协调状态，避免启动两个引导并竞争写配置。
- 使用已有教程 URL：https://www.bilibili.com/opus/1248657725804511251 。实施时确认链接可打开；不自行替换教程内容。

## 实施批次与验收

### 批次 1：建立共享配置边界

涉及现有文件：Features/SettingsView.swift、Shared/ModelAPIKeychainStore.swift、Shared/BackendConnectionModel.swift。计划新增 Shared/ModelConfigurationService.swift、Shared/ModelConfigurationModels.swift。

- [ ] 从最新 main 建立实施分支；先运行当前 backend 检查与发布扫描，记录基线。
- [ ] 抽出候选配置、当前 chat 就绪判定、Keychain 访问、旧 Key 迁移和非持久化测试调用。设置页保留现有展示与高级参数。
- [ ] 为 Keychain、配置读写和网络调用注入测试替身，避免测试访问用户真实 Keychain 或数据。
- [ ] 验证已有 chat 配置不会被误判未配置；Keychain 无权限和读取失败均返回可解释错误；Keychain 迁移成功后才清除旧明文。
- [ ] 验证现有设置页保存、获取模型、切换提供商和助手读 Key 行为没有回归。

验收：共享能力可被引导调用，现有设置页与助手继续工作。这一批次可以单独测试和提交。

### 批次 2：引导状态和真实连接验证

计划新增 Features/AssistantSetupModel.swift、Runtime/AssistantSetupSmoke.swift、Runtime/AssistantSetupFixture.js、backend/test/model-config-setup.test.js。按需要修改 backend/bridge/winui-backend.js 和 package.json。

- [ ] 首先用 fixture 覆盖新安装、已配置、跳过、重新进入和读取失败五种启动状态。
- [ ] 定义编辑 → 读取模型 → 测试中 → 测试通过 → 保存中 → 完成的状态；失败返回可编辑状态；候选修订号变化使旧结果失效。
- [ ] 复用 modelConfig.list；推荐新增 macOS 专用 modelConfig.probe，使用候选 Key/URL/模型进行一次短的直接模型调用，不保存配置、不载入对话、不启用工具。
- [ ] 对该测试请求设置超时，验证成功、401、403、429、超时、空模型列表、没有 /models 但支持直接调用、无效响应、取消与迟到响应。
- [ ] 测试成功只记录候选修订号；显式完成才保存 Key 与元数据。建立保存恢复逻辑并覆盖配置保存失败、Keychain 保存失败及响应丢失后读回确认，避免覆盖已有配置或盲目重试。
- [ ] 用假的敏感字符串检查配置文件、日志和错误提示中没有 Key；Node fixture 只使用隔离的 APPDATA 和本地 HTTP 服务。
- [ ] 验证共享 bridge 的 Windows modelConfig.test 行为未改变。

验收：网络验证与保存分开；错误和取消不保存，不覆盖旧状态；真正回复验证不会执行任何 agent 工具。

### 批次 3：原生界面和入口

计划新增 Features/AssistantSetupView.swift；修改 App/AppShellView.swift、App/BXBHomeworkApp.swift、Features/SettingsView.swift、Features/AssistantView.swift 及 Xcode project.pbxproj。

- [ ] 主窗口在后端和配置准备完成后按协调状态显示 sheet；不依赖某个设置页面先被打开。
- [ ] 构建两页表单、返回/下一步、测试、完成、教程和稍后设置入口，使用现有提供商预设而不硬编码新的默认服务。
- [ ] 跳过后主界面继续可用；助手页显示可操作的配置入口。设置页可重新打开同一引导。
- [ ] 再次进入时可沿用已有配置并使用已保存 Key，Key 输入框保持为空；测试期间阻止重复请求，允许退出后作废请求结果。
- [ ] 检查键盘 Tab、回车、Esc、VoiceOver 标签、浅色/深色、最小窗口与长错误信息。小尺寸时滚动而不遮挡按钮。
- [ ] 将新 Swift 文件加入 Xcode sources；确认完整 target 能构建，不只进行语法解析。

验收：首次启动、跳过、重启、手动重开、失败重试与成功保存均可从真实 UI 操作。

### 批次 4：CI、真实验收和交付

修改 .github/workflows/validate-macos-swiftui.yml、apps/macos/swiftui/README.md；新增 docs/implementation/2026-10-13-macos-assistant-setup.md。

- [ ] 将新状态/bridge fixture 检查加入现有 macOS arm64 工作流；运行 npm run check、npm run scan:publish、git diff --check、新 Swift 状态测试和完整 Xcode Release build。
- [ ] 生成测试 app，记录候选提交 SHA 与对应 CI 运行；实际下载/启动测试产物，不能仅依赖原始工作区。
- [ ] 用隔离的数据目录与专用测试 Keychain service 验证全新安装、已配置用户升级、跳过后重启和 Keychain 拒绝。
- [ ] 由用户在本机输入一个测试 API Key，主动点击一次测试并验证配置后助手可正常回复；Key 不进入 PR、截图或聊天记录。模型服务调用可能有少量费用，UI 需在点击前说明。
- [ ] PR 引用 #31，列明五项需求、自动检查、真实 UI 验收和已知限制；完成验收并合并后关闭 issue。

验收：自动检查和真实 UI 均通过，有可下载的测试 app 及清晰证据。

## 验收矩阵

| 场景 | 预期 |
| --- | --- |
| 首次启动、无配置 | 弹出一次引导，可立即跳过 |
| 配置读取失败 | 明确重试；不覆盖旧配置、不误判新用户 |
| 已有有效 chat 配置 | 直接进入主界面 |
| 只配置 image_caption | 仍能设置 chat，不覆盖 image_caption |
| 主动跳过后重启 | 不反复弹出；设置页与助手入口可重开 |
| Key 错误或服务不可用 | 展示错误，留在编辑状态，磁盘配置不变 |
| 模型列表空/不支持列表 | 可填模型 ID，以主动的真实调用判断是否可用 |
| 测试后修改任一连接字段 | 旧测试通过状态失效，不能直接完成 |
| 测试中退出/重新打开 | 旧请求结果不改变新界面或配置 |
| 保存失败 | 不显示完成，旧配置可用，重试不生成重复项 |
| 保存成功后重启 | 不再自动展示；助手能从 Keychain 获得 Key |
| 设置页重新打开 | 已保存 Key 不显示，可替换并重新测试 |
| 最小窗口和深色模式 | 所有输入和操作可见、可滚动、可用键盘操作 |

## 协作、时间与注意事项

- 推荐顺序推进，以同一条 feature 分支上的 3–4 个清晰提交交付；共用 SettingsView 和 bridge，不宜同时进行不同版本的重构。
- 我负责配置边界、引导状态、界面、fixture、CI 和 PR 材料；用户负责本机输入真实 Key，并确认界面和真实回复符合预期。
- 初步工作量：梳理/共享边界半天；引导与连接验证约一天；验证/修复/交付半天至一天。预计 2–3 个开发日，受 API 兼容性、Keychain 故障恢复与 CI 时间影响；不是交付承诺。
- 本机只有 Command Line Tools，完整原生构建使用现有 macOS CI；不能把 swiftc -parse 当成 Xcode 构建通过。
- CI 当前验证 macOS 15 arm64；不能据此宣称 Intel 或旧 macOS 已验证。
- 不复制 Windows 的 Key 保存行为；不直接复用现有 SettingsViewModel.test，因为它会在测试成功时写 Keychain。
- 发布扫描只能覆盖已知路径/模式，仍需用 fixture 验证 Key 未出现在配置与错误日志里。
- 测试 app 的临时签名不等于正式公证发行；正式发布继续由 #34 负责。
- 此方案未修改应用代码、远端 issue、PR 或真实用户数据；下一步是在这个方向确定后细化实施并开始批次 1。
