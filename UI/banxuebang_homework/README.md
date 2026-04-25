# Banxuebang Homework UI Shell

这个目录是从 `client` 分支的 `banxuebang-homework/banxuebang_gui.py` 拆出来的 UI 壳层。

和原始版本的关键区别：

- 不再在 UI 内部重写一套伴学邦 API 逻辑
- 不再自动 `pip install`
- 不再保存明文密码
- 不再直接依赖独立 Python Playwright 登录实现
- 默认通过 `scripts/direct-tool.js` 复用 `main` 分支已经存在的能力

## Current Architecture

```text
Tkinter UI
  -> DirectToolBackend
      -> node scripts/direct-tool.js
          -> main-branch Banxuebang client
```

## Files

- `interfaces.py`
  定义 UI 所依赖的后端接口
- `direct_tool_backend.py`
  当前默认适配器，通过 `direct-tool.js` 调用现有 Node 工具
- `tk_app.py`
  Tkinter 界面本体
- `run.py`
  启动入口

## Supported UI Features

- 浏览器登录
- 账号密码登录
- 读取当前会话
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
python -m UI.banxuebang_homework.run
```

前提：

- 已安装 Python 3.10+
- 已安装 Node.js
- 仓库根目录下的 `scripts/direct-tool.js` 可以正常运行
- 如果需要浏览器登录或截图能力，请先准备 Playwright Chromium
