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
  saveUninitialized: true,  // 改为 true，确保会话 cookie 被设置
  cookie: { 
    secure: false,
    httpOnly: true,
    sameSite: 'lax',
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
  console.log('[Status] Session ID:', req.sessionID);
  try {
    const client = getClient(req.sessionID);
    const session = await client.getSession();
    const summary = client.summarizeSession(session);
    console.log('[Status] Ready:', summary.ready, 'User:', summary.userInfo?.userName);
    res.json({ success: true, data: summary });
  } catch (error) {
    console.error('[Status] Error:', error.message);
    res.json({ success: false, error: error.message });
  }
});

app.post('/api/session/login', async (req, res) => {
  console.log('=== 收到登录请求 ===');
  console.log('Session ID:', req.sessionID);
  console.log('Request body keys:', Object.keys(req.body));
  
  try {
    const { username, password, localStorage: browserStorage } = req.body;
    
    // 方式 1: 如果前端提供了 localStorage 数据（推荐）
    if (browserStorage) {
      console.log('使用 localStorage 登录方式');
      console.log('browserStorage keys:', Object.keys(browserStorage));
      console.log('tokens:', browserStorage.tokens ? '存在 (' + browserStorage.tokens.length + ' 字符)' : '不存在');
      console.log('userInfo:', browserStorage.userInfo ? '存在 (' + browserStorage.userInfo.length + ' 字符)' : '不存在');
      
      const client = getClient(req.sessionID);
      console.log('Client created, 调用 importBrowserStorage...');
      
      try {
        const result = await client.importBrowserStorage(browserStorage);
        console.log('✓ importBrowserStorage 成功');
        console.log('result:', JSON.stringify(result, null, 2));
        
        // 标记会话已登录
        req.session.loggedIn = true;
        req.session.userId = result.userInfo?.userName || 'unknown';
        await new Promise((resolve, reject) => {
          req.session.save((err) => {
            if (err) reject(err);
            else resolve();
          });
        });
        console.log('✓ Express session saved');
        
        return res.json({ success: true, data: result });
      } catch (importError) {
        console.error('✗ importBrowserStorage 失败:', importError);
        console.error('错误堆栈:', importError.stack);
        return res.status(500).json({ 
          success: false, 
          error: 'importBrowserStorage 失败: ' + importError.message 
        });
      }
    }
    
    // 方式 2: 使用服务器端浏览器登录（需要 Playwright）
    if (!username || !password) {
      console.log('✗ 缺少必要参数');
      return res.status(400).json({ 
        success: false, 
        error: '用户名和密码不能为空，或者提供 localStorage 数据' 
      });
    }

    console.log('使用用户名密码登录方式');
    console.log('username:', username);
    
    const client = getClient(req.sessionID);
    const result = await client.loginWithCredentials({
      username,
      password,
      headless: true,
      timeoutMs: 60000
    });

    console.log('✓ 登录成功');
    console.log('用户:', result.userInfo?.userName);
    
    // 标记会话已登录
    req.session.loggedIn = true;
    req.session.userId = result.userInfo?.userName || 'unknown';
    await new Promise((resolve, reject) => {
      req.session.save((err) => {
        if (err) reject(err);
        else resolve();
      });
    });
    console.log('✓ Express session saved, session ID:', req.sessionID);
    
    res.json({ success: true, data: result });
  } catch (error) {
    console.error('=== 登录失败 ===');
    console.error('错误:', error.message);
    console.error('错误堆栈:', error.stack);
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
  console.log('[Terms] ===== 开始切换学期 =====');
  console.log('[Terms] Session ID:', req.sessionID);
  console.log('[Terms] 请求的 Term ID:', req.body.termId);
  try {
    const { termId } = req.body;
    const client = getClient(req.sessionID);
    
    // 切换前的状态
    const beforeSession = await client.getSession();
    console.log('[Terms] 切换前的学期:', beforeSession.context.currTermId);
    
    const result = await client.setCurrentTerm(termId);
    
    // 切换后的状态
    const afterSession = await client.getSession();
    console.log('[Terms] 切换后的学期:', afterSession.context.currTermId);
    console.log('[Terms] 返回数据中的学期:', result.currentTermId);
    console.log('[Terms] ===== 学期切换成功 =====');
    
    res.json({ success: true, data: result });
  } catch (error) {
    console.error('[Terms] ===== 切换学期失败 =====');
    console.error('[Terms] 错误:', error.message);
    console.error('[Terms] 堆栈:', error.stack);
    res.status(500).json({ success: false, error: error.message });
  }
});

app.get('/api/courses', async (req, res) => {
  console.log('[Courses] Session ID:', req.sessionID);
  try {
    const client = getClient(req.sessionID);
    const result = await client.listCourses();
    console.log('[Courses] 获取成功，课程数量:', result.courses?.length || 0);
    res.json({ 
      success: true, 
      data: {
        subjects: result.courses || []  // 修复：映射 courses 到 subjects
      }
    });
  } catch (error) {
    console.error('[Courses] 获取课程失败:', error.message);
    res.status(500).json({ success: false, error: error.message });
  }
});

app.post('/api/courses/set', async (req, res) => {
  console.log('[Courses] 切换科目，Session ID:', req.sessionID);
  console.log('[Courses] Subject name:', req.body.subjectName);
  try {
    const { subjectName } = req.body;
    const client = getClient(req.sessionID);
    const result = await client.setCurrentSubjectByName(subjectName);  // 修复：使用 ByName 方法
    console.log('[Courses] 科目切换成功');
    res.json({ success: true, data: result });
  } catch (error) {
    console.error('[Courses] 切换科目失败:', error.message);
    res.status(500).json({ success: false, error: error.message });
  }
});

app.get('/api/homework', async (req, res) => {
  console.log('[Homework] Session ID:', req.sessionID);
  console.log('[Homework] Query params:', req.query);
  try {
    const { status, page = 1, pageSize = 20 } = req.query;
    const client = getClient(req.sessionID);
    const result = await client.listHomework({
      listType: status || 'all',  // 修复：改为 listType
      page: parseInt(page),
      size: parseInt(pageSize)  // 修复：改为 size
    });
    console.log('[Homework] 获取成功，作业数量:', result.items?.length || result.homeworkList?.length || 0);
    res.json({ 
      success: true, 
      data: {
        items: result.homeworkList || result.items || [],
        total: result.totalRecords || 0
      }
    });
  } catch (error) {
    console.error('[Homework] 错误:', error.message);
    res.status(500).json({ success: false, error: error.message });
  }
});

app.get('/api/tasks/:taskId', async (req, res) => {
  console.log('[Task] 获取作业详情:', req.params.taskId);
  try {
    const { taskId } = req.params;
    const client = getClient(req.sessionID);
    const result = await client.getTaskDetail(taskId);
    res.json({ success: true, data: result });
  } catch (error) {
    console.error('[Task] 获取作业详情失败:', error.message);
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
  console.log('[Messages] 获取联系人列表');
  try {
    const client = getClient(req.sessionID);
    const result = await client.listPrivateMessageContacts();
    console.log('[Messages] 联系人数量:', result.contacts?.length || 0);
    res.json({ success: true, data: result });
  } catch (error) {
    console.error('[Messages] 获取联系人失败:', error.message);
    res.status(500).json({ success: false, error: error.message });
  }
});

app.get('/api/notices', async (req, res) => {
  console.log('[Notices] 获取通知列表');
  try {
    const { page = 1, size = 20 } = req.query;
    const client = getClient(req.sessionID);
    const result = await client.listNotices({
      page: parseInt(page),
      size: parseInt(size)
    });
    console.log('[Notices] 通知数量:', result.notices?.length || 0);
    res.json({ success: true, data: result });
  } catch (error) {
    console.error('[Notices] 获取通知失败:', error.message);
    res.status(500).json({ success: false, error: error.message });
  }
});

app.post('/api/messages/thread', async (req, res) => {
  console.log('[Messages] 获取消息线程');
  try {
    const { contact, size, endTime } = req.body;
    console.log('[Messages] 联系人:', contact.peerName, '| 数量:', size);
    const client = getClient(req.sessionID);
    const result = await client.getPrivateMessageThread(contact, { size, endTime });
    console.log('[Messages] 消息数量:', result.messages?.length || 0);
    res.json({ success: true, data: result });
  } catch (error) {
    console.error('[Messages] 获取消息线程失败:', error.message);
    res.status(500).json({ success: false, error: error.message });
  }
});

app.post('/api/messages/send', async (req, res) => {
  console.log('[Messages] 发送消息');
  try {
    const { contact, content } = req.body;
    console.log('[Messages] 发送给:', contact.peerName, '| 内容长度:', content?.length || 0);
    const client = getClient(req.sessionID);
    const result = await client.sendPrivateMessageText(contact, content);
    console.log('[Messages] 发送成功');
    res.json({ success: true, data: result });
  } catch (error) {
    console.error('[Messages] 发送消息失败:', error.message);
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
  console.log('[Dashboard] Session ID:', req.sessionID);
  try {
    const client = getClient(req.sessionID);
    const session = await client.requireSession();
    
    console.log('[Dashboard] 开始获取仪表板数据...');
    
    // 并行获取所有仪表板数据
    const [homeworkResult, achievementResult, coursesResult] = await Promise.all([
      client.listHomework({ listType: 'pending', page: 1, size: 10 }).catch(err => {
        console.error('[Dashboard] 获取作业失败:', err.message);
        return null;
      }),
      client.getAchievementOverview().catch(err => {
        console.error('[Dashboard] 获取成绩失败:', err.message);
        return null;
      }),
      client.listCourses().catch(err => {
        console.error('[Dashboard] 获取课程失败:', err.message);
        return null;
      })
    ]);
    
    const summary = client.summarizeSession(session);
    console.log('[Dashboard] Session summary ready:', summary.ready);
    console.log('[Dashboard] 当前学期:', summary.currentTermId);
    console.log('[Dashboard] 可用学期:', summary.availableTerms?.map(t => `${t.name}(${t.id})`).join(', '));
    console.log('[Dashboard] 作业数量:', homeworkResult?.homeworkList?.length || homeworkResult?.items?.length || 0);
    console.log('[Dashboard] 课程数量:', coursesResult?.courses?.length || 0);
    
    res.json({
      success: true,
      data: {
        session: summary,
        pendingHomework: homeworkResult?.homeworkList || homeworkResult?.items || [],
        achievement: achievementResult,
        courses: coursesResult?.courses || []
      }
    });
  } catch (error) {
    console.error('[Dashboard] 错误:', error.message);
    console.error('[Dashboard] 堆栈:', error.stack);
    res.status(500).json({ success: false, error: error.message });
  }
});

app.get('/api/schedule', async (req, res) => {
  console.log('[Schedule] 获取课程表');
  try {
    const client = getClient(req.sessionID);
    const result = await client.getSchedule();
    console.log('[Schedule] 课程表获取成功');
    res.json({ success: true, data: result });
  } catch (error) {
    console.error('[Schedule] 获取课程表失败:', error.message);
    res.status(500).json({ success: false, error: error.message });
  }
});

app.get('/api/unread-count', async (req, res) => {
  console.log('[UnreadCount] 获取未读消息统计');
  try {
    const client = getClient(req.sessionID);
    const result = await client.getUndoMessageCount();
    console.log('[UnreadCount] 未读统计:', result);
    res.json({ success: true, data: result });
  } catch (error) {
    console.error('[UnreadCount] 获取未读统计失败:', error.message);
    res.status(500).json({ success: false, error: error.message });
  }
});

app.listen(PORT, () => {
  console.log(`🚀 BXB Student Web Server running at http://localhost:${PORT}`);
});
