export function OverviewPage({ app, state }) {
  const { dashboard, session } = state;
  
  // 从 dashboard.session 获取完整数据
  const sessionData = dashboard?.session || session || {};
  const user = sessionData?.user || {};
  const currentTerm = sessionData?.availableTerms?.find(t => t.id === sessionData?.currentTermId);
  const currentSubject = sessionData?.currentSubject;
  
  const pendingHomework = dashboard?.pendingHomework || [];
  const achievement = dashboard?.achievement;
  const courses = dashboard?.courses || sessionData?.availableSubjects || [];

  return `
    <div class="page-container">
      <div class="page-header">
        <h1 class="page-title">📊 工作台</h1>
        <p class="page-subtitle">欢迎回来，${user.name || '同学'}！当前学期：${currentTerm?.name || '未知'}</p>
      </div>

      <div class="overview-grid">
        <!-- 待办作业卡片 -->
        <div class="overview-card">
          <div class="card-header">
            <h3 class="card-title">📝 待办作业</h3>
            <span class="card-badge">${pendingHomework.length}</span>
          </div>
          <div class="card-content">
            ${pendingHomework.length === 0 ? `
              <div class="empty-state">
                <div class="empty-icon">✨</div>
                <p>暂无待办作业</p>
              </div>
            ` : `
              <div class="homework-preview-list">
                ${pendingHomework.slice(0, 5).map(hw => `
                  <div class="homework-preview-item" data-task-id="${hw.id}">
                    <div class="homework-preview-header">
                      <span class="homework-preview-course">${hw.courseName || '未知课程'}</span>
                      <span class="homework-preview-time">${formatDeadline(hw.endTime)}</span>
                    </div>
                    <div class="homework-preview-title">${hw.activityName}</div>
                    ${hw.days !== null && hw.hours !== null ? `
                      <div class="homework-preview-countdown ${getUrgencyClass(hw.days, hw.hours)}">
                        ⏰ ${hw.isEnd ? '已截止' : `剩余 ${hw.days}天 ${hw.hours}小时`}
                      </div>
                    ` : ''}
                  </div>
                `).join('')}
              </div>
              ${pendingHomework.length > 5 ? `
                <button class="card-action-btn" data-action="viewAllHomework">
                  查看全部 ${pendingHomework.length} 个作业 →
                </button>
              ` : ''}
            `}
          </div>
        </div>

        <!-- 成绩概览卡片 -->
        <div class="overview-card">
          <div class="card-header">
            <h3 class="card-title">📈 成绩概览</h3>
          </div>
          <div class="card-content">
            ${achievement && achievement.gpa ? `
              <div class="achievement-summary">
                <div class="gpa-display">
                  <div class="gpa-value">${achievement.gpa.averageLevel || 'N/A'}</div>
                  <div class="gpa-label">平均等级</div>
                </div>
                ${achievement.gpa.gpa ? `
                  <div class="gpa-details">
                    <div class="gpa-detail-item">
                      <span class="gpa-detail-label">GPA:</span>
                      <span class="gpa-detail-value">${achievement.gpa.gpa}</span>
                    </div>
                    ${achievement.gpa.averageScore ? `
                      <div class="gpa-detail-item">
                        <span class="gpa-detail-label">平均分:</span>
                        <span class="gpa-detail-value">${achievement.gpa.averageScore}</span>
                      </div>
                    ` : ''}
                  </div>
                ` : ''}
              </div>
            ` : `
              <div class="empty-state">
                <div class="empty-icon">📊</div>
                <p>暂无成绩数据</p>
              </div>
            `}
          </div>
        </div>

        <!-- 课程列表卡片 -->
        <div class="overview-card full-width">
          <div class="card-header">
            <h3 class="card-title">📚 我的课程</h3>
            <span class="card-badge">${courses.length}</span>
          </div>
          <div class="card-content">
            ${courses.length === 0 ? `
              <div class="empty-state">
                <div class="empty-icon">📖</div>
                <p>暂无课程数据</p>
              </div>
            ` : `
              <div class="course-grid">
                ${courses.map(course => `
                  <div class="course-card" data-course-name="${course.name || course.cnName}">
                    <div class="course-color" style="background-color: ${course.color || '#667eea'}"></div>
                    <div class="course-info">
                      <div class="course-name">${course.name || course.cnName || '未命名课程'}</div>
                      ${course.teacherList && course.teacherList.length > 0 ? `
                        <div class="course-teacher">
                          👤 ${course.teacherList.map(t => t.userName || t.name || t.realName).join(', ')}
                        </div>
                      ` : ''}
                      ${course.unSubmitCount ? `
                        <div class="course-badge">
                          ${course.unSubmitCount} 个待提交
                        </div>
                      ` : ''}
                    </div>
                  </div>
                `).join('')}
              </div>
            `}
          </div>
        </div>

        <!-- 学期信息卡片 -->
        <div class="overview-card">
          <div class="card-header">
            <h3 class="card-title">📅 学期信息</h3>
          </div>
          <div class="card-content">
            <div class="status-list">
              <div class="status-item">
                <span class="status-label">当前学期:</span>
                <span class="status-value ${currentTerm ? 'success' : ''}">${currentTerm?.name || '未知'}</span>
              </div>
              <div class="status-item">
                <span class="status-label">当前科目:</span>
                <span class="status-value">${currentSubject?.name || '未选择'}</span>
              </div>
              <div class="status-item">
                <span class="status-label">班级:</span>
                <span class="status-value">${sessionData?.currentClass?.name || '未知'}</span>
              </div>
              <div class="status-item">
                <span class="status-label">学号:</span>
                <span class="status-value">${user.loginName || '未知'}</span>
              </div>
            </div>
          </div>
        </div>

        <!-- 快速操作卡片 -->
        <div class="overview-card">
          <div class="card-header">
            <h3 class="card-title">⚡ 快速操作</h3>
          </div>
          <div class="card-content">
            <div class="quick-actions">
              <button class="quick-action-btn" data-action="gotoHomework">
                <span class="quick-action-icon">📝</span>
                <span class="quick-action-label">查看作业</span>
              </button>
              <button class="quick-action-btn" data-action="gotoSchedule">
                <span class="quick-action-icon">📅</span>
                <span class="quick-action-label">课程表</span>
              </button>
              <button class="quick-action-btn" data-action="gotoMessages">
                <span class="quick-action-icon">💬</span>
                <span class="quick-action-label">私信</span>
              </button>
              <button class="quick-action-btn" data-action="gotoFiles">
                <span class="quick-action-icon">📁</span>
                <span class="quick-action-label">文件</span>
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  `;
}

function formatDeadline(endTime) {
  if (!endTime) return '无截止日期';
  const date = new Date(endTime);
  const now = new Date();
  const diff = date - now;
  const days = Math.floor(diff / (1000 * 60 * 60 * 24));
  const hours = Math.floor((diff % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
  
  if (diff < 0) return '已截止';
  if (days === 0 && hours < 24) return `今天 ${date.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}`;
  return date.toLocaleDateString('zh-CN', { month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

function getUrgencyClass(days, hours) {
  const daysNum = parseInt(days) || 0;
  const hoursNum = parseInt(hours) || 0;
  const totalHours = daysNum * 24 + hoursNum;
  
  if (totalHours === 0) return 'urgent';
  if (totalHours < 24) return 'urgent';
  if (totalHours < 48) return 'warning';
  return 'normal';
}
