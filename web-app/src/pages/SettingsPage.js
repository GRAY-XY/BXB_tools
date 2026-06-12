export function SettingsPage({ app, state }) {
  const { session } = state;

  return `
    <div class="page-container">
      <div class="page-header">
        <h1 class="page-title">设置</h1>
        <p class="page-subtitle">外观与显示偏好。</p>
      </div>

      <div class="settings-container">
        <!-- 外观设置 -->
        <div class="settings-card">
          <h3 class="settings-card-title">🎨 外观</h3>
          <div class="settings-item">
            <div class="settings-item-info">
              <div class="settings-item-label">主题模式</div>
              <div class="settings-item-desc">选择浅色或深色主题</div>
            </div>
            <select class="settings-select" id="themeSelect">
              <option value="light">浅色</option>
              <option value="dark">深色</option>
              <option value="auto">跟随系统</option>
            </select>
          </div>
          <div class="settings-item">
            <div class="settings-item-info">
              <div class="settings-item-label">字体大小</div>
              <div class="settings-item-desc">调整界面字体大小</div>
            </div>
            <select class="settings-select" id="fontSizeSelect">
              <option value="small">小</option>
              <option value="medium" selected>中</option>
              <option value="large">大</option>
            </select>
          </div>
        </div>

        <!-- 账号信息 -->
        <div class="settings-card">
          <h3 class="settings-card-title">👤 账号信息</h3>
          <div class="settings-info-list">
            <div class="settings-info-item">
              <span class="settings-info-label">用户名:</span>
              <span class="settings-info-value">${session?.user?.name || '未知'}</span>
            </div>
            <div class="settings-info-item">
              <span class="settings-info-label">登录名:</span>
              <span class="settings-info-value">${session?.user?.loginName || '未知'}</span>
            </div>
            <div class="settings-info-item">
              <span class="settings-info-label">当前班级:</span>
              <span class="settings-info-value">${session?.currentClass?.name || '未知'}</span>
            </div>
            <div class="settings-info-item">
              <span class="settings-info-label">当前学期:</span>
              <span class="settings-info-value">
                ${session?.availableTerms?.find(t => t.id === session?.currentTermId)?.name || '未知'}
              </span>
            </div>
          </div>
        </div>

        <!-- 数据管理 -->
        <div class="settings-card">
          <h3 class="settings-card-title">💾 数据管理</h3>
          <div class="settings-item">
            <div class="settings-item-info">
              <div class="settings-item-label">清除缓存</div>
              <div class="settings-item-desc">清除本地缓存数据</div>
            </div>
            <button class="btn btn-sm" data-action="clearCache">清除</button>
          </div>
          <div class="settings-item">
            <div class="settings-item-info">
              <div class="settings-item-label">导出数据</div>
              <div class="settings-item-desc">导出会话和设置数据</div>
            </div>
            <button class="btn btn-sm" data-action="exportData">导出</button>
          </div>
        </div>

        <!-- 关于 -->
        <div class="settings-card">
          <h3 class="settings-card-title">ℹ️ 关于</h3>
          <div class="settings-info-list">
            <div class="settings-info-item">
              <span class="settings-info-label">应用名称:</span>
              <span class="settings-info-value">班学帮 Student Web</span>
            </div>
            <div class="settings-info-item">
              <span class="settings-info-label">版本:</span>
              <span class="settings-info-value">1.0.0</span>
            </div>
            <div class="settings-info-item">
              <span class="settings-info-label">服务器:</span>
              <span class="settings-info-value">${session?.baseUrl || 'https://student.banxuebang.com'}</span>
            </div>
          </div>
        </div>

        <!-- 危险操作 -->
        <div class="settings-card danger">
          <h3 class="settings-card-title">⚠️ 危险操作</h3>
          <div class="settings-item">
            <div class="settings-item-info">
              <div class="settings-item-label">退出登录</div>
              <div class="settings-item-desc">清除会话并返回登录页</div>
            </div>
            <button class="btn btn-danger btn-sm" data-action="logout">退出</button>
          </div>
        </div>
      </div>
    </div>
  `;
}
