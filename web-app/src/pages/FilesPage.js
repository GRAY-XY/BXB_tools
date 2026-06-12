export function FilesPage({ app, state }) {
  const { files } = state;

  return `
    <div class="page-container">
      <div class="page-header">
        <h1 class="page-title">文件</h1>
        <p class="page-subtitle">共享仓库文件，支持浏览、预览和下载。</p>
      </div>

      <div class="files-toolbar">
        <div class="search-box">
          <input type="text" 
                 id="fileSearch" 
                 class="search-input" 
                 placeholder="搜索文件名..." />
          <button class="btn btn-sm" data-action="searchFiles">
            🔍 搜索
          </button>
        </div>
        <button class="btn btn-primary btn-sm" data-action="uploadFile">
          📤 上传文件
        </button>
      </div>

      <div class="files-list">
        ${files.length === 0 ? `
          <div class="empty-state-large">
            <div class="empty-icon">📁</div>
            <h3>暂无文件</h3>
            <p>工作区中还没有文件</p>
          </div>
        ` : `
          <div class="files-grid">
            ${files.map(file => `
              <div class="file-card" data-file-path="${file.relativePath}">
                <div class="file-icon">
                  ${getFileIconLarge(file.extension, file.category)}
                </div>
                <div class="file-info">
                  <div class="file-name" title="${file.name}">${file.name}</div>
                  <div class="file-meta">
                    <span class="file-size">${formatFileSize(file.size)}</span>
                    <span class="file-date">${formatFileDate(file.modifiedAt)}</span>
                  </div>
                </div>
                <div class="file-actions">
                  ${file.category === 'text' || file.category === 'pdf' || file.category === 'docx' ? `
                    <button class="btn-icon" 
                            data-action="previewFile" 
                            data-file-path="${file.relativePath}"
                            title="预览">
                      👁️
                    </button>
                  ` : ''}
                  <button class="btn-icon" 
                          data-action="downloadFile" 
                          data-file-path="${file.path}"
                          title="下载">
                    💾
                  </button>
                  <button class="btn-icon" 
                          data-action="deleteFile" 
                          data-file-path="${file.relativePath}"
                          title="删除">
                    🗑️
                  </button>
                </div>
              </div>
            `).join('')}
          </div>
        `}
      </div>
    </div>
  `;
}

function getFileIconLarge(ext, category) {
  if (category === 'image') return '🖼️';
  if (category === 'video') return '🎬';
  if (category === 'audio') return '🎵';
  if (category === 'pdf') return '📕';
  if (category === 'docx') return '📘';
  if (category === 'text') return '📄';
  
  const lower = ext?.toLowerCase() || '';
  if (['.xls', '.xlsx'].includes(lower)) return '📗';
  if (['.ppt', '.pptx'].includes(lower)) return '📙';
  if (['.zip', '.rar', '.7z'].includes(lower)) return '📦';
  return '📄';
}

function formatFileSize(bytes) {
  if (!bytes) return '0 B';
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
  if (bytes < 1024 * 1024 * 1024) return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
  return (bytes / (1024 * 1024 * 1024)).toFixed(2) + ' GB';
}

function formatFileDate(dateStr) {
  if (!dateStr) return '';
  const date = new Date(dateStr);
  const now = new Date();
  const diff = now - date;
  const days = Math.floor(diff / (1000 * 60 * 60 * 24));
  
  if (days === 0) return '今天';
  if (days === 1) return '昨天';
  if (days < 7) return `${days}天前`;
  return date.toLocaleDateString('zh-CN');
}
