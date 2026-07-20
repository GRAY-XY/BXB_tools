import './style.css';
import { App } from './app.js';
import { Sidebar } from './components/Sidebar.js';
import { Toolbar } from './components/Toolbar.js';
import { OverviewPage } from './pages/OverviewPage.js';
import { HomeworkPage } from './pages/HomeworkPage.js';
import { SchedulePage } from './pages/SchedulePage.js';
import { NoticesPage } from './pages/NoticesPage.js';
import { MessagesPage } from './pages/MessagesPage.js';
import { FilesPage } from './pages/FilesPage.js';
import { SettingsPage } from './pages/SettingsPage.js';
import { DirectLoginPage, initDirectLoginPage } from './pages/DirectLoginPage.js';

const app = new App();

// 页面映射
const pages = {
  overview: OverviewPage,
  homework: HomeworkPage,
  schedule: SchedulePage,
  notices: NoticesPage,
  messages: MessagesPage,
  files: FilesPage,
  settings: SettingsPage
};

// 渲染应用
function renderApp(state) {
  const appEl = document.getElementById('app');
  
  if (!state.session || !state.session.ready) {
    appEl.innerHTML = DirectLoginPage({ app, state });
    initDirectLoginPage(app);
    return;
  }

  const PageComponent = pages[state.currentPage];
  appEl.innerHTML = `
    <div class="app-container">
      ${Sidebar({ app, state })}
      <div class="main-area">
        ${state.currentPage === 'overview' ? '' : Toolbar({ app, state })}
        <div class="page-content">
          ${PageComponent ? PageComponent({ app, state }) : '<p>页面未找到</p>'}
        </div>
      </div>
    </div>
  `;
  
  attachEventHandlers();
}

function attachEventHandlers() {
  const state = app.state;
  
  // 侧边栏导航
  document.querySelectorAll('.nav-item').forEach(item => {
    item.addEventListener('click', () => {
      const page = item.dataset.page;
      app.navigateTo(page);
    });
  });
  
  // 工具栏控件
  const subjectSelect = document.getElementById('subjectSelect');
  if (subjectSelect) {
    subjectSelect.addEventListener('change', (e) => {
      if (e.target.value) {
        app.setCurrentCourse(e.target.value);
      }
    });
  }
  
  const termSelect = document.getElementById('termSelect');
  if (termSelect) {
    termSelect.addEventListener('change', async (e) => {
      if (e.target.value) {
        await app.setCurrentTerm(e.target.value);
      }
    });
  }
  
  // 主题选择器
  const themeSelect = document.getElementById('themeSelect');
  if (themeSelect) {
    themeSelect.addEventListener('change', (e) => {
      const theme = e.target.value;
      console.log(`Theme changed to: ${theme}`);
      // 这里可以添加主题切换逻辑
      // document.documentElement.setAttribute('data-theme', theme);
    });
  }
  
  // 字体大小选择器
  const fontSizeSelect = document.getElementById('fontSizeSelect');
  if (fontSizeSelect) {
    fontSizeSelect.addEventListener('change', (e) => {
      const fontSize = e.target.value;
      console.log(`Font size changed to: ${fontSize}`);
      // 这里可以添加字体大小切换逻辑
    });
  }
  
  // 自定义语言下拉菜单 - 移到单独函数 initLanguageDropdown()
  
  const refreshBtn = document.getElementById('refreshBtn');
  if (refreshBtn) {
    refreshBtn.addEventListener('click', () => {
      app.loadDashboard();
    });
  }
  
  const logoutBtn = document.getElementById('logoutBtn');
  if (logoutBtn) {
    logoutBtn.addEventListener('click', () => {
      if (confirm('确定要退出登录吗？')) {
        app.logout();
      }
    });
  }
  
  // 页面特定事件
  attachPageSpecificHandlers();
}

function attachPageSpecificHandlers() {
  const state = app.state;
  
  // 通用操作按钮
  document.querySelectorAll('[data-action]').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      const action = e.currentTarget.dataset.action;
      handleAction(action, e.currentTarget);
    });
  });
  
  // Tab 切换
  document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      const tab = e.target.dataset.tab;
      document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
      document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
      e.target.classList.add('active');
      const tabContent = document.getElementById(`${tab}Tab`);
      if (tabContent) tabContent.classList.add('active');
    });
  });
  
  // 使用事件委托处理作业筛选和通知筛选
  document.addEventListener('click', (e) => {
    const filterBtn = e.target.closest('.filter-btn');
    if (!filterBtn) return;
    
    // 更新激活状态
    const container = filterBtn.closest('.homework-filters, .notices-filters, .schedule-tabs');
    if (container) {
      container.querySelectorAll('.filter-btn, .tab-btn').forEach(b => b.classList.remove('active'));
      filterBtn.classList.add('active');
    }
    
    // 作业筛选
    const status = filterBtn.dataset.status;
    if (status !== undefined) {
      console.log('[Filter] 切换作业状态:', status);
      app.loadHomework(status);
      return;
    }
    
    // 通知筛选
    const filter = filterBtn.dataset.filter;
    if (filter) {
      filterNotices(filter);
      return;
    }
  });
  
  // 作业卡片点击
  document.querySelectorAll('.homework-card, .homework-preview-item').forEach(card => {
    card.addEventListener('click', (e) => {
      if (!e.target.closest('button')) {
        const taskId = card.dataset.taskId;
        if (taskId) {
          app.loadTask(taskId);
        }
      }
    });
  });
  
  // 课程卡片点击
  document.querySelectorAll('.course-card, .course-card-large').forEach(card => {
    card.addEventListener('click', (e) => {
      if (!e.target.closest('button')) {
        const courseName = card.dataset.courseName;
        if (courseName) {
          app.setCurrentCourse(courseName);
        }
      }
    });
  });
  
  // 私信联系人点击
  document.querySelectorAll('.message-contact-card').forEach(card => {
    card.addEventListener('click', () => {
      const contactId = card.dataset.contactId;
      const contact = state.messages.find(m => m.id === contactId);
      if (contact) {
        app.setState({ selectedContact: contact });
        app.loadMessageThread(contact);
      }
    });
  });
  
  // 发送消息 - 支持 Ctrl/Cmd+Enter
  const messageInput = document.getElementById('messageInput');
  if (messageInput) {
    messageInput.addEventListener('keydown', (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
        e.preventDefault();
        const sendBtn = document.getElementById('sendMessageBtn');
        if (sendBtn) sendBtn.click();
      }
    });
  }
  
  // 通知筛选逻辑
  function filterNotices(filter) {
    const notices = state.notices || [];
    const noticeCards = document.querySelectorAll('.notice-card');
    
    noticeCards.forEach(card => {
      const noticeId = card.dataset.noticeId;
      const notice = notices.find(n => n.id === noticeId);
      
      if (!notice) {
        card.style.display = 'none';
        return;
      }
      
      let shouldShow = false;
      switch (filter) {
        case 'all':
          shouldShow = true;
          break;
        case 'unread':
          shouldShow = !notice.read;
          break;
        case 'system':
          shouldShow = notice.type === 'system' || notice.type === 'announcement';
          break;
        case 'course':
          shouldShow = notice.type === 'course' || notice.type === 'homework' || notice.type === 'grade';
          break;
        default:
          shouldShow = true;
      }
      
      card.style.display = shouldShow ? 'flex' : 'none';
    });
  }
}

async function handleAction(action, element) {
  switch (action) {
    case 'viewAllHomework':
    case 'gotoHomework':
      app.navigateTo('homework');
      break;
    
    case 'gotoSchedule':
      app.navigateTo('schedule');
      break;
    
    case 'gotoMessages':
      app.navigateTo('messages');
      break;
    
    case 'gotoFiles':
      app.navigateTo('files');
      break;
    
    case 'viewTask':
      const taskId = element.dataset.taskId;
      if (taskId) await app.loadTask(taskId);
      break;
    
    case 'backToHomework':
      app.setState({ selectedTask: null });
      break;
    
    case 'backToMessages':
      app.setState({ selectedContact: null, messageThread: null });
      break;

    case 'backToNotices':
      app.backToNotices();
      break;
    
    case 'selectCourse':
      const courseName = element.dataset.courseName;
      if (courseName) await app.setCurrentCourse(courseName);
      break;
    
    case 'downloadAttachment': {
      const dlTaskId = element.dataset.taskId;
      const dlFileId = element.dataset.fileId;
      if (dlTaskId && dlFileId) await app.downloadAttachment(dlTaskId, dlFileId);
      break;
    }
    
    case 'submitTask': {
      const stTaskId = element.dataset.taskId;
      if (stTaskId) await app.submitTask(stTaskId);
      break;
    }
    
    case 'sendMessage':
      await handleSendMessage();
      break;
    
    case 'markAsRead':
      await handleMarkNoticeAsRead(element.dataset.noticeId);
      break;
    
    case 'viewNoticeDetail':
    case 'viewDetail':
      app.viewNoticeDetail(element.dataset.noticeId);
      break;
    
    case 'searchFiles':
      const query = document.getElementById('fileSearch')?.value || '';
      await app.loadFiles(query);
      break;
    
    case 'uploadFile':
      alert('文件上传功能开发中...');
      break;
    
    case 'clearCache':
      if (confirm('确定要清除缓存吗？')) {
        alert('缓存清除功能开发中...');
      }
      break;
    
    case 'exportData':
      alert('数据导出功能开发中...');
      break;
    
    case 'logout':
      await app.logout();
      break;
    
    case 'switchLang': {
      const lang = element.dataset.lang;
      if (lang) await app.setLanguage(lang);
      break;
    }

    // Note: Language switching is now handled by lang-switcher buttons
  }
}

async function handleSendMessage() {
  const messageInput = document.getElementById('messageInput');
  const sendBtn = document.getElementById('sendMessageBtn');
  
  if (!messageInput || !sendBtn) return;
  
  const content = messageInput.value.trim();
  if (!content) {
    alert('请输入消息内容');
    return;
  }
  
  const { selectedContact } = app.state;
  if (!selectedContact) {
    alert('未选择联系人');
    return;
  }
  
  // 禁用输入和按钮
  messageInput.disabled = true;
  sendBtn.disabled = true;
  sendBtn.textContent = '📤 发送中...';
  
  try {
    const result = await app.sendMessage(selectedContact, content);
    
    if (result.success) {
      // 清空输入框
      messageInput.value = '';
      
      // 滚动到底部
      const messagesList = document.getElementById('messagesList');
      if (messagesList) {
        setTimeout(() => {
          messagesList.scrollTop = messagesList.scrollHeight;
        }, 100);
      }
    } else {
      alert('发送失败: ' + (result.error || '未知错误'));
    }
  } catch (error) {
    console.error('[SendMessage] Error:', error);
    alert('发送消息时出错: ' + error.message);
  } finally {
    // 恢复输入和按钮
    messageInput.disabled = false;
    sendBtn.disabled = false;
    sendBtn.textContent = '📤 发送';
    messageInput.focus();
  }
}

async function handleMarkNoticeAsRead(noticeId) {
  if (!noticeId) return;
  
  // 更新 UI
  const noticeCard = document.querySelector(`.notice-card[data-notice-id="${noticeId}"]`);
  if (noticeCard) {
    noticeCard.classList.remove('unread');
    const badge = noticeCard.querySelector('.notice-badge.unread');
    if (badge) badge.remove();
    const markBtn = noticeCard.querySelector('[data-action="markAsRead"]');
    if (markBtn) markBtn.remove();
  }
  
  // 更新状态
  const notices = app.state.notices || [];
  const notice = notices.find(n => n.id === noticeId);
  if (notice) {
    notice.read = true;
    app.setState({ notices });
  }
  
  // TODO: 调用后端 API 标记已读（如果有的话）
  console.log('[MarkAsRead] Notice:', noticeId);
}

// 订阅状态变化
app.subscribe((state) => {
  // 更新 HTML lang 属性
  const htmlEl = document.documentElement;
  const currentLang = state.language || 'zh-CN';
  if (htmlEl.getAttribute('lang') !== currentLang) {
    htmlEl.setAttribute('lang', currentLang);
  }
  
  // 更新页面标题
  const titleMap = {
    'zh-CN': 'BXB Student - 班学帮学生助手',
    'en': 'BXB Student - Banxuebang Student Assistant'
  };
  const pageTitle = titleMap[currentLang] || titleMap['zh-CN'];
  if (document.title !== pageTitle) {
    document.title = pageTitle;
  }
  
  renderApp(state);
});

// 初始化应用
app.init();
// force reload
