# Changelog

## 1.3.1 - 2026-07-20

### Web App
- 新增界面语言切换功能（中文 / English），设置页面内切换，持久化到 localStorage
- 修复设置页面语言选择框点击无响应的问题（改为 pill 按钮方案，绕开浏览器 overflow/事件拦截限制）
- 整合国际化系统（`src/locales.js`），侧边栏、工具栏、设置页面均已支持多语言
- 清理开发阶段临时文件（test-*.js、test-*.html、冗余 .md 文档）

## 1.3.0 - 2026-07-14

### Web App（新增）
- 新增 `web-app/` 基于 Vite + 原生 JS + Express 的 Web 应用，无需安装客户端即可在浏览器使用
- 前端端口 `localhost:5173`，后端 API 端口 `localhost:3000`
- 已实现功能：登录、会话管理、工作台、作业列表与详情、课程切换、学期切换、私信列表、文件管理、设置页面
- 支持自动选择最新学期
- 使用 `npm run dev`（在 `web-app/` 目录下）启动开发服务器

### 项目清理
- 删除 Python/Tkinter 旧桌面客户端 `desktop-client/`（约 2.4MB）
- 清理构建产物（`build/`、`dist/`，约 1.4GB）
- 文档重组到 `docs/` 子目录
- 新增 `scripts/clean.sh` 清理脚本

## 1.1.0 - 待发布

### Flutter 桌面应用
- 新增私信功能：学生可在应用内与老师私信沟通
  - 私信联系人列表，显示未读数量和最后消息预览
  - 完整消息会话界面，支持查看历史消息和发送文字
  - 实时更新未读消息计数，侧边栏徽章提示
- 实现三个后端 API 命令：`list-private-contacts`、`get-private-thread`、`send-private-message`
- 新增 `PrivateContact`、`PrivateMessage` 数据模型
- 扩展 `AppController` 状态管理支持私信功能

## 1.0.2 - 2026-05-18

- 新增 `UI/banxuebang_flutter/` Flutter 桌面应用，复用 `desktop-shell/node_bridge.js` 作为运行时层
- macOS 自包含打包（含 node、node_modules、Playwright Chromium、发布说明）
- Windows 安装包脚本及 GitHub Actions 工作流
- 修复桌面端运行时路径解析和 App Support 存储路径问题

详见 [docs/releases/1.0.2.md](docs/releases/1.0.2.md)

## 1.0.1 - 2026-04-28

- 重构桌面壳层，新增提醒中心、发布说明视图、管理策略集成

详见 [docs/releases/1.0.1.md](docs/releases/1.0.1.md)
