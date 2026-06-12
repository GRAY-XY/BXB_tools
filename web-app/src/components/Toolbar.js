export function Toolbar({ app, state }) {
  const { session } = state;
  const subjects = session?.availableSubjects || [];
  const terms = session?.availableTerms || [];
  const currentSubject = session?.currentSubject;
  const currentTermId = session?.currentTermId;

  return `
    <div class="toolbar">
      <div class="toolbar-controls">
        <!-- 科目选择 -->
        <div class="toolbar-select-wrapper">
          <span class="toolbar-icon">📚</span>
          <select class="toolbar-select" id="subjectSelect">
            <option value="">选择科目</option>
            ${subjects.map(subject => `
              <option value="${subject.name}" ${currentSubject?.id === subject.id ? 'selected' : ''}>
                ${subject.name}
              </option>
            `).join('')}
          </select>
        </div>

        <!-- 学期选择 -->
        <div class="toolbar-select-wrapper">
          <span class="toolbar-icon">📆</span>
          <select class="toolbar-select" id="termSelect">
            <option value="">选择学期</option>
            ${terms.map(term => `
              <option value="${term.id}" ${currentTermId === term.id ? 'selected' : ''}>
                ${term.name}
              </option>
            `).join('')}
          </select>
        </div>

        <!-- 刷新按钮 -->
        <button class="toolbar-btn" id="refreshBtn" title="刷新数据">
          <span class="toolbar-icon">🔄</span>
        </button>

        <!-- 退出按钮 -->
        <button class="toolbar-btn" id="logoutBtn" title="退出登录">
          <span class="toolbar-icon">🚪</span>
        </button>
      </div>
    </div>
  `;
}
