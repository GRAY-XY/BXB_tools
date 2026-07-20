# BXB Student Web App

班学帮学生助手的 Web 版本，无需安装客户端，在浏览器中使用全部功能。

## 快速开始

```bash
cd web-app
npm install
npm run dev
```

打开浏览器访问：**http://localhost:5173**

- 前端开发服务器：`http://localhost:5173`
- 后端 API 服务器：`http://localhost:3000`

> 需要 Node.js >= 22

## 登录

启动后输入班学帮账号和密码登录，等待 10–30 秒（后台浏览器自动完成认证）。

## 已实现功能

| 功能 | 状态 |
|---|---|
| 登录 / 会话管理 | ✅ |
| 自动选择最新学期 | ✅ |
| 工作台（待办作业、成绩概览、课程列表） | ✅ |
| 作业列表与详情 | ✅ |
| 课程 / 学期切换 | ✅ |
| 私信联系人列表 | ✅ |
| 文件管理 | ✅ |
| 设置（语言切换 中文/English） | ✅ |

## 待实现

详见 [TODO.md](./TODO.md)，主要包括：
- 作业提交与附件下载
- 私信发送
- 通知中心
- 课程表
- 深色模式

## 项目结构

```
web-app/
├── src/
│   ├── main.js          # 应用入口 & 事件处理
│   ├── app.js           # 状态管理
│   ├── style.css        # 全局样式
│   ├── locales.js       # 国际化（中/英）
│   ├── api/client.js    # API 客户端
│   ├── components/      # Sidebar、Toolbar
│   └── pages/           # 各功能页面
├── server/index.js      # Express 后端
├── public/              # 静态资源
├── index.html
├── vite.config.js
└── package.json
```

## API 接口（后端 :3000）

| 端点 | 说明 |
|---|---|
| `GET /api/session/status` | 会话状态 |
| `POST /api/session/login` | 登录 |
| `GET /api/terms` | 学期列表 |
| `POST /api/terms/set` | 切换学期 |
| `GET /api/courses` | 课程列表 |
| `POST /api/courses/set` | 切换课程 |
| `GET /api/homework` | 作业列表 |
| `GET /api/tasks/:id` | 作业详情 |
| `GET /api/achievement` | 成绩概览 |
| `GET /api/messages/contacts` | 私信联系人 |
| `POST /api/messages/thread` | 消息线程 |
| `GET /api/dashboard` | 仪表板聚合数据 |

## 常见问题

**登录后一直转圈** — 检查后端服务是否正常启动，查看浏览器控制台网络请求。

**作业列表为空** — 确认已选择正确的学期和课程。

**刷新后数据消失** — 后端 session 可能已过期，重新登录即可。
