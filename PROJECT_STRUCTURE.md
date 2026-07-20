# 项目结构

## 目录总览

```
BXB_tools/
├── src/                        # MCP 服务核心源代码
├── scripts/                    # 工具脚本
├── UI/                         # Flutter 桌面应用
├── desktop-shell/              # 桌面端运行时桥接层
├── web-app/                    # Web 应用（开发中）
├── docs/                       # 项目文档
├── config/                     # 配置文件
├── data/                       # 数据文件
├── homebrew-tap-init/          # Homebrew tap 配置
├── .github/workflows/          # CI/CD 工作流
├── README.md
├── CHANGELOG.md
├── PROMPTS.md
└── package.json
```

---

## 各目录说明

### `src/` — MCP Server

| 文件 | 说明 |
|---|---|
| `index.js` | MCP server 入口，stdio 通信 |
| `banxuebang-client.js` | Banxuebang HTTP API 客户端 |
| `session-store.js` | 会话持久化 |
| `tool-definitions.js` | MCP 工具注册表 |

### `scripts/` — 工具脚本

| 文件 | 说明 |
|---|---|
| `call-tool.js` | 通过 MCP stdio 调用工具 |
| `direct-tool.js` | 直接调用客户端（绕过 MCP） |
| `publish-scan.js` | 发布前安全扫描 |
| `clean.sh` | 清理构建产物脚本 |

### `UI/banxuebang_flutter/` — Flutter 桌面应用

当前推荐的桌面端方案，支持 macOS 和 Windows。

```
UI/banxuebang_flutter/
├── lib/                        # Flutter 源代码
│   └── src/
│       ├── app.dart
│       ├── bridge/             # 与 Node 桥接
│       ├── models/             # 数据模型
│       ├── screens/            # 页面
│       ├── services/           # 服务层
│       ├── state/              # 状态管理
│       ├── theme/              # 主题
│       └── utils/
├── macos/                      # macOS 平台配置
├── windows/                    # Windows 平台配置
└── packaging/                  # 打包脚本
    ├── macos/build_macos_pkg.sh
    └── windows/
```

### `desktop-shell/` — 运行时桥接层

Flutter 应用的 Node.js 后端桥接，`node_bridge.js` 是核心。`packaging/` 子目录保留旧版打包方案，仅作历史参考。

### `web-app/` — Web 应用

基于 Vite + 原生 JS + Express，无需安装即可在浏览器使用。

```
web-app/
├── src/                        # 前端源代码
│   ├── main.js                 # 应用入口 & 事件处理
│   ├── app.js                  # 状态管理
│   ├── style.css               # 全局样式
│   ├── locales.js              # 国际化（中文/英文）
│   ├── api/client.js           # API 客户端封装
│   ├── components/
│   │   ├── Sidebar.js
│   │   └── Toolbar.js
│   └── pages/
│       ├── DirectLoginPage.js
│       ├── OverviewPage.js
│       ├── HomeworkPage.js
│       ├── SchedulePage.js
│       ├── NoticesPage.js
│       ├── MessagesPage.js
│       ├── FilesPage.js
│       └── SettingsPage.js
├── server/index.js             # Express 后端
├── public/                     # 静态资源
├── index.html
├── vite.config.js
├── package.json
├── README.md                   # web-app 文档
└── TODO.md                     # 待办事项
```

**启动：**
```bash
cd web-app
npm run dev
# 前端: http://localhost:5173
# 后端: http://localhost:3000
```

**已实现功能：** 登录、工作台、作业列表/详情、课程切换、学期切换、私信列表、文件管理、设置（含语言切换）

**待实现：** 作业提交、附件下载、通知中心、课程表、深色模式，详见 `web-app/TODO.md`

### `docs/` — 项目文档

```
docs/
├── INDEX.md                    # 文档索引
├── api/                        # API 文档
├── development/                # 开发文档
├── user-guide/                 # 用户指南
├── releases/                   # 发布说明
├── legal/                      # 法律文档
├── admin/                      # 管理员文档
└── website/                    # 网站文档
```

---

## 本地忽略的目录

以下目录在 `.gitignore` 中，只存在于本地：

- `node_modules/` — Node.js 依赖
- `.banxuebang/` — 会话数据
- `.playwright-cli/` — Playwright 浏览器缓存
- `artifacts/` — 构建临时文件
- `build/` — 构建输出
- `dist/` — 分发包

---

## 构建与发布

### macOS 安装包
```bash
chmod +x ./UI/banxuebang_flutter/packaging/macos/build_macos_pkg.sh
./UI/banxuebang_flutter/packaging/macos/build_macos_pkg.sh
```

### Windows 安装包
详见 `UI/banxuebang_flutter/packaging/README.md`

### 清理构建产物
```bash
npm run clean
```

### CI/CD
GitHub Actions 自动构建，配置在 `.github/workflows/`。
