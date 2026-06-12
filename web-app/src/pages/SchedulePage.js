export function SchedulePage({ app, state }) {
  const { courses, session } = state;
  const subjects = session?.availableSubjects || [];

  return `
    <div class="page-container">
      <div class="page-header">
        <h1 class="page-title">课程</h1>
        <p class="page-subtitle">今天课程、科目列表和整周课表都集中在这里。</p>
      </div>

      <div class="schedule-tabs">
        <button class="tab-btn active" data-tab="courses">课程列表</button>
        <button class="tab-btn" data-tab="today">今日课程</button>
        <button class="tab-btn" data-tab="week">周课表</button>
      </div>

      <div id="coursesTab" class="tab-content active">
        <div class="courses-grid-large">
          ${subjects.length === 0 ? `
            <div class="empty-state-large">
              <div class="empty-icon">📚</div>
              <h3>暂无课程</h3>
              <p>当前学期没有课程信息</p>
            </div>
          ` : subjects.map(subject => `
            <div class="course-card-large" data-course-name="${subject.name}">
              <div class="course-card-color" style="background: ${subject.color || '#667eea'}"></div>
              <div class="course-card-content">
                <h3 class="course-card-name">${subject.name}</h3>
                <div class="course-card-meta">
                  <div class="course-card-id">ID: ${subject.id}</div>
                  ${subject.unSubmitCount ? `
                    <div class="course-card-badge pending">
                      ${subject.unSubmitCount} 个待提交
                    </div>
                  ` : `
                    <div class="course-card-badge completed">
                      ✓ 已完成
                    </div>
                  `}
                </div>
                <button class="btn btn-sm btn-block" 
                        data-action="selectCourse" 
                        data-course-name="${subject.name}">
                  选择课程
                </button>
              </div>
            </div>
          `).join('')}
        </div>
      </div>

      <div id="todayTab" class="tab-content">
        <div class="today-schedule">
          <div class="empty-state-large">
            <div class="empty-icon">📅</div>
            <h3>今日课程</h3>
            <p>课程表功能开发中...</p>
          </div>
        </div>
      </div>

      <div id="weekTab" class="tab-content">
        <div class="week-schedule">
          <div class="empty-state-large">
            <div class="empty-icon">🗓️</div>
            <h3>周课表</h3>
            <p>课程表功能开发中...</p>
          </div>
        </div>
      </div>
    </div>
  `;
}
