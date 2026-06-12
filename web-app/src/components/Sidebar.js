export function Sidebar({ app, state }) {
  const { session, currentPage } = state;
  const user = session?.user || {};
  const currentSubject = session?.currentSubject || {};
  
  const menuItems = [
    { id: 'overview', icon: '📊', label: '工作台', badge: null },
    { id: 'homework', icon: '📝', label: '作业', badge: state.dashboard?.pendingHomework?.length || null },
    { id: 'schedule', icon: '📅', label: '课程', badge: null },
    { id: 'notices', icon: '🔔', label: '通知', badge: null },
    { id: 'messages', icon: '💬', label: '私信', badge: state.messages?.filter(m => m.unreadNum > 0).length || null },
    { id: 'files', icon: '📁', label: '文件', badge: null },
    { id: 'settings', icon: '⚙️', label: '设置', badge: null }
  ];

  return `
    <div class="sidebar">
      <!-- Logo 区域 -->
      <div class="sidebar-header">
        <div class="app-logo">🎓</div>
        <div class="app-info">
          <div class="app-name">班学帮 Student</div>
          <div class="app-subtitle">${session?.currentClass?.name || '未选择班级'}</div>
        </div>
      </div>

      <!-- 用户信息卡片 -->
      <div class="user-card">
        <div class="user-avatar">${user.name ? user.name[0] : 'B'}</div>
        <div class="user-info">
          <div class="user-name">${user.name || '未登录'}</div>
          <div class="user-subject">${currentSubject.name || '当前未选科目'}</div>
        </div>
      </div>

      <!-- 导航菜单 -->
      <div class="sidebar-nav">
        <div class="nav-label">导航</div>
        ${menuItems.map(item => `
          <div class="nav-item ${currentPage === item.id ? 'active' : ''}" 
               data-page="${item.id}">
            <span class="nav-icon">${item.icon}</span>
            <span class="nav-text">${item.label}</span>
            ${item.badge ? `<span class="nav-badge">${item.badge}</span>` : ''}
          </div>
        `).join('')}
      </div>

      <!-- 底部统计 -->
      <div class="sidebar-footer">
        <div class="risk-counter">
          <div class="risk-number">0</div>
          <div class="risk-label">风险作业</div>
          <div class="session-time">${formatSessionTime(session?.capturedAt)}</div>
        </div>
      </div>
    </div>
  `;
}

function formatSessionTime(timestamp) {
  if (!timestamp) return '未登录';
  const date = new Date(timestamp);
  const now = new Date();
  const diff = now - date;
  const minutes = Math.floor(diff / 60000);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);
  
  if (days > 0) return `${days}天前登录`;
  if (hours > 0) return `${hours}小时前登录`;
  if (minutes > 0) return `${minutes}分钟前登录`;
  return '刚刚登录';
}
