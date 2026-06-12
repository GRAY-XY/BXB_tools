import './style.css';

const API_BASE = 'http://localhost:3000/api';

// API 调用函数
async function api(endpoint, options = {}) {
  const response = await fetch(`${API_BASE}${endpoint}`, {
    ...options,
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json',
      ...options.headers
    }
  });
  return response.json();
}

// 状态管理
let state = {
  session: null,
  courses: [],
  homework: [],
  currentTask: null
};

// UI 渲染函数
function renderApp() {
  const app = document.getElementById('app');
  
  if (!state.session || !state.session.ready) {
    app.innerHTML = renderLoginPage();
    attachLoginHandlers();
  } else {
    app.innerHTML = renderDashboard();
    attachDashboardHandlers();
  }
}

function renderLoginPage() {
  return `
    <div class="login-container">
      <div class="login-box">
        <h1>🎓 BXB Student</h1>
        <p class="subtitle">班学帮学生助手 Web 版</p>
        <form id="loginForm">
          <div class="form-group">
            <label for="username">账号</label>
            <input type="text" id="username" name="username" required placeholder="请输入账号" />
          </div>
          <div class="form-group">
            <label for="password">密码</label>
            <input type="password" id="password" name="password" required placeholder="请输入密码" />
          </div>
          <button type="submit" class="btn btn-primary">登录</button>
        </form>
        <div id="loginError" class="error-message"></div>
        <div id="loginLoading" class="loading-message" style="display:none;">正在登录，请稍候...</div>
      </div>
    </div>
  `;
}

function renderDashboard() {
  const user = state.session.user || {};
  const currentSubject = state.session.currentSubject || {};
  
  return `
    <div class="dashboard">
      <header class="header">
        <h1>🎓 BXB Student</h1>
        <div class="user-info">
          <span>欢迎，${user.name || user.loginName || '学生'}</span>
          <button id="logoutBtn" class="btn btn-sm">退出</button>
        </div>
      </header>
      
      <div class="container">
        <div class="sidebar">
          <div class="section">
            <h3>当前课程</h3>
            <div class="current-subject">
              ${currentSubject.name || '未选择课程'}
            </div>
          </div>
          
          <div class="section">
            <h3>课程列表</h3>
            <button id="loadCoursesBtn" class="btn btn-sm btn-block">刷新课程</button>
            <div id="coursesList" class="courses-list">
              ${renderCoursesList()}
            </div>
          </div>
        </div>
        
        <div class="main-content">
          <div class="tabs">
            <button class="tab-btn active" data-tab="homework">作业列表</button>
            <button class="tab-btn" data-tab="achievement">成绩概览</button>
          </div>
          
          <div id="homeworkTab" class="tab-content active">
            <div class="homework-filters">
              <button class="filter-btn active" data-status="all">全部</button>
              <button class="filter-btn" data-status="pending">待提交</button>
              <button class="filter-btn" data-status="submitted">已提交</button>
            </div>
            <button id="loadHomeworkBtn" class="btn btn-sm">刷新作业</button>
            <div id="homeworkList" class="homework-list">
              ${renderHomeworkList()}
            </div>
          </div>
          
          <div id="achievementTab" class="tab-content">
            <button id="loadAchievementBtn" class="btn btn-sm">加载成绩</button>
            <div id="achievementContent"></div>
          </div>
        </div>
      </div>
    </div>
  `;
}

function renderCoursesList() {
  if (!state.courses.length) {
    return '<p class="empty-message">暂无课程</p>';
  }
  
  return state.courses.map(course => `
    <div class="course-item" data-course-id="${course.id}">
      <div class="course-name">${course.name}</div>
      ${course.unSubmitCount ? `<span class="badge">${course.unSubmitCount}</span>` : ''}
    </div>
  `).join('');
}

function renderHomeworkList() {
  if (!state.homework.length) {
    return '<p class="empty-message">暂无作业</p>';
  }
  
  return state.homework.map(hw => `
    <div class="homework-item" data-task-id="${hw.id}">
      <div class="homework-header">
        <h4>${hw.activityName}</h4>
        <span class="badge ${hw.scoreTypeColor || 'gray'}">${hw.scoreTypeName || '未评分'}</span>
      </div>
      <div class="homework-meta">
        <span>课程：${hw.courseName || '未知'}</span>
        <span>截止：${hw.endTime || '无截止日期'}</span>
      </div>
      <div class="homework-countdown">
        ${hw.isEnd ? '已截止' : `剩余 ${hw.days}天 ${hw.hours}小时`}
      </div>
    </div>
  `).join('');
}

// 事件处理
function attachLoginHandlers() {
  const form = document.getElementById('loginForm');
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    
    const username = document.getElementById('username').value;
    const password = document.getElementById('password').value;
    const errorEl = document.getElementById('loginError');
    const loadingEl = document.getElementById('loginLoading');
    
    errorEl.textContent = '';
    errorEl.style.display = 'none';
    loadingEl.style.display = 'block';
    
    try {
      const result = await api('/session/login', {
        method: 'POST',
        body: JSON.stringify({ username, password })
      });
      
      if (result.success) {
        await checkSession();
        renderApp();
      } else {
        errorEl.textContent = result.error || '登录失败';
        errorEl.style.display = 'block';
      }
    } catch (error) {
      errorEl.textContent = `登录错误：${error.message}`;
      errorEl.style.display = 'block';
    } finally {
      loadingEl.style.display = 'none';
    }
  });
}

function attachDashboardHandlers() {
  // 退出登录
  document.getElementById('logoutBtn')?.addEventListener('click', async () => {
    await api('/session/clear', { method: 'POST' });
    state.session = null;
    renderApp();
  });
  
  // 加载课程
  document.getElementById('loadCoursesBtn')?.addEventListener('click', async () => {
    const result = await api('/courses');
    if (result.success) {
      state.courses = result.data.subjects || [];
      document.getElementById('coursesList').innerHTML = renderCoursesList();
      attachCourseHandlers();
    }
  });
  
  // 加载作业
  document.getElementById('loadHomeworkBtn')?.addEventListener('click', loadHomework);
  
  // Tab 切换
  document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      const tab = e.target.dataset.tab;
      document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
      document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
      e.target.classList.add('active');
      document.getElementById(`${tab}Tab`).classList.add('active');
    });
  });
  
  // 作业筛选
  document.querySelectorAll('.filter-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      document.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
      e.target.classList.add('active');
      const status = e.target.dataset.status;
      loadHomework(status === 'all' ? '' : status);
    });
  });
  
  // 加载成绩
  document.getElementById('loadAchievementBtn')?.addEventListener('click', async () => {
    const result = await api('/achievement');
    if (result.success) {
      document.getElementById('achievementContent').innerHTML = `
        <pre>${JSON.stringify(result.data, null, 2)}</pre>
      `;
    }
  });
  
  attachCourseHandlers();
}

function attachCourseHandlers() {
  document.querySelectorAll('.course-item').forEach(item => {
    item.addEventListener('click', async () => {
      const courseName = item.querySelector('.course-name').textContent;
      const result = await api('/courses/set', {
        method: 'POST',
        body: JSON.stringify({ subjectName: courseName })
      });
      if (result.success) {
        await checkSession();
        renderApp();
      }
    });
  });
}

async function loadHomework(status = '') {
  const result = await api(`/homework?status=${status}`);
  if (result.success) {
    state.homework = result.data.items || [];
    document.getElementById('homeworkList').innerHTML = renderHomeworkList();
  }
}

async function checkSession() {
  const result = await api('/session/status');
  if (result.success) {
    state.session = result.data;
  }
}

// 初始化
async function init() {
  await checkSession();
  renderApp();
}

init();
