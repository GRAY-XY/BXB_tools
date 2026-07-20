export function SchedulePage({ app, state }) {
  const { dashboard, session } = state;
  
  // 从 dashboard 或 session 获取课程数据
  const subjects = dashboard?.courses || session?.availableSubjects || [];
  const schedule = state.schedule || {};
  const timeSlots = state.timeSlots || {};

  return `
    <div class="page-container">
      <div class="page-header">
        <h1 class="page-title">📅 课程</h1>
        <p class="page-subtitle">查看所有课程，选择当前科目</p>
      </div>

      <div class="schedule-tabs">
        <button class="tab-btn active" data-tab="courses">课程列表 (${subjects.length})</button>
        <button class="tab-btn" data-tab="today">今日课程</button>
        <button class="tab-btn" data-tab="week">周课表</button>
      </div>

      <div id="coursesTab" class="tab-content active">
        <div class="courses-grid-large">
          ${subjects.length === 0 ? `
            <div class="empty-state-large">
              <div class="empty-icon">📚</div>
              <h3>暂无课程</h3>
              <p>当前学期没有课程信息，请尝试刷新或重新登录</p>
            </div>
          ` : subjects.map(subject => `
            <div class="course-card-large" data-course-name="${subject.name || subject.cnName}">
              <div class="course-card-color" style="background: ${subject.color || '#667eea'}"></div>
              <div class="course-card-content">
                <h3 class="course-card-name">${subject.name || subject.cnName || '未命名课程'}</h3>
                ${subject.teacherList && subject.teacherList.length > 0 ? `
                  <div class="course-card-teachers">
                    👤 ${subject.teacherList.map(t => t.userName || t.name || t.realName).filter(Boolean).join(', ')}
                  </div>
                ` : ''}
                <div class="course-card-meta">
                  ${subject.classId ? `<div class="course-card-id">班级 ID: ${subject.classId.substring(0, 8)}...</div>` : ''}
                  ${subject.unSubmitCount ? `
                    <div class="course-card-badge pending">
                      📝 ${subject.unSubmitCount} 个待提交
                    </div>
                  ` : `
                    <div class="course-card-badge completed">
                      ✓ 全部完成
                    </div>
                  `}
                </div>
                <button class="btn btn-primary btn-sm btn-block" 
                        data-action="selectCourse" 
                        data-course-name="${subject.name || subject.cnName}">
                  选择此课程
                </button>
              </div>
            </div>
          `).join('')}
        </div>
      </div>

      <div id="todayTab" class="tab-content">
        ${renderTodaySchedule(schedule, timeSlots)}
      </div>

      <div id="weekTab" class="tab-content">
        ${renderWeekSchedule(schedule, timeSlots)}
      </div>
    </div>
  `;
}

function renderTodaySchedule(schedule, timeSlots) {
  const today = new Date().getDay(); // 0 = Sunday, 1 = Monday, ...
  const daySchedule = schedule[today] || {};
  const slots = Object.keys(daySchedule).sort((a, b) => parseInt(a) - parseInt(b));
  
  if (slots.length === 0) {
    return `
      <div class="empty-state-large">
        <div class="empty-icon">📅</div>
        <h3>今日无课</h3>
        <p>今天没有安排课程</p>
        <button class="btn btn-primary btn-sm" onclick="window.app.loadSchedule()">
          🔄 刷新课表
        </button>
      </div>
    `;
  }
  
  const dayNames = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];
  
  return `
    <div class="today-schedule">
      <h2 class="schedule-day-title">${dayNames[today]}课程</h2>
      <div class="schedule-slots">
        ${slots.map(slotIndex => {
          const slot = daySchedule[slotIndex];
          const time = timeSlots[slotIndex] || slot.time || '未知时间';
          const courses = slot.courses || [];
          
          return `
            <div class="schedule-slot">
              <div class="schedule-time">
                <div class="time-label">${time}</div>
              </div>
              <div class="schedule-courses">
                ${courses.map(course => `
                  <div class="schedule-course" style="background: ${course.color || '#667eea'}15; border-left: 3px solid ${course.color || '#667eea'}">
                    <div class="course-name">${course.name || '未命名课程'}</div>
                    <div class="course-details">
                      ${course.teacher ? `<span>👤 ${course.teacher}</span>` : ''}
                      ${course.room ? `<span>📍 ${course.room}</span>` : ''}
                    </div>
                  </div>
                `).join('')}
              </div>
            </div>
          `;
        }).join('')}
      </div>
    </div>
  `;
}

function renderWeekSchedule(schedule, timeSlots) {
  const dayNames = ['周一', '周二', '周三', '周四', '周五', '周六', '周日'];
  const days = [1, 2, 3, 4, 5, 6, 0]; // Monday to Sunday
  
  // 获取所有时间段
  const allSlots = new Set();
  days.forEach(day => {
    const daySchedule = schedule[day] || {};
    Object.keys(daySchedule).forEach(slot => allSlots.add(parseInt(slot)));
  });
  const sortedSlots = Array.from(allSlots).sort((a, b) => a - b);
  
  if (sortedSlots.length === 0) {
    return `
      <div class="empty-state-large">
        <div class="empty-icon">🗓️</div>
        <h3>暂无课表数据</h3>
        <p>当前没有课表信息</p>
        <button class="btn btn-primary btn-sm" onclick="window.app.loadSchedule()">
          🔄 加载课表
        </button>
      </div>
    `;
  }
  
  return `
    <div class="week-schedule-table">
      <table class="schedule-table">
        <thead>
          <tr>
            <th class="time-column">时间</th>
            ${dayNames.map(day => `<th>${day}</th>`).join('')}
          </tr>
        </thead>
        <tbody>
          ${sortedSlots.map(slotIndex => {
            const time = timeSlots[slotIndex] || '未知';
            return `
              <tr>
                <td class="time-column">${time}</td>
                ${days.map(day => {
                  const daySchedule = schedule[day] || {};
                  const slot = daySchedule[slotIndex];
                  const courses = slot?.courses || [];
                  
                  if (courses.length === 0) {
                    return '<td class="empty-slot">-</td>';
                  }
                  
                  return `
                    <td class="course-slot">
                      ${courses.map(course => `
                        <div class="mini-course" style="background: ${course.color || '#667eea'}; color: white;">
                          <div class="mini-course-name">${course.name || '未命名'}</div>
                          ${course.room ? `<div class="mini-course-room">${course.room}</div>` : ''}
                        </div>
                      `).join('')}
                    </td>
                  `;
                }).join('')}
              </tr>
            `;
          }).join('')}
        </tbody>
      </table>
    </div>
  `;
}
