# 🚀 Web 版开发快速启动指南

## 🎯 目标

在接下来的 2 周内完成 Web 版的核心功能，使其达到可用状态。

---

## 📋 第一周任务清单

### Day 1-2: 作业提交功能 - 文件上传

**目标**: 实现文件上传组件和进度显示

#### 前端任务
```javascript
// 1. 创建文件上传组件 (src/components/FileUploader.js)
- [ ] 文件选择按钮
- [ ] 拖拽上传区域
- [ ] 文件列表显示
- [ ] 上传进度条
- [ ] 删除已选文件

// 2. 在作业详情页集成 (src/pages/HomeworkPage.js)
- [ ] 添加"提交作业"按钮
- [ ] 集成 FileUploader 组件
- [ ] 处理提交逻辑
```

#### 后端任务
```javascript
// 3. 实现文件上传 API (server/index.js)
- [ ] 安装 multer 中间件
- [ ] 配置文件存储
- [ ] 实现 POST /api/tasks/:taskId/upload
- [ ] 文件大小限制
- [ ] 文件类型验证
```

**验收标准**:
- ✅ 可以选择文件
- ✅ 可以拖拽上传
- ✅ 显示上传进度
- ✅ 文件成功上传到服务器

---

### Day 3-4: 作业提交功能 - 完整流程

**目标**: 完成作业提交的完整流程

#### 前端任务
```javascript
// 1. 完善提交流程
- [ ] 提交前确认弹窗
- [ ] 提交中状态显示
- [ ] 提交成功提示
- [ ] 提交失败处理

// 2. 提交历史
- [ ] 显示已提交的文件
- [ ] 提交时间
- [ ] 提交状态（待批改/已批改）
```

#### 后端任务
```javascript
// 2. 完善提交 API
- [ ] POST /api/tasks/:taskId/submit
- [ ] GET /api/tasks/:taskId/submissions
- [ ] 调用 banxuebang-client 的提交方法
- [ ] 保存提交记录
```

**验收标准**:
- ✅ 可以完整提交作业
- ✅ 提交后能看到提交记录
- ✅ 错误处理完善

---

### Day 5: 附件下载功能 - 基础实现

**目标**: 实现附件下载和列表显示

#### 前端任务
```javascript
// 1. 附件列表组件
- [ ] 显示附件名称
- [ ] 显示文件大小
- [ ] 下载按钮
- [ ] 下载进度提示

// 2. 集成到作业详情页
- [ ] 在作业详情中显示附件列表
- [ ] 点击下载触发下载
```

#### 后端任务
```javascript
// 2. 下载 API
- [ ] GET /api/tasks/:taskId/attachments
- [ ] GET /api/attachments/:id/download
- [ ] 调用 banxuebang-client 下载方法
- [ ] 流式传输文件
```

**验收标准**:
- ✅ 能看到所有附件
- ✅ 点击可以下载
- ✅ 有下载进度提示

---

### Day 6-7: 周末整合测试

**任务**:
- [ ] 完整测试作业提交流程
- [ ] 测试附件下载流程
- [ ] 修复发现的 Bug
- [ ] 优化用户体验
- [ ] 更新文档

---

## 📋 第二周任务清单

### Day 8-9: 附件预览 & 批量操作

**目标**: 增强附件功能

#### 前端任务
```javascript
// 1. 附件预览
- [ ] 图片预览（灯箱效果）
- [ ] PDF 在线预览
- [ ] 文档预览（如支持）

// 2. 批量操作
- [ ] 批量选择附件
- [ ] 批量下载
- [ ] 打包下载为 ZIP
```

#### 后端任务
```javascript
// 2. 预览 API
- [ ] GET /api/attachments/:id/preview
- [ ] 支持图片直接返回
- [ ] 支持 PDF 在线查看
```

---

### Day 10-11: 私信发送功能

**目标**: 完成私信发送和实时更新

#### 前端任务
```javascript
// 1. 消息输入组件
- [ ] 多行文本输入框
- [ ] 发送按钮
- [ ] 字数统计
- [ ] 表情选择器（可选）

// 2. 消息发送逻辑
- [ ] 调用发送 API
- [ ] 乐观更新（立即显示）
- [ ] 发送状态（发送中/成功/失败）
- [ ] 失败重试

// 3. 消息实时更新
- [ ] 轮询新消息（每 5-10 秒）
- [ ] 未读消息提示
- [ ] 自动滚动到最新消息
```

#### 后端任务
```javascript
// 2. 私信 API
- [ ] POST /api/messages/send
- [ ] GET /api/messages/thread?contactId=xxx&since=timestamp
- [ ] 调用 banxuebang-client 发送方法
- [ ] 处理发送失败
```

**验收标准**:
- ✅ 可以发送消息
- ✅ 发送后立即显示
- ✅ 可以查看发送状态
- ✅ 新消息自动加载

---

### Day 12: 通知中心基础

**目标**: 实现基础通知功能

#### 前端任务
```javascript
// 1. 通知列表页面
- [ ] 通知列表展示
- [ ] 未读标记（红点）
- [ ] 通知时间
- [ ] 通知内容

// 2. 顶部通知图标
- [ ] 显示未读数量
- [ ] 点击跳转到通知页
```

#### 后端任务
```javascript
// 2. 通知 API（模拟或调研真实 API）
- [ ] GET /api/notifications
- [ ] POST /api/notifications/:id/read
- [ ] GET /api/notifications/unread-count
```

---

### Day 13-14: 整体测试 & 优化

**任务**:
- [ ] 完整功能测试
- [ ] 性能优化
  - [ ] 图片懒加载
  - [ ] API 请求缓存
  - [ ] 减少不必要的重渲染
- [ ] UI 优化
  - [ ] Loading 状态
  - [ ] 空状态提示
  - [ ] 错误提示美化
- [ ] 移动端测试
- [ ] 浏览器兼容性测试
- [ ] 文档更新

---

## 🛠️ 开发环境设置

### 1. 安装依赖
```bash
cd /Users/igpig/BXB_tools/web-app
npm install

# 如果需要文件上传
npm install multer

# 如果需要 ZIP 打包
npm install archiver
```

### 2. 启动开发服务器
```bash
npm run dev
```

访问: http://localhost:5173

### 3. 测试 API
```bash
# 使用 curl 或 Postman 测试
curl http://localhost:3000/api/session/status
```

---

## 📝 代码模板

### 文件上传组件模板
```javascript
// src/components/FileUploader.js
export function FileUploader({ onUpload, maxSize = 10 * 1024 * 1024 }) {
  return `
    <div class="file-uploader">
      <div class="upload-area" id="uploadArea">
        <input type="file" id="fileInput" multiple hidden>
        <div class="upload-icon">📁</div>
        <p>拖拽文件到这里或点击选择</p>
        <p class="upload-hint">支持多个文件，单个文件最大 ${maxSize / 1024 / 1024}MB</p>
      </div>
      <div class="file-list" id="fileList"></div>
    </div>
  `;
}

// 添加事件处理
export function initFileUploader() {
  const uploadArea = document.getElementById('uploadArea');
  const fileInput = document.getElementById('fileInput');
  
  // 点击上传
  uploadArea.addEventListener('click', () => fileInput.click());
  
  // 文件选择
  fileInput.addEventListener('change', handleFiles);
  
  // 拖拽上传
  uploadArea.addEventListener('drop', (e) => {
    e.preventDefault();
    handleFiles(e.dataTransfer.files);
  });
  
  uploadArea.addEventListener('dragover', (e) => e.preventDefault());
}

function handleFiles(files) {
  // 处理文件上传逻辑
  Array.from(files).forEach(file => {
    uploadFile(file);
  });
}

async function uploadFile(file) {
  const formData = new FormData();
  formData.append('file', file);
  
  try {
    const response = await fetch('/api/upload', {
      method: 'POST',
      body: formData
    });
    
    if (response.ok) {
      console.log('上传成功');
    }
  } catch (error) {
    console.error('上传失败', error);
  }
}
```

### 后端文件上传 API 模板
```javascript
// server/index.js
import multer from 'multer';
import path from 'path';

// 配置文件存储
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, 'uploads/');
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, uniqueSuffix + path.extname(file.originalname));
  }
});

const upload = multer({
  storage,
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB
  fileFilter: (req, file, cb) => {
    // 可以添加文件类型验证
    cb(null, true);
  }
});

// 文件上传路由
app.post('/api/tasks/:taskId/upload', upload.single('file'), (req, res) => {
  try {
    const { taskId } = req.params;
    const file = req.file;
    
    if (!file) {
      return res.status(400).json({ success: false, error: '没有文件' });
    }
    
    res.json({
      success: true,
      file: {
        name: file.originalname,
        path: file.path,
        size: file.size
      }
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// 作业提交路由
app.post('/api/tasks/:taskId/submit', async (req, res) => {
  try {
    const { taskId } = req.params;
    const { files } = req.body;
    
    const client = getClient(req.sessionID);
    
    // 调用 banxuebang-client 的提交方法
    await client.submitTaskResult(taskId, files);
    
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});
```

---

## ✅ 每日检查清单

### 开发前
- [ ] 拉取最新代码 `git pull`
- [ ] 启动开发服务器 `npm run dev`
- [ ] 查看今日任务

### 开发中
- [ ] 遵循代码规范
- [ ] 添加必要的注释
- [ ] 测试新增功能
- [ ] 处理边界情况

### 开发后
- [ ] 提交代码 `git commit -m "feat: 描述"`
- [ ] 更新任务进度
- [ ] 记录遇到的问题
- [ ] 规划明天任务

---

## 🎯 两周后的目标

完成后，Web 版应该能够:

✅ **核心功能完整**
- 登录 & 会话管理
- 查看作业列表和详情
- 提交作业（包括文件上传）
- 下载附件（包括预览）
- 发送私信
- 查看通知

✅ **用户体验良好**
- 界面友好、操作流畅
- 错误提示清晰
- Loading 状态明确
- 移动端可用

✅ **代码质量高**
- 结构清晰、易维护
- 关键功能有注释
- 文档完整

---

## 🆘 遇到问题怎么办？

### 技术问题
1. 查看浏览器控制台错误
2. 查看服务器日志
3. 查阅文档或 API 说明
4. 在代码中添加 `console.log` 调试
5. 使用 Postman 测试 API

### 业务逻辑问题
1. 参考 Flutter 桌面版的实现
2. 查看 `src/banxuebang-client.js` 的方法
3. 查看 API 文档
4. 测试班学帮官方网站的行为

### 时间不够
1. 优先完成核心功能
2. 降低功能复杂度
3. 推迟次要功能
4. 寻求帮助

---

**准备好了吗？让我们开始吧！** 🚀

从 Day 1 的文件上传组件开始，一步一步完成目标！
