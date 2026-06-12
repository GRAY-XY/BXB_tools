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
    appEl.innerHTML = renderLoginPage();
    attachLoginHandlers();
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

function renderLoginPage() {
  return `
    <div class="login-container">
      <div class="login-box">
        <div class="login-logo">🎓</div>
        <h1 class="login-title">BXB Student</h1>
        <p class="login-subtitle">班学帮学生助手 Web 版</p>
        
        <form id="loginForm" class="login-form">
          <div class="form-group">
            <label for="username">账号</label>
            <input type="text" 
                   id="username" 
                   name="username" 
                   required 
                   placeholder="请输入账号"
                   autocomplete="username" />
          </div>
          
          <div class="form-group">
            <label for="password">密码</label>
            <input type="password" 
                   id="password" 
                   name="password" 
                   required 
                   placeholder="请输入密码"
                   autocomplete="current-password" />
          </div>
          
          <button type="submit" class="btn btn-primary btn-block">
            登录
          </button>
        </form>
        
        <div id="loginError" class="error-message" style="display:none;"></div>
        <div id="loginLoading" class="loading-message" style="display:none;">
          正在登录，请稍候...
        </div>
      </div>
    </div>
  `;
}

function attachLoginHandlers() {
  const form = document.getElementById('loginForm');
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    
    const username = document.getElementById('username').value;
    const password = document.getElementById('password').value;
    const errorEl = document.getElementById('loginError');
    const loadingEl = document.getElementById('loginLoading');
    
    errorEl.style.display = 'none';
    loadingEl.style.display = 'block';
    
    const result = await app.login(username, password);
    
    loadingEl.style.display = 'none';
    
    if (!result.success) {
      errorEl.textContent = result.error || '登录失败';
      errorEl.style.display = 'block';
    }
  });
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
        // TODO: 实现切换学期
      }
    });
  }
  
  const refreshBtn = document.getElementById('refreshBtn');
  if (refreshBtn) {
    refreshBtn.addEventListener('click', () => {
      app.loadDashboard();
    });
  }
  
  const logoutBtn = document.getElementById('logoutBtn');
  if (logoutBtn) {
    logoutBtn.addEventListener('click', () => {
      app.logout();
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
  
  // 作业筛选
  document.querySelectorAll('.filter-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      document.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
      e.target.classList.add('active');
      const status = e.target.dataset.status;
      app.loadHomework(status);
    });
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
    
    case 'selectCourse':
      const courseName = element.dataset.courseName;
      if (courseName) await app.setCurrentCourse(courseName);
      break;
    
    case 'downloadAttachment':
      // TODO: 实现附件下载
      alert('附件下载功能开发中...');
      break;
    
    case 'submitTask':
      // TODO: 实现作业提交
      alert('作业提交功能开发中...');
      break;
    
    case 'sendMessage':
      // TODO: 实现发送消息
      alert('发送消息功能开发中...');
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
  }
}

// 订阅状态变化
app.subscribe((state) => {
  renderApp(state);
});

// 初始化应用
app.init();
