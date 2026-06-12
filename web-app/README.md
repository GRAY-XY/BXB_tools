# BXB Student Web 版

班学帮学生助手的 Web 版本，提供与桌面版相同的功能，无需安装即可在浏览器中使用。

## 📋 项目概述

这是一个前后端分离的 Web 应用：
- **前端**：原生 JavaScript + Vite，模块化组件设计
- **后端**：Node.js + Express，提供 RESTful API
- **核心**：复用现有的 `src/banxuebang-client.js` 业务逻辑

## 🎯 功能列表

### 已实现功能
- ✅ 用户登录（账号密码）
- ✅ 会话管理（自动保持登录状态）
- ✅ 工作台（待办作业、成绩概览、课程列表）
- ✅ 作业列表（筛选、查看详情）
- ✅ 课程切换
- ✅ 学期切换
- ✅ 私信列表
- ✅ 文件管理
- ✅ 设置页面

### 待完成功能
- ⏳ 作业提交（文件上传）
- ⏳ 附件下载
- ⏳ 私信发送
- ⏳ 通知中心
- ⏳ 课程表显示
- ⏳ 成绩详细数据
- ⏳ 主题切换（深色模式）

## 🚀 快速开始

### 前置要求
- Node.js >= 22
- npm 或 yarn

### 安装依赖
```bash
cd web-app
npm install
```

### 启动开发服务器
```bash
npm run dev
```

这会同时启动：
- **后端服务器**：http://localhost:3000
- **前端开发服务器**：http://localhost:5173

### 访问应用
打开浏览器访问：http://localhost:5173

## 📁 项目结构

```
web-app/
├── server/
│   └── index.js              # Express 后端服务器
├── src/
│   ├── api/
│   │   └── client.js         # API 客户端封装
│   ├── components/
│   │   ├── Sidebar.js        # 侧边栏组件
│   │   └── Toolbar.js        # 工具栏组件
│   ├── pages/
│   │   ├── OverviewPage.js   # 工作台页面
│   │   ├── HomeworkPage.js   # 作业页面
│   │   ├── SchedulePage.js   # 课程页面
│   │   ├── NoticesPage.js    # 通知页面
│   │   ├── MessagesPage.js   # 私信页面
│   │   ├── FilesPage.js      # 文件页面
│   │   └── SettingsPage.js   # 设置页面
│   ├── app.js                # 应用状态管理
│   ├── main.js               # 应用入口
│   └── style.css             # 全局样式
├── index.html                # HTML 入口
├── vite.config.js            # Vite 配置
├── package.json              # 项目配置
└── README.md                 # 本文档
```

## 🔧 开发指南

### 添加新页面

1. **创建页面组件**（`src/pages/NewPage.js`）：
```javascript
export function NewPage({ app, state }) {
  return `
    <div class="page-container">
      <div class="page-header">
        <h1 class="page-title">新页面</h1>
        <p class="page-subtitle">页面描述</p>
      </div>
      <!-- 页面内容 -->
    </div>
  `;
}
```

2. **在 main.js 中注册页面**：
```javascript
import { NewPage } from './pages/NewPage.js';

const pages = {
  // ... 其他页面
  newPage: NewPage
};
```

3. **在侧边栏添加导航项**（`src/components/Sidebar.js`）：
```javascript
const menuItems = [
  // ... 其他菜单
  { id: 'newPage', icon: '🆕', label: '新页面', badge: null }
];
```

### 添加新 API

1. **在后端添加路由**（`server/index.js`）：
```javascript
app.get('/api/new-endpoint', async (req, res) => {
  try {
    const client = getClient(req.sessionID);
    const result = await client.someMethod();
    res.json({ success: true, data: result });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});
```

2. **在前端添加 API 封装**（`src/api/client.js`）：
```javascript
export const newAPI = {
  getData: () => api('/new-endpoint')
};
```

3. **在 App 类中调用**（`src/app.js`）：
```javascript
async loadNewData() {
  const result = await newAPI.getData();
  if (result.success) {
    this.setState({ newData: result.data });
  }
}
```

### 样式规范

应用使用 CSS 变量主题系统，主要颜色：
- `--color-primary`: #667eea（主色）
- `--color-secondary`: #764ba2（辅助色）
- `--color-success`: #48bb78（成功）
- `--color-warning`: #ed8936（警告）
- `--color-danger`: #f56565（危险）

常用 CSS 类：
- `.btn-primary` - 主按钮
- `.btn-secondary` - 次要按钮
- `.card` - 卡片容器
- `.empty-state` - 空状态提示
- `.filter-btn` - 筛选按钮

## 🔌 API 接口说明

### 会话管理
- `GET /api/session/status` - 获取登录状态
- `POST /api/session/login` - 用户登录
- `POST /api/session/clear` - 退出登录

### 学期与课程
- `GET /api/terms` - 获取学期列表
- `POST /api/terms/set` - 切换学期
- `GET /api/courses` - 获取课程列表
- `POST /api/courses/set` - 切换课程

### 作业
- `GET /api/homework` - 获取作业列表（支持分页和筛选）
- `GET /api/tasks/:taskId` - 获取作业详情
- `GET /api/tasks/:taskId/content` - 获取作业内容
- `POST /api/tasks/:taskId/download` - 下载作业附件
- `POST /api/tasks/:taskId/submit` - 提交作业

### 成绩
- `GET /api/achievement` - 获取成绩概览
- `GET /api/gpa` - 获取当前科目 GPA

### 私信
- `GET /api/messages/contacts` - 获取联系人列表
- `POST /api/messages/thread` - 获取消息线程
- `POST /api/messages/send` - 发送消息

### 文件
- `GET /api/workspace/files` - 获取工作区文件列表
- `GET /api/workspace/files/:file` - 读取文件内容
- `POST /api/workspace/files` - 创建文件

### 仪表板
- `GET /api/dashboard` - 获取仪表板数据（聚合接口）

## 🎨 UI/UX 设计

### 设计原则
1. **一致性**：与 Flutter 桌面版保持视觉和交互一致
2. **响应式**：适配桌面、平板、手机多种屏幕
3. **可访问性**：支持键盘导航，语义化 HTML
4. **性能**：按需加载，避免不必要的重渲染

### 布局结构
```
┌─────────────────────────────────────┐
│ 侧边栏  │     主内容区域            │
│         │  ┌─────────────────────┐  │
│ Logo    │  │ 工具栏（可选）      │  │
│ 用户卡  │  ├─────────────────────┤  │
│ 导航    │  │                     │  │
│         │  │   页面内容          │  │
│         │  │                     │  │
│ 统计    │  │                     │  │
└─────────┴──┴─────────────────────┘  │
```

## 📦 构建与部署

### 开发模式
```bash
npm run dev
```

### 生产构建
```bash
# 构建前端
npm run build

# 启动生产服务器（需要自行配置）
# 1. 使用 nginx 托管 dist 目录
# 2. 使用 Node.js 服务器提供 API
```

### 部署建议

**方案 1：静态托管 + API 服务器**
- 前端：部署到 Vercel、Netlify、GitHub Pages
- 后端：部署到 Heroku、Railway、自己的服务器

**方案 2：一体化部署**
- 修改 `server/index.js` 添加静态文件服务
- 部署到 VPS 或云服务器

## 🐛 常见问题

### Q: 登录后一直转圈
A: 检查后端服务是否正常启动，查看浏览器控制台的网络请求

### Q: 作业列表为空
A: 确认已选择正确的学期和课程，检查 API 响应

### Q: 跨域错误
A: 开发模式下已配置 CORS，生产环境需要配置服务器 CORS 策略

### Q: 文件上传失败
A: 文件上传功能尚未完成，预计下个版本实现

## 🔄 下一步计划

### 短期目标（1-2 周）
- [ ] 完成作业提交功能
- [ ] 实现文件上传和下载
- [ ] 完善私信功能
- [ ] 添加通知提醒

### 中期目标（1 个月）
- [ ] 实现课程表展示
- [ ] 添加数据可视化（成绩图表）
- [ ] 支持主题切换
- [ ] 移动端优化

### 长期目标（3 个月）
- [ ] PWA 支持（离线使用）
- [ ] 实时通知推送
- [ ] 数据导出功能
- [ ] 多语言支持

## 👥 贡献指南

欢迎贡献代码！请遵循以下步骤：

1. Fork 项目
2. 创建特性分支（`git checkout -b feature/AmazingFeature`）
3. 提交更改（`git commit -m 'Add some AmazingFeature'`）
4. 推送到分支（`git push origin feature/AmazingFeature`）
5. 开启 Pull Request

### 代码规范
- 使用 ES6+ 语法
- 组件函数使用 JSDoc 注释
- 保持代码简洁，单一职责
- 提交前测试功能

## 📝 更新日志

### v1.0.0 (2026-06-12)
- 🎉 初始版本发布
- ✨ 实现核心功能：登录、工作台、作业、课程
- 🎨 完成 UI 设计，与桌面版风格一致
- 📱 支持响应式布局

## 📄 许可证

本项目与主项目使用相同的许可证。

## 🔗 相关链接

- [主项目 README](../README.md)
- [API 文档](../PRIVATE_MESSAGE_API.md)
- [提示词文档](../PROMPTS.md)

## 💡 技术亮点

1. **模块化架构**：组件、页面、API 清晰分离
2. **状态管理**：简单的观察者模式，轻量高效
3. **无框架依赖**：纯 JavaScript 实现，加载快速
4. **复用业务逻辑**：直接使用现有的客户端代码
5. **RESTful API**：标准化接口设计
6. **现代开发体验**：Vite HMR、ES Modules

---

**开发者**：GRAY-XY  
**最后更新**：2026-06-12  
**联系方式**：通过 GitHub Issues
