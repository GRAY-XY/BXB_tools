export function NoticesPage({ app, state }) {
  return `
    <div class="page-container">
      <div class="page-header">
        <h1 class="page-title">通知</h1>
        <p class="page-subtitle">最近公告和未读提醒都在这里。</p>
      </div>

      <div class="notices-filters">
        <button class="filter-btn active" data-filter="all">全部</button>
        <button class="filter-btn" data-filter="unread">未读</button>
        <button class="filter-btn" data-filter="system">系统通知</button>
        <button class="filter-btn" data-filter="course">课程通知</button>
      </div>

      <div class="notices-list">
        <div class="empty-state-large">
          <div class="empty-icon">🔔</div>
          <h3>暂无通知</h3>
          <p>通知功能开发中...</p>
        </div>
      </div>
    </div>
  `;
}
