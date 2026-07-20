import { sessionAPI, termsAPI, coursesAPI, homeworkAPI, achievementAPI, messagesAPI, workspaceAPI, dashboardAPI } from './api/client.js';
import { initLanguage, getLanguage, t } from './locales.js';

export class App {
  constructor() {
    // 初始化语言
    initLanguage();
    
    this.state = {
      session: null,
      currentPage: 'overview',
      dashboard: null,
      courses: [],
      homework: [],
      messages: [],
      messageThread: [],
      notices: [],
      schedule: {},
      timeSlots: {},
      files: [],
      selectedTask: null,
      selectedContact: null,
      selectedNotice: null,
      loading: false,
      language: getLanguage()
    };
    
    this.listeners = [];
  }

  subscribe(listener) {
    this.listeners.push(listener);
    return () => {
      this.listeners = this.listeners.filter(l => l !== listener);
    };
  }

  setState(updates) {
    this.state = { ...this.state, ...updates };
    this.listeners.forEach(listener => listener(this.state));
  }

  async checkSession() {
    const result = await sessionAPI.status();
    if (result.success) {
      console.log('[App] Session status:', result.data);
      this.setState({ session: result.data });
      // checkSession 只负责获取状态，不自动加载数据
    }
  }

  async init() {
    console.log('[App] 初始化应用...');
    await this.checkSession();
    const { session } = this.state;
    
    console.log('[App] 会话状态:', session?.ready);
    
    if (session && session.ready) {
      // 1. 先确保使用最新学期
      await this.ensureLatestTerm();
      // 2. 确保会话已更新
      await this.checkSession();
      // 3. 再加载仪表板数据
      await this.loadDashboard();
      console.log('[App] 应用初始化完成');
    }
  }

  async ensureLatestTerm() {
    const { session } = this.state;
    if (!session || !session.availableTerms || session.availableTerms.length === 0) return;
    
    console.log('[App] ===== 检查学期 =====');
    console.log('[App] 当前学期:', session.currentTermId);
    console.log('[App] 可用学期列表:', session.availableTerms.map((t, i) => `[${i}] ${t.name}(${t.id}, status=${t.status})`).join(', '));
    
    // 策略：取 availableTerms 中的第一个学期作为最新学期
    // （班学帮API通常按时间倒序返回）
    const targetTerm = session.availableTerms[0];
    
    if (targetTerm && session.currentTermId !== targetTerm.id) {
      console.log('[App] 需要切换学期，从', session.currentTermId, '切换到', targetTerm.id, '(' + targetTerm.name + ')');
      await this.setCurrentTerm(targetTerm.id);
    } else {
      console.log('[App] 学期已是最新，当前:', targetTerm?.name);
    }
  }

  async setCurrentTerm(termId) {
    if (!termId) return;
    
    console.log('[App] ===== 开始切换学期 =====');
    console.log('[App] 目标学期 ID:', termId);
    console.log('[App] 当前学期 ID:', this.state.session?.currentTermId);
    
    this.setState({ loading: true });
    try {
      const result = await termsAPI.set(termId);
      console.log('[App] API 返回结果:', result);
      
      if (result.success) {
        console.log('[App] API 返回的新学期:', result.data?.currentTermId);
        await this.checkSession();
        console.log('[App] checkSession 后的学期:', this.state.session?.currentTermId);
        await this.loadDashboard();
        console.log('[App] ===== 学期切换完成 =====');
      } else {
        console.error('[App] ===== 学期切换失败 =====');
        console.error('[App] 错误:', result.error);
      }
    } catch (error) {
      console.error('[App] ===== 学期切换异常 =====');
      console.error('[App] 异常:', error);
    } finally {
      this.setState({ loading: false });
    }
  }

  async login(username, password) {
    this.setState({ loading: true });
    try {
      const result = await sessionAPI.login(username, password);
      if (result.success) {
        await this.checkSession();
        return { success: true };
      }
      return { success: false, error: result.error };
    } catch (error) {
      return { success: false, error: error.message };
    } finally {
      this.setState({ loading: false });
    }
  }

  async logout() {
    await sessionAPI.clear();
    this.setState({ 
      session: null, 
      dashboard: null,
      currentPage: 'overview'
    });
  }

  async loadDashboard() {
    const result = await dashboardAPI.get();
    if (result.success) {
      console.log('[App] Dashboard loaded:', result.data);
      this.setState({ dashboard: result.data });
    }
  }

  async loadCourses() {
    const result = await coursesAPI.list();
    if (result.success) {
      this.setState({ courses: result.data.subjects || [] });
    }
  }

  async setCurrentCourse(subjectName) {
    const result = await coursesAPI.set(subjectName);
    if (result.success) {
      await this.checkSession();
      await this.loadDashboard();
      // 如果在作业页，刷新作业列表
      if (this.state.currentPage === 'homework') {
        await this.loadHomework();
      }
    }
  }

  async loadHomework(status = '', page = 1) {
    const result = await homeworkAPI.list(status, page, 20);
    if (result.success) {
      this.setState({ homework: result.data.items || [] });
    }
  }

  async loadTask(taskId) {
    console.log('[App] Loading task:', taskId);
    try {
      const result = await homeworkAPI.getTask(taskId);
      console.log('[App] Task result keys:', result.data ? Object.keys(result.data) : 'no data');
      
      if (result.success && result.data) {
        const d = result.data;
        // 把 getTaskDetail 返回的结构整理成页面需要的格式
        const selectedTask = {
          id: d.taskId,
          detail: {
            ...(d.task || {}),
            activityName: d.task?.activityName || d.taskSummary?.activityName || '',
            courseName:   d.task?.courseName   || d.taskSummary?.courseName   || '',
            createName:   d.task?.createName   || d.taskSummary?.createName   || '',
            releaseTime:  d.task?.releaseTime  || d.taskSummary?.releaseTime  || '',
            endTime:      d.task?.endTime      || d.taskSummary?.endTime      || '',
            scoreTypeName:d.task?.scoreTypeName|| d.taskSummary?.scoreTypeName|| '',
            // 内容优先用纯文本，fallback 到 activityContent
            description:  d.contentText || d.task?.activityContent || '',
          },
          attachments: d.attachments || [],
          mySubmission: (d.mySubmissionList && d.mySubmissionList.length > 0)
            ? { ...d.mySubmissionList[0], files: d.mySubmissionAttachments || [] }
            : null,
          lastScore: d.lastScore || null,
        };
        
        this.setState({ selectedTask, currentPage: 'homework' });
        console.log('[App] Task loaded:', selectedTask.detail.activityName);
      } else {
        alert('加载作业详情失败: ' + (result.error || '未知错误'));
      }
    } catch (error) {
      console.error('[App] Error loading task:', error);
      alert('加载作业详情失败: ' + error.message);
    }
  }

  async loadMessages() {
    console.log('[App] Loading messages...');
    try {
      const result = await messagesAPI.contacts();
      console.log('[App] Messages result:', result);
      
      if (result.success) {
        this.setState({ messages: result.data.contacts || [] });
        console.log('[App] Messages loaded:', result.data.contacts?.length || 0, 'contacts');
      } else {
        console.error('[App] Failed to load messages:', result.error);
        this.setState({ messages: [] });
      }
    } catch (error) {
      console.error('[App] Error loading messages:', error);
      this.setState({ messages: [] });
    }
  }

  async loadMessageThread(contact) {
    console.log('[App] Loading message thread for:', contact.peerName);
    try {
      const result = await messagesAPI.thread(contact, 50);
      console.log('[App] Thread result:', result);
      
      if (result.success) {
        this.setState({ 
          messageThread: result.data.messages || [],
          selectedContact: contact
        });
        console.log('[App] Thread loaded:', result.data.messages?.length || 0, 'messages');
      } else {
        console.error('[App] Failed to load thread:', result.error);
        this.setState({ messageThread: [] });
      }
    } catch (error) {
      console.error('[App] Error loading thread:', error);
      this.setState({ messageThread: [] });
    }
  }

  async sendMessage(contact, content) {
    console.log('[App] Sending message to:', contact.peerName);
    try {
      const result = await messagesAPI.send(contact, content);
      console.log('[App] Send result:', result);
      
      if (result.success) {
        // 重新加载消息线程
        await this.loadMessageThread(contact);
        console.log('[App] Message sent successfully');
      }
      return result;
    } catch (error) {
      console.error('[App] Error sending message:', error);
      return { success: false, error: error.message };
    }
  }

  async loadFiles(query = '') {
    const result = await workspaceAPI.listFiles(query);
    if (result.success) {
      this.setState({ files: result.data.files || [] });
    }
  }

  navigateTo(page) {
    this.setState({ 
      currentPage: page,
      selectedTask: null,
      selectedContact: null,
      selectedNotice: null,
      messageThread: []
    });
    
    // 加载页面数据
    switch(page) {
      case 'overview':
        this.loadDashboard();
        break;
      case 'homework':
        this.loadHomework();
        break;
      case 'messages':
        this.loadMessages();
        break;
      case 'schedule':
        this.loadSchedule();
        break;
      case 'notices':
        this.loadNotices();
        break;
      case 'files':
        this.loadFiles();
        break;
    }
  }

  // 切换语言
  async setLanguage(lang) {
    const { setLanguage: setLocaleLanguage } = await import('./locales.js');
    if (setLocaleLanguage(lang)) {
      this.setState({ language: lang });
      // 触发重新渲染
      this.listeners.forEach(listener => listener(this.state));
      return true;
    }
    return false;
  }

  async loadNotices() {
    console.log('[App] Loading notices...');
    
    try {
      // 从后端 API 获取真实的通知数据
      const response = await fetch('http://localhost:3000/api/notices', {
        credentials: 'include'
      });
      
      const result = await response.json();
      
      if (result.success && result.data.notices) {
        console.log('[App] 获取到通知数据:', result.data.notices.length, '条');
        
        const notices = result.data.notices.map(notice => ({
          id: notice.id || `notice-${Date.now()}-${Math.random()}`,
          type: this.guessNoticeType(notice),
          title: notice.title || '通知',
          content: notice.content || '',
          sender: notice.sender || '系统',
          time: notice.time || new Date().toISOString(),
          read: notice.read || false,
          raw: notice.raw
        }));
        
        this.setState({ notices });
        return;
      }
      
      console.log('[App] 通知列表为空');
      this.setState({ notices: [] });
      
    } catch (error) {
      console.error('[App] 获取通知失败:', error.message);
      this.setState({ notices: [] });
    }
  }

  async loadSchedule() {
    console.log('[App] Loading schedule...');
    
    try {
      const response = await fetch('http://localhost:3000/api/schedule', {
        credentials: 'include'
      });
      
      const result = await response.json();
      
      if (result.success && result.data) {
        console.log('[App] 获取到课程表数据');
        this.setState({ 
          schedule: result.data.schedule || {},
          timeSlots: result.data.timeSlots || {}
        });
        return;
      }
      
      console.log('[App] 课程表数据为空');
      this.setState({ schedule: {}, timeSlots: {} });
      
    } catch (error) {
      console.error('[App] 获取课程表失败:', error.message);
      this.setState({ schedule: {}, timeSlots: {} });
    }
  }

  viewNoticeDetail(noticeId) {
    const notice = this.state.notices.find(n => n.id === noticeId);
    if (notice) {
      this.setState({ selectedNotice: notice });
    }
  }

  backToNotices() {
    this.setState({ selectedNotice: null });
  }

  async downloadAttachment(taskId, fileId) {
    console.log('[App] Downloading attachment:', fileId, 'for task:', taskId);
    try {
      const result = await homeworkAPI.downloadAttachment(taskId, fileId, null);
      if (result.success) {
        const filePath = result.data?.path || result.data?.uri;
        if (filePath) {
          alert(`附件已下载到: ${filePath}`);
        } else {
          alert('附件下载成功');
        }
      } else {
        alert('下载失败: ' + (result.error || '未知错误'));
      }
    } catch (error) {
      alert('下载失败: ' + error.message);
    }
  }

  async submitTask(taskId) {
    const remark = document.getElementById('submitRemark')?.value || '';
    const filesInput = document.getElementById('submitFiles');
    const files = filesInput?.files;

    if (!remark && (!files || files.length === 0)) {
      alert('请填写作业内容或上传附件');
      return;
    }

    const btn = document.querySelector(`[data-action="submitTask"]`);
    if (btn) { btn.disabled = true; btn.textContent = '提交中...'; }

    try {
      const result = await homeworkAPI.submit(taskId, {
        remark,
        filePaths: [],
        isCorrectWork: 0
      });

      if (result.success) {
        alert('作业提交成功！');
        // 刷新任务详情
        await this.loadTask(taskId);
      } else {
        alert('提交失败: ' + (result.error || '未知错误'));
      }
    } catch (error) {
      alert('提交失败: ' + error.message);
    } finally {
      if (btn) { btn.disabled = false; btn.textContent = '提交作业'; }
    }
  }

  guessNoticeType(notice) {
    const title = (notice.title || '').toLowerCase();
    const content = (notice.content || '').toLowerCase();
    const combined = title + ' ' + content;
    
    if (combined.includes('作业') || combined.includes('提交') || combined.includes('截止')) {
      return 'homework';
    }
    if (combined.includes('课程') || combined.includes('上课') || combined.includes('调课')) {
      return 'course';
    }
    if (combined.includes('成绩') || combined.includes('分数') || combined.includes('评分')) {
      return 'grade';
    }
    if (combined.includes('紧急') || combined.includes('重要') || combined.includes('urgent')) {
      return 'urgent';
    }
    if (combined.includes('公告') || combined.includes('通知')) {
      return 'announcement';
    }
    
    return 'system';
  }
}
