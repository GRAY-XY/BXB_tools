# Banxuebang Collaboration Policy

这份策略用于约束人类操作者、AI agent、MCP 客户端以及本仓库附带的本地 UI / CLI。

## Core Rules

1. 不猜数据  
   所有课程、学期、任务、成绩、附件、提交状态都应优先通过工具读取，而不是依赖推测。

2. 先读后写  
   默认先使用 `session_status`、`list_terms`、`list_courses`、`list_tasks`、`open_task`、`read_task_attachment` 等只读工具确认上下文。

3. 上传前必须确认  
   对 `upload_submission_file` 的任何执行都必须先得到用户明确确认。

4. 提交前必须再次确认  
   对 `submit_task_result` 的任何执行都必须再次得到用户明确确认。

5. 不默认暴露其他学生数据  
   除非用户明确要求，否则不要展示其他同学的提交状态、提交附件或派生出的统计信息。

6. 不提交本地敏感文件  
   `.banxuebang/`、`artifacts/`、`.playwright-cli/`、本地浏览器存储导出、下载附件和截图都不应提交到仓库。

7. 出错先补前置条件  
   出现错误时，先检查登录状态、当前学期、当前课程、任务 ID、附件 ID，再决定是否重试。

## Required Confirmation Phrases

推荐执行写操作前使用以下确认语句：

- 上传文件前：`确认上传`
- 提交任务前：`确认提交`

如果上层客户端无法保证用户确认，则本地 UI、脚本或 agent 应主动阻止这些操作。

## Recommended Agent Behavior

- 首次进入会话时先调用 `session_status`
- 如果用户指定学期或课程，优先使用名称切换
- 查询任务时尽量缩小上下文，避免输出过长
- 阅读附件优先使用 `read_task_attachment`
- 只有在用户明确需要本地文件时才使用 `download_task_attachment`

## Scope

这份策略适用于：

- MCP 模式
- 直接 CLI 模式
- 本仓库附带的调试 UI
- 引用 [PROMPTS.md](./PROMPTS.md) 的上层模型系统提示
