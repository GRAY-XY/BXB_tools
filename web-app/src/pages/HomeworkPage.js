export function HomeworkPage({ app, state }) {
  const { homework, selectedTask } = state;

  if (selectedTask) {
    return renderTaskDetail(selectedTask, app);
  }

  return `
    <div class="page-container">
      <div class="page-header">
        <h1 class="page-title">作业</h1>
        <p class="page-subtitle">按课程切换任务，打开详情后直接提交。</p>
      </div>

      <!-- 筛选器 -->
      <div class="homework-filters">
        <button class="filter-btn active" data-status="">全部</button>
        <button class="filter-btn" data-status="pending">待提交</button>
        <button class="filter-btn" data-status="submitted">已提交</button>
        <button class="filter-btn" data-status="corrected">已批改</button>
      </div>

      <!-- 作业列表 -->
      <div class="homework-list">
        ${homework.length === 0 ? `
          <div class="empty-state-large">
            <div class="empty-icon">📝</div>
            <h3>暂无作业</h3>
            <p>当前没有符合条件的作业</p>
          </div>
        ` : homework.map(hw => `
          <div class="homework-card" data-task-id="${hw.id}">
            <div class="homework-card-header">
              <div class="homework-card-title">
                <h3>${hw.activityName}</h3>
                <span class="homework-type-badge ${hw.scoreTypeColor || 'gray'}">
                  ${hw.scoreTypeName || '未评分'}
                </span>
              </div>
              ${hw.isEnd ? `
                <span class="homework-status-badge ended">已截止</span>
              ` : hw.days && hw.hours ? `
                <span class="homework-status-badge ${getUrgencyClass(hw.days, hw.hours)}">
                  剩余 ${hw.days}天${hw.hours}时
                </span>
              ` : ''}
            </div>

            <div class="homework-card-meta">
              <div class="homework-meta-item">
                <span class="meta-icon">📚</span>
                <span class="meta-text">${hw.courseName || '未知课程'}</span>
              </div>
              <div class="homework-meta-item">
                <span class="meta-icon">👤</span>
                <span class="meta-text">${hw.createName || '未知老师'}</span>
              </div>
              <div class="homework-meta-item">
                <span class="meta-icon">📅</span>
                <span class="meta-text">发布: ${formatDateTime(hw.releaseTime)}</span>
              </div>
              <div class="homework-meta-item">
                <span class="meta-icon">⏰</span>
                <span class="meta-text">截止: ${formatDateTime(hw.endTime)}</span>
              </div>
            </div>

            <div class="homework-card-footer">
              <button class="btn btn-primary btn-sm" data-action="viewTask" data-task-id="${hw.id}">
                查看详情 →
              </button>
            </div>
          </div>
        `).join('')}
      </div>
    </div>
  `;
}

function renderTaskDetail(task, app) {
  const detail = task.detail || {};
  const mySubmission = task.mySubmission || {};
  const attachments = task.attachments || [];
  const submissionFiles = mySubmission.correctAttachment || mySubmission.files || [];

  return `
    <div class="page-container">
      <div class="page-header">
        <button class="btn-back" data-action="backToHomework">
          ← 返回作业列表
        </button>
        <h1 class="page-title">${detail.activityName || '作业详情'}</h1>
      </div>

      <div class="task-detail-container">
        <!-- 作业信息卡片 -->
        <div class="task-card">
          <div class="task-card-header">
            <h3 class="task-card-title">📋 作业信息</h3>
          </div>
          <div class="task-card-content">
            <div class="task-info-grid">
              <div class="task-info-item">
                <span class="task-info-label">课程:</span>
                <span class="task-info-value">${detail.courseName || '未知'}</span>
              </div>
              <div class="task-info-item">
                <span class="task-info-label">发布人:</span>
                <span class="task-info-value">${detail.createName || '未知'}</span>
              </div>
              <div class="task-info-item">
                <span class="task-info-label">发布时间:</span>
                <span class="task-info-value">${formatDateTime(detail.releaseTime)}</span>
              </div>
              <div class="task-info-item">
                <span class="task-info-label">截止时间:</span>
                <span class="task-info-value">${formatDateTime(detail.endTime)}</span>
              </div>
              <div class="task-info-item">
                <span class="task-info-label">评分方式:</span>
                <span class="task-info-value">${detail.scoreTypeName || '未知'}</span>
              </div>
              <div class="task-info-item">
                <span class="task-info-label">作业类型:</span>
                <span class="task-info-value">${getHomeworkTypeName(detail.homeworkType)}</span>
              </div>
            </div>
          </div>
        </div>

        <!-- 作业内容卡片 -->
        <div class="task-card">
          <div class="task-card-header">
            <h3 class="task-card-title">📝 作业内容</h3>
          </div>
          <div class="task-card-content">
            <div class="task-content">
              ${detail.activityName ? `<h4>${detail.activityName}</h4>` : ''}
              ${detail.description ? `
                <div class="task-description">
                  ${formatTaskContent(detail.description)}
                </div>
              ` : '<p class="text-muted">暂无作业说明</p>'}
            </div>

            ${attachments.length > 0 ? `
              <div class="task-attachments">
                <h5>📎 作业附件 (${attachments.length})</h5>
                <div class="attachment-list">
                  ${attachments.map(att => `
                    <div class="attachment-item">
                      <span class="attachment-icon">${getFileIcon(att.fileExt)}</span>
                      <span class="attachment-name">${att.fileName}</span>
                      <span class="attachment-size">${formatFileSize(att.fileSize)}</span>
                      <button class="btn-icon" data-action="downloadAttachment" 
                              data-file-id="${att.fileId}" 
                              data-task-id="${task.id}"
                              title="下载">
                        💾
                      </button>
                    </div>
                  `).join('')}
                </div>
              </div>
            ` : ''}
          </div>
        </div>

        <!-- 提交状态卡片 -->
        <div class="task-card">
          <div class="task-card-header">
            <h3 class="task-card-title">
              ${mySubmission.id ? '✓ 已提交' : '📤 待提交'}
            </h3>
          </div>
          <div class="task-card-content">
            ${mySubmission.id ? `
              <div class="submission-info">
                <div class="submission-meta">
                  <span class="meta-label">提交时间:</span>
                  <span class="meta-value">${formatDateTime(mySubmission.createTime)}</span>
                </div>
                ${mySubmission.remark ? `
                  <div class="submission-content">
                    <h5>提交内容:</h5>
                    <div class="submission-text">${formatTaskContent(mySubmission.remark)}</div>
                  </div>
                ` : ''}
                ${submissionFiles.length > 0 ? `
                  <div class="submission-files">
                    <h5>提交文件 (${submissionFiles.length}):</h5>
                    <div class="attachment-list">
                      ${submissionFiles.map(file => `
                        <div class="attachment-item">
                          <span class="attachment-icon">${getFileIcon(file.fileExt)}</span>
                          <span class="attachment-name">${file.fileName}</span>
                          <span class="attachment-size">${formatFileSize(file.fileSize)}</span>
                        </div>
                      `).join('')}
                    </div>
                  </div>
                ` : ''}
                ${detail.correction === 1 ? `
                  <button class="btn btn-warning btn-block" data-action="showSubmitForm">
                    修改提交
                  </button>
                ` : ''}
              </div>
            ` : `
              <div id="submitForm" class="submit-form">
                <div class="form-group">
                  <label for="submitRemark">作业内容</label>
                  <textarea id="submitRemark" 
                            class="form-control" 
                            rows="10" 
                            placeholder="在此输入作业内容..."></textarea>
                </div>
                <div class="form-group">
                  <label>附件上传</label>
                  <input type="file" id="submitFiles" multiple class="form-control" />
                  <small class="form-text">支持多文件上传</small>
                </div>
                <button class="btn btn-primary btn-block" 
                        data-action="submitTask" 
                        data-task-id="${task.id}">
                  提交作业
                </button>
              </div>
            `}
          </div>
        </div>
      </div>
    </div>
  `;
}

function formatDateTime(dateStr) {
  if (!dateStr) return '未知';
  const date = new Date(dateStr);
  return date.toLocaleString('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit'
  });
}

function formatTaskContent(html) {
  if (!html) return '';
  // 简单的 HTML 清理，保留基本格式
  return html
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
    .replace(/\n{3,}/g, '\n\n');
}

function getHomeworkTypeName(type) {
  const types = {
    1: '普通作业',
    2: '测试',
    3: '问卷',
    4: '讨论'
  };
  return types[type] || '未知';
}

function getFileIcon(ext) {
  if (!ext) return '📄';
  const lower = ext.toLowerCase();
  if (['.jpg', '.jpeg', '.png', '.gif', '.bmp', '.webp'].includes(lower)) return '🖼️';
  if (['.pdf'].includes(lower)) return '📕';
  if (['.doc', '.docx'].includes(lower)) return '📘';
  if (['.xls', '.xlsx'].includes(lower)) return '📗';
  if (['.ppt', '.pptx'].includes(lower)) return '📙';
  if (['.zip', '.rar', '.7z'].includes(lower)) return '📦';
  if (['.mp4', '.avi', '.mov'].includes(lower)) return '🎬';
  if (['.mp3', '.wav', '.m4a'].includes(lower)) return '🎵';
  return '📄';
}

function formatFileSize(bytes) {
  if (!bytes) return '未知';
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
  return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
}

function getUrgencyClass(days, hours) {
  const totalHours = parseInt(days) * 24 + parseInt(hours);
  if (totalHours < 24) return 'urgent';
  if (totalHours < 48) return 'warning';
  return 'normal';
}
