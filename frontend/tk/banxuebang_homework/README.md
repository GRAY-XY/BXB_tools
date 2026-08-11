# Banxuebang Homework UI Shell

这个目录是从 `client` 分支的 `banxuebang-homework/banxuebang_gui.py` 拆出来的 UI 壳层。

和原始版本的关键区别：

- 不再在 UI 内部重写一套伴学邦 API 逻辑
- 不再自动 `pip install`
- 不再保存明文密码
- 不再直接依赖独立 Python Playwright 登录实现
- 默认通过 `backend/cli/direct-tool.js` 复用 `main` 分支已经存在的能力

## Current Architecture

```text
Tkinter UI
  -> llm_agent.py
      -> backend_factory.py
          -> DirectToolBackend
              -> node backend/cli/direct-tool.js
              -> main-branch Banxuebang client
```

## Files

- `interfaces.py`
  定义 UI 所依赖的后端接口
- `backend_factory.py`
  统一创建后端实例；当前默认是 `direct-tool`
- `agent.py`
  规则型 Agent，只保留最近几轮对话文本，负责工具选择和多步编排
- `agent_smoke_test.py`
  用假后端验证 Agent 的工具编排
- `model_config.py`
  保存本地模型配置，并按 OpenAI 兼容 `/models` 接口测试连通性
- `llm_agent.py`
  大模型对话层，按 OpenAI 兼容 `chat/completions` 调用模型，并把伴学邦工具暴露给模型
- `llm_agent_smoke_test.py`
  用假模型服务验证“大模型 -> 工具调用 -> 最终回答”链路
- `direct_tool_backend.py`
  当前默认适配器，通过 `direct-tool.js` 调用现有 Node 工具
- `tk_app.py`
  Tkinter 界面本体
- `run.py`
  启动入口
- `smoke_test.py`
  不启动 Tkinter 的后端冒烟测试

## Supported UI Features

- 浏览器登录
- 账号密码登录
- 读取当前会话
- Agent 对话式执行
- 模型配置保存与连通性测试
- 大模型对话 + 工具调用
- 学期切换
- 课程切换
- 当前课程任务列表
- 所有课程任务汇总
- 任务正文预览
- 当前课程 GPA 读取

## Not Yet Wired

主线工具层当前还没有这些接口，因此这里仅保留页面占位：

- 课表
- 通知

## Run

在仓库根目录执行：

```bash
python -m frontend.tk.banxuebang_homework.run
```

也可以显式指定后端或仓库路径：

```bash
python -m frontend.tk.banxuebang_homework.run --backend direct-tool --repo-root D:\MCP_Server
```

只测试工具后端，不启动界面：

```bash
python -m frontend.tk.banxuebang_homework.smoke_test --tool session_status
```

测试 Agent 编排：

```bash
python -m frontend.tk.banxuebang_homework.agent_smoke_test
```

测试 LLM 工具调用链：

```bash
python -m frontend.tk.banxuebang_homework.llm_agent_smoke_test
```

## Model Config

UI 里新增了“模型”页，支持填写：

- API Key
- 调用链接
- 模型名称

并提供：

- 本地保存
- 重新加载
- 连通性测试

当前测试逻辑是访问 OpenAI 兼容的 `/models` 接口，并检查你填写的模型名是否出现在返回列表里。

保存并测试通过后，“助手”页会优先使用这个模型进行真实对话，并通过工具调用访问伴学邦数据。

配置文件默认保存到用户主目录：

```text
~/.bxb_model_config.json
```

这不是仓库内文件，不会随 Git 提交。

前提：

- 已安装 Python 3.10+
- 已安装 Node.js
- 仓库根目录下的 `backend/cli/direct-tool.js` 可以正常运行
- 如果需要浏览器登录或截图能力，请先准备 Playwright Chromium
