export function NoticesPage({ app, state }) {
  const { dashboard, session, selectedNotice } = state;
  
  // 如果选中了通知，显示详情
  if (selectedNotice) {
    return renderNoticeDetail(selectedNotice, app);
  }
  
  // 通知列表视图
  const notices = state.notices || [];
  const unreadCount = notices.filter(n => !n.read).length;

  return `
    <div class="page-container">
      <div class="page-header">
        <h1 class="page-title">🔔 通知</h1>
        <p class="page-subtitle">系统通知、课程公告和重要提醒 ${unreadCount > 0 ? `(${unreadCount} 条未读)` : ''}</p>
      </div>

      <div class="notices-filters">
        <button class="filter-btn active" data-filter="all">全部 (${notices.length})</button>
        <button class="filter-btn" data-filter="unread">未读 (${unreadCount})</button>
        <button class="filter-btn" data-filter="system">系统通知</button>
        <button class="filter-btn" data-filter="course">课程通知</button>
      </div>

      <div class="notices-list" id="noticesList">
        ${notices.length === 0 ? `
          <div class="empty-state-large">
            <div class="empty-icon">🔔</div>
            <h3>暂无通知</h3>
            <p>当前没有新通知</p>
            <button class="btn btn-primary btn-sm" onclick="window.location.reload()">
              🔄 刷新通知
            </button>
          </div>
        ` : notices.map(notice => `
          <div class="notice-card ${!notice.read ? 'unread' : ''}" data-notice-id="${notice.id}">
            <div class="notice-icon ${notice.type || 'default'}">
              ${getNoticeIcon(notice.type)}
            </div>
            <div class="notice-content">
              <div class="notice-header">
                <h3 class="notice-title">${notice.title}</h3>
                ${!notice.read ? '<span class="notice-badge unread">未读</span>' : ''}
              </div>
              <div class="notice-meta">
                <span class="notice-sender">👤 ${notice.sender || '系统'}</span>
                <span class="notice-time">🕐 ${formatNoticeTime(notice.time)}</span>
                ${notice.courseName ? `<span class="notice-course">📚 ${notice.courseName}</span>` : ''}
              </div>
              <div class="notice-body">
                ${formatNoticeContent(notice.content, 200)}
              </div>
              <div class="notice-actions">
                <button class="btn btn-sm btn-primary" data-action="viewNoticeDetail" data-notice-id="${notice.id}">
                  查看完整内容 →
                </button>
                ${!notice.read ? `
                  <button class="btn btn-sm btn-secondary" data-action="markAsRead" data-notice-id="${notice.id}">
                    ✓ 标记已读
                  </button>
                ` : ''}
              </div>
            </div>
          </div>
        `).join('')}
      </div>

      <div class="notices-hint">
        <p class="text-muted">
          💡 提示：通知数据来自班学帮系统。如果暂无通知，请检查班学帮网站或稍后再试。
        </p>
      </div>
    </div>
  `;
}

function renderNoticeDetail(notice, app) {
  return `
    <div class="page-container">
      <div class="page-header">
        <button class="btn-back" data-action="backToNotices">
          ← 返回通知列表
        </button>
        <h1 class="page-title">${getNoticeIcon(notice.type)} ${notice.title || '通知详情'}</h1>
      </div>

      <div class="notice-detail-container">
        <div class="notice-detail-card">
          <div class="notice-detail-header">
            <div class="notice-detail-meta">
              <div class="meta-item">
                <span class="meta-label">发送者:</span>
                <span class="meta-value">${notice.sender || '系统'}</span>
              </div>
              <div class="meta-item">
                <span class="meta-label">时间:</span>
                <span class="meta-value">${formatFullDateTime(notice.time)}</span>
              </div>
              ${notice.courseName ? `
                <div class="meta-item">
                  <span class="meta-label">课程:</span>
                  <span class="meta-value">${notice.courseName}</span>
                </div>
              ` : ''}
              <div class="meta-item">
                <span class="meta-label">类型:</span>
                <span class="meta-value">${getNoticeTypeName(notice.type)}</span>
              </div>
            </div>
          </div>

          <div class="notice-detail-content">
            <h2 class="content-title">${notice.title}</h2>
            <div class="content-body">
              ${formatNoticeContent(notice.content, null)}
            </div>
          </div>

          <div class="notice-detail-actions">
            ${!notice.read ? `
              <button class="btn btn-secondary" data-action="markAsRead" data-notice-id="${notice.id}">
                ✓ 标记已读
              </button>
            ` : ''}
            <button class="btn btn-primary" data-action="backToNotices">
              返回列表
            </button>
          </div>
        </div>
      </div>
    </div>
  `;
}

function getNoticeTypeName(type) {
  const types = {
    'system': '系统通知',
    'course': '课程通知',
    'homework': '作业通知',
    'grade': '成绩通知',
    'announcement': '公告',
    'urgent': '紧急通知'
  };
  return types[type] || '通知';
}

function formatFullDateTime(timeStr) {
  if (!timeStr) return '未知时间';
  const date = new Date(timeStr);
  return date.toLocaleString('zh-CN', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit'
  });
}

function getNoticeIcon(type) {
  const icons = {
    'system': '⚙️',
    'course': '📚',
    'homework': '📝',
    'grade': '📊',
    'announcement': '📢',
    'urgent': '⚠️',
    'default': '🔔'
  };
  return icons[type] || icons.default;
}

function formatNoticeTime(timeStr) {
  if (!timeStr) return '未知时间';
  const date = new Date(timeStr);
  const now = new Date();
  const diff = now - date;
  const days = Math.floor(diff / (1000 * 60 * 60 * 24));
  
  if (days === 0) {
    const hours = Math.floor(diff / (1000 * 60 * 60));
    if (hours === 0) {
      const minutes = Math.floor(diff / (1000 * 60));
      return minutes < 1 ? '刚刚' : `${minutes}分钟前`;
    }
    return `${hours}小时前`;
  } else if (days === 1) {
    return '昨天 ' + date.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });
  } else if (days < 7) {
    return `${days}天前`;
  }
  return date.toLocaleDateString('zh-CN', { year: 'numeric', month: 'long', day: 'numeric' });
}

function formatNoticeContent(content, maxLength = null) {
  if (!content) return '';
  // 清理和格式化内容
  const sanitized = content
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/\n/g, '<br>');
  
  // 如果指定了最大长度，进行截断
  if (maxLength && sanitized.length > maxLength) {
    return sanitized.substring(0, maxLength) + '... <span class="text-muted">(点击查看完整内容)</span>';
  }
  return sanitized;
}
