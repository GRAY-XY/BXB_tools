import { t } from '../locales.js';

export function Sidebar({ app, state }) {
  const { session, currentPage, language } = state;
  const user = session?.user || {};
  const currentSubject = session?.currentSubject || {};
  
  const menuItems = [
    { id: 'overview', icon: '📊', label: t('sidebar.overview'), badge: null },
    { id: 'homework', icon: '📝', label: t('sidebar.homework'), badge: state.dashboard?.pendingHomework?.length || null },
    { id: 'schedule', icon: '📅', label: t('sidebar.schedule'), badge: null },
    { id: 'notices', icon: '🔔', label: t('sidebar.notices'), badge: null },
    { id: 'messages', icon: '💬', label: t('sidebar.messages'), badge: state.messages?.filter(m => m.unreadNum > 0).length || null },
    { id: 'files', icon: '📁', label: t('sidebar.files'), badge: null },
    { id: 'settings', icon: '⚙️', label: t('sidebar.settings'), badge: null }
  ];

  return `
    <div class="sidebar">
      <!-- Logo 区域 -->
      <div class="sidebar-header">
        <div class="app-logo">🎓</div>
        <div class="app-info">
          <div class="app-name">${t('app.name')}</div>
          <div class="app-subtitle">${session?.currentClass?.name || '未选择班级'}</div>
        </div>
      </div>

      <!-- 用户信息卡片 -->
      <div class="user-card">
        <div class="user-avatar">${user.name ? user.name[0] : 'B'}</div>
        <div class="user-info">
          <div class="user-name">${user.name || t('user.noLogin')}</div>
          <div class="user-subject">${currentSubject.name || t('user.noSubject')}</div>
        </div>
      </div>

      <!-- 导航菜单 -->
      <div class="sidebar-nav">
        <div class="nav-label">${t('sidebar.navigation')}</div>
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
          <div class="risk-label">${t('sidebar.riskHomework')}</div>
          <div class="session-time">${formatSessionTime(session?.capturedAt)}</div>
        </div>
      </div>
    </div>
  `;
}

function formatSessionTime(timestamp) {
  if (!timestamp) return t('time.notLoggedIn');
  const date = new Date(timestamp);
  const now = new Date();
  const diff = now - date;
  const minutes = Math.floor(diff / 60000);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);
  
  if (days > 0) return t('time.daysAgo', { days });
  if (hours > 0) return t('time.hoursAgo', { hours });
  if (minutes > 0) return t('time.minutesAgo', { minutes });
  return t('time.justNow');
}