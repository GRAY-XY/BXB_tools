# macOS 学期切换：实现与验收记录

日期：2026-10-06。任务：[macOS: let users switch academic terms，#30](https://github.com/GRAY-XY/BXB_tools/issues/30)。

## 1. 范围与基线

GitHub 当前账号为 rayem-prog；#30 的 assignee 为 rayem-prog。#31—#34 分配给其他成员，本次仅实现 #30 及其上下文一致性保护。

起始基线为 origin/main 的 2a934769449f9d5cee0600306f45b8eba09c1a92，工作分支为 codex/macos-term-switching。此前的总体实现计划保留在当前工作区；本文件记录这次实际执行的步骤和验证结果。

学期切换只更新本地学业上下文并读取远程数据，不调用作业提交、私信发送或其他远程写接口。

## 2. 按模块执行结果

| 步骤 | 模块 | 实际实现 | 状态 |
| --- | --- | --- | --- |
| 0 | 基线与分工 | 更新到最近主分支，核对登录账号及 issue assignee | 完成 |
| 1 | 后端原子切换 | 先验证目标、加载目标学期课程，再保存新上下文；课程选择重置为全部课程 | 完成 |
| 2 | 会话解析 | 兼容数字或字符串 ID；按选中 ID 解析学期名称，不使用默认学期标记推断当前选择 | 完成 |
| 3 | 原生入口 | 概览增加学期选择、加载状态、失败信息和重新确认入口 | 完成 |
| 4 | 数据刷新 | 更新概览数量，作业页按账号、班级、学期和上下文版本清空并重载 | 完成 |
| 5 | 并发与恢复 | 课程操作和学期切换互斥；失败后读取真实状态，无法确认时暂停课程操作 | 完成 |
| 6 | 关联状态 | 丢弃旧课程/详情响应；重置附件显示状态；清除交付预览并保留草稿编辑内容 | 完成 |
| 7 | 自动验证 | 后端、桥接集成、Swift 状态与解析测试、源码类型检查、发布扫描 | 通过，详见第 5 节 |
| 8 | 原生应用验收 | 完整 Xcode 构建、真实窗口交互及合法测试账号只读验收 | 待验收 |

## 3. 实现工作流程

### 3.1 正常切换

1. 加载可用学期，并由 currentTermId 决定当前选择。
2. 用户选中其他学期时，检查是否存在课程请求、助手运行或交付操作。
3. 标记切换中，立即使旧作业显示状态失效。
4. 原生桥执行 session.switchTerm；后端检查目标仍然可用。
5. 将目标 ID 写入独立候选会话，重置课程为全部课程，加载目标课程。
6. 所有读取成功后保存候选会话；返回新的真实会话摘要。
7. 原生模型更新上下文，概览读取 home.pendingCount；作业页重新加载课程和作业。
8. 下次刷新或重开客户端，从持久化会话恢复该选择。

### 3.2 失败恢复

- 新学期课程加载失败：保留旧学期和旧课程，显示错误。
- 目标学期中途消失：报错，不静默选择其他学期。
- 后端已保存但响应中断：再次读取 session.status，以真实已提交的上下文为准。
- 连 session.status 都无法读取：保留提示，但将 academicContextReady 置为 false；刷新确认前暂停课程操作。
- 切换期间出现 401 并刷新令牌：只保存新凭据与原有完整上下文，不能提前保存候选学期。最终课程加载失败时，旧课程和旧学期仍然一致。
- 普通刷新遇到服务器删除原学期：接受后端允许的有效学期回退，更新上下文版本并重载；不会把回退学期的课程套在旧学期标题下。

### 3.3 并发保护

原生客户端持有短期活动令牌，覆盖课程读取、预览和交付请求。助手持有令牌直到整轮流式响应结束。存在令牌时禁用切换入口。

原生桥也执行同一规则：学期切换与账号操作互斥，重复切换及切换期间的新账号请求返回 academic_context_busy。防止绕过界面禁用状态后，旧请求仍将旧上下文写回。桥的互斥仅在 BXB_MACOS_NATIVE=1 时启用；Windows 请求沿用原来的调度方式。

每次课程、任务或详情请求同时记录请求 ID 与上下文 key。只有两者都仍匹配，响应才能更新页面。取消选中作业会立即使详情请求失效，迟到响应不能重新打开详情。

草稿只清除与学期相关的提交/私信预览；本地正文、摘要和未保存编辑保留。交付仍需沿用现有确认流程。

## 4. 主要文件

- Shared/BackendModels.swift：会话 ID 与学期名称解析。
- Shared/BackendConnectionModel.swift：切换、活动令牌、上下文版本、恢复和待完成数量。
- Features/OverviewView.swift：学期选择及概览状态。
- Features/HomeworkView.swift / HomeworkViewModel.swift：按上下文重载与丢弃迟到响应。
- Features/AssistantViewModel.swift：覆盖整轮助手运行的活动令牌。
- Features/DraftReviewView.swift / DraftViewModel.swift：交付预览失效与草稿保留。
- backend/src/banxuebang-client.js：候选上下文提交及令牌刷新保护。
- backend/src/academic-context-coordinator.js：后端互斥协调。
- backend/bridge/winui-backend.js：原生桥方法和账号操作协调。
- backend/test/term-context.test.js：选择持久化、失败回滚与目标失效。
- backend/test/academic-context-coordinator.test.js：互斥与失败后释放。
- backend/test/academic-context-bridge.test.js：真实子进程桥、HTTP 边界与临时会话存储集成。
- Runtime/TermParsingSmoke.swift / AcademicContextSmoke.swift：原生解析、状态、请求过期和草稿编辑保留。
- Runtime/AcademicContextFixture.js：隔离协议测试服务。
- Runtime/check-academic-context.sh：可重复运行的 Swift 验证入口。

上述 Swift 路径均位于 apps/macos/swiftui/BXBHomework 下，Runtime 路径位于 apps/macos/swiftui/Runtime 下。

与原计划相比，活动协调集中在已有 BackendConnectionModel 中，未新增重复的 AppActivityCoordinator；原生状态测试沿用仓库已有 Runtime smoke 方式，未增加 XCTest target。界面入口放在概览，课程和作业继续使用已有页面。

## 5. 自动验证

### 已执行

| 验证 | 结果 | 边界 |
| --- | --- | --- |
| npm run check | 76/76 通过 | 包含新增 9 项学期及并发测试和现有交付等回归 |
| npm run scan:publish | 通过 | 未发现扫描规则识别的本地敏感或调试路径 |
| TermParsingSmoke | 通过 | 数字 ID、选中学期、未登录状态 |
| AcademicContextSmoke | 通过 | 成功切换、明确失败、响应丢失、恢复失败、准确待完成数量、旧课程响应、取消详情、活动互斥、草稿编辑保留、服务器上下文变化 |
| Swift 6 / macOS 15 源码类型检查 | 通过，使用临时验证副本 | 去除仅供 Xcode 使用的 #Preview 声明，不修改仓库源码 |
| git diff --check | 通过 | 空白及补丁格式检查 |

TDD 记录：后端原子切换测试先观察到 3 项失败；Swift 学期解析先观察到数字 ID 解码失败；Swift 状态测试先观察到所需接口缺失；401 刷新令牌后的课程失败集成测试先复现了错误保存新学期。实现后相应测试通过。

### 重复运行

在配置正常的 macOS Swift 工具链上，从仓库根目录运行：

~~~sh
npm ci
npm run check
npm run scan:publish
bash apps/macos/swiftui/Runtime/check-academic-context.sh
~~~

本轮 Node 测试使用 Node v24.21.0；仓库固定的 Node 22 和 CI 结果仍需由相应环境确认。Swift 类型检查使用 Swift 6 模式及 macOS 15 目标，与项目设置一致；已有私信联系人 Binding 回调产生一条 Sendable 警告，未涉及本次改动。

当前机器仅安装 Command Line Tools，默认 Swift 模块映射有重复 SwiftBridging 定义。验证时通过临时 VFS overlay 隐藏重复 modulemap，并指定临时模块缓存；没有修改系统工具链文件。Swift runner 支持将这些编译选项直接作为参数传入。完整类型检查使用临时源码副本，移除缺少 Xcode PreviewsMacros 插件的 #Preview 声明。

测试使用临时会话目录、本地 HTTP fixture 和隔离 Node 进程。未读取真实账号会话，未登录真实服务，未实际提交作业或发送私信。

## 6. 原生应用待验收流程

本机没有完整 Xcode，因此不能把类型检查当作完整应用构建或 UI 验收。接手验证者应：

1. 按 SwiftUI README 的构建命令打包应用，确认内置 Node 桥启动正常。
2. 使用有至少两个学期的合法测试账号进入概览，确认当前标题和选择一致。
3. 切到另一学期，确认课程、任务、详情及待完成数量均属于新学期。
4. 刷新，再退出并重开应用，确认会话仍允许时保持所选学期。
5. 模拟断网，确认错误可见；恢复网络后重新确认当前学期，确认页面恢复一致。
6. 发起只读课程请求或助手运行时，确认学期入口不可切换；结束后重新可用。
7. 在草稿中保留未保存编辑，切换学期后确认正文和摘要保留、旧交付预览已清除。
8. 在 760×500 和默认 1080×700 窗口检查选择器及错误区域布局。
9. 仅执行查看与预览；学期切换不能调用提交或发送接口。

#30 在原生 UI 验收通过前保持开放；其他成员的 issue 不在本轮关闭或修改。
