# UI Shells

这个目录用于放伴学邦相关的独立 UI 壳层。

当前包含：

- `banxuebang_homework/`
  从 `client` 分支的 `banxuebang-homework/banxuebang_gui.py` 拆出来的 Tkinter 界面，
  但不再复用那套独立 Python API 实现，而是通过接口层调用 `main` 分支现有工具。

设计目标：

- UI 只负责展示与交互
- 后端能力通过接口层注入
- 当前默认后端是 `scripts/direct-tool.js`
- 后续可以替换为 `MCP`、`Agent`、`PowerShell` 或其他宿主

这套 UI 目前已经接通的能力：

- 浏览器登录
- 账号密码登录
- 会话状态读取
- 学期切换
- 课程切换
- 当前课程作业列表
- 所有课程作业汇总
- 任务正文预览
- 当前课程 GPA 查询

这套 UI 当前未接通的能力：

- 课表
- 通知

原因不是 UI 没有页面，而是 `main` 分支当前工具层还没有提供对应接口。
