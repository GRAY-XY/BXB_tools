import express from 'express';
import cors from 'cors';
import session from 'express-session';
import path from 'path';
import { fileURLToPath } from 'url';
import { BanxuebangClient } from '../../src/banxuebang-client.js';
import { SessionStore } from '../../src/session-store.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = 3000;

// 中间件
app.use(cors({
  origin: 'http://localhost:5173',
  credentials: true
}));
app.use(express.json());
app.use(session({
  secret: 'bxb-student-web-secret',
  resave: false,
  saveUninitialized: false,
  cookie: { 
    secure: false,
    maxAge: 24 * 60 * 60 * 1000 // 24 小时
  }
}));

// 为每个用户创建客户端实例
const getClient = (sessionId) => {
  const sessionFile = path.join(process.cwd(), '.banxuebang', 'sessions', `${sessionId}.json`);
  const store = new SessionStore(sessionFile);
  return new BanxuebangClient(store);
};

// API 路由
app.get('/api/session/status', async (req, res) => {
  try {
    const client = getClient(req.sessionID);
    const session = await client.getSession();
    const summary = client.summarizeSession(session);
    res.json({ success: true, data: summary });
  } catch (error) {
    res.json({ success: false, error: error.message });
  }
});

app.post('/api/session/login', async (req, res) => {
  try {
    const { username, password } = req.body;
    if (!username || !password) {
      return res.status(400).json({ success: false, error: '用户名和密码不能为空' });
    }

    const client = getClient(req.sessionID);
    const result = await client.loginWithCredentials({
      username,
      password,
      headless: true,
      timeoutMs: 60000
    });

    res.json({ success: true, data: result });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

app.post('/api/session/clear', async (req, res) => {
  try {
    const client = getClient(req.sessionID);
    await client.store.clear();
    res.json({ success: true, message: '会话已清除' });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

app.get('/api/terms', async (req, res) => {
  try {
    const client = getClient(req.sessionID);
    const session = await client.requireSession();
    const terms = await client.listTerms(session);
    res.json({ success: true, data: terms });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

app.post('/api/terms/set', async (req, res) => {
  try {
    const { termId } = req.body;
    const client = getClient(req.sessionID);
    const result = await client.setCurrentTerm({ termId });
    res.json({ success: true, data: result });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

app.get('/api/courses', async (req, res) => {
  try {
    const client = getClient(req.sessionID);
    const result = await client.listCourses();
    res.json({ success: true, data: result });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

app.post('/api/courses/set', async (req, res) => {
  try {
    const { subjectName } = req.body;
    const client = getClient(req.sessionID);
    const result = await client.setCurrentSubject({ subjectName });
    res.json({ success: true, data: result });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

app.get('/api/homework', async (req, res) => {
  try {
    const { status, page = 1, pageSize = 20 } = req.query;
    const client = getClient(req.sessionID);
    const result = await client.listHomework({
      status,
      page: parseInt(page),
      pageSize: parseInt(pageSize)
    });
    res.json({ success: true, data: result });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

app.get('/api/tasks/:taskId', async (req, res) => {
  try {
    const { taskId } = req.params;
    const client = getClient(req.sessionID);
    const result = await client.openTask({ taskId });
    res.json({ success: true, data: result });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

app.get('/api/tasks/:taskId/content', async (req, res) => {
  try {
    const { taskId } = req.params;
    const client = getClient(req.sessionID);
    const result = await client.readTaskContent({ taskId });
    res.json({ success: true, data: result });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

app.get('/api/achievement', async (req, res) => {
  try {
    const client = getClient(req.sessionID);
    const result = await client.getAchievementOverview();
    res.json({ success: true, data: result });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

app.get('/api/gpa', async (req, res) => {
  try {
    const client = getClient(req.sessionID);
    const result = await client.getCurrentSubjectGpa();
    res.json({ success: true, data: result });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

app.get('/api/messages/contacts', async (req, res) => {
  try {
    const client = getClient(req.sessionID);
    const result = await client.listPrivateMessageContacts();
    res.json({ success: true, data: result });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

app.post('/api/messages/thread', async (req, res) => {
  try {
    const { contact, size, endTime } = req.body;
    const client = getClient(req.sessionID);
    const result = await client.getPrivateMessageThread(contact, { size, endTime });
    res.json({ success: true, data: result });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

app.post('/api/messages/send', async (req, res) => {
  try {
    const { contact, content } = req.body;
    const client = getClient(req.sessionID);
    const result = await client.sendPrivateMessageText(contact, content);
    res.json({ success: true, data: result });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

app.get('/api/workspace/files', async (req, res) => {
  try {
    const { query, maxFiles } = req.query;
    const client = getClient(req.sessionID);
    const result = await client.listWorkspaceFiles({
      query: query || '',
      maxFiles: maxFiles ? parseInt(maxFiles) : 200
    });
    res.json({ success: true, data: result });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

app.get('/api/workspace/files/:file', async (req, res) => {
  try {
    const { file } = req.params;
    const { maxChars } = req.query;
    const client = getClient(req.sessionID);
    const result = await client.readWorkspaceFile({
      file,
      maxChars: maxChars ? parseInt(maxChars) : 8000
    });
    res.json({ success: true, data: result });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

app.post('/api/workspace/files', async (req, res) => {
  try {
    const { fileName, content, overwrite } = req.body;
    const client = getClient(req.sessionID);
    const result = await client.writeWorkspaceTextFile({
      fileName,
      content,
      overwrite: overwrite || false
    });
    res.json({ success: true, data: result });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

app.post('/api/tasks/:taskId/download', async (req, res) => {
  try {
    const { taskId } = req.params;
    const { fileId, directory } = req.body;
    const client = getClient(req.sessionID);
    const result = await client.downloadTaskAttachment({
      taskId,
      fileId,
      directory
    });
    res.json({ success: true, data: result });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

app.post('/api/tasks/:taskId/submit', async (req, res) => {
  try {
    const { taskId } = req.params;
    const { remark, filePaths, isCorrectWork, submissionId } = req.body;
    const client = getClient(req.sessionID);
    const result = await client.submitTaskResult({
      taskId,
      remark: remark || '',
      filePaths: filePaths || [],
      isCorrectWork: isCorrectWork || 0,
      submissionId
    });
    res.json({ success: true, data: result });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

app.get('/api/dashboard', async (req, res) => {
  try {
    const client = getClient(req.sessionID);
    const session = await client.requireSession();
    
    // 并行获取所有仪表板数据
    const [homeworkResult, achievementResult, coursesResult] = await Promise.all([
      client.listHomework({ listType: 'pending', page: 1, size: 5 }).catch(() => null),
      client.getAchievementOverview().catch(() => null),
      client.listCourses().catch(() => null)
    ]);
    
    res.json({
      success: true,
      data: {
        session: client.summarizeSession(session),
        pendingHomework: homeworkResult?.items || [],
        achievement: achievementResult,
        courses: coursesResult?.subjects || []
      }
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

app.listen(PORT, () => {
  console.log(`🚀 BXB Student Web Server running at http://localhost:${PORT}`);
});
