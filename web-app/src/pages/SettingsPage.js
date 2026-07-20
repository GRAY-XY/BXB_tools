import { t, getLanguage, availableLanguages } from '../locales.js';

export function SettingsPage({ app, state }) {
  const { session, language = getLanguage() } = state;

  const currentLang = availableLanguages.find(l => l.code === language) || availableLanguages[0];

  return `
    <div class="page-container">
      <div class="page-header">
        <h1 class="page-title">${t('settings.title')}</h1>
        <p class="page-subtitle">${t('settings.subtitle')}</p>
      </div>

      <div class="settings-container">
        <!-- 外观设置 -->
        <div class="settings-card">
          <h3 class="settings-card-title">${t('settings.appearance')}</h3>

          <div class="settings-item">
            <div class="settings-item-info">
              <div class="settings-item-label">${t('settings.theme')}</div>
              <div class="settings-item-desc">${t('settings.theme.desc')}</div>
            </div>
            <div class="custom-select">
              <select class="settings-select" id="themeSelect">
                <option value="light">${t('settings.theme.light')}</option>
                <option value="dark">${t('settings.theme.dark')}</option>
                <option value="auto">${t('settings.theme.auto')}</option>
              </select>
            </div>
          </div>

          <div class="settings-item">
            <div class="settings-item-info">
              <div class="settings-item-label">${t('settings.fontSize')}</div>
              <div class="settings-item-desc">${t('settings.fontSize.desc')}</div>
            </div>
            <div class="custom-select">
              <select class="settings-select" id="fontSizeSelect">
                <option value="small">${t('settings.fontSize.small')}</option>
                <option value="medium" selected>${t('settings.fontSize.medium')}</option>
                <option value="large">${t('settings.fontSize.large')}</option>
              </select>
            </div>
          </div>

          <!-- 语言选择：纯 CSS 方案，不依赖 JS 事件 -->
          <div class="settings-item">
            <div class="settings-item-info">
              <div class="settings-item-label">${t('settings.language')}</div>
              <div class="settings-item-desc">${t('settings.language.desc')}</div>
            </div>
            <div class="lang-switcher">
              <button class="lang-btn ${language === 'zh-CN' ? 'active' : ''}" 
                      data-action="switchLang" data-lang="zh-CN">
                中文
              </button>
              <button class="lang-btn ${language === 'en' ? 'active' : ''}"
                      data-action="switchLang" data-lang="en">
                English
              </button>
            </div>
          </div>
        </div>

        <!-- 账号信息 -->
        <div class="settings-card">
          <h3 class="settings-card-title">${t('settings.account')}</h3>
          <div class="settings-info-list">
            <div class="settings-info-item">
              <span class="settings-info-label">${t('settings.username')}</span>
              <span class="settings-info-value">${session?.user?.name || t('settings.unknown')}</span>
            </div>
            <div class="settings-info-item">
              <span class="settings-info-label">${t('settings.loginName')}</span>
              <span class="settings-info-value">${session?.user?.loginName || t('settings.unknown')}</span>
            </div>
            <div class="settings-info-item">
              <span class="settings-info-label">${t('settings.currentClass')}</span>
              <span class="settings-info-value">${session?.currentClass?.name || t('settings.unknown')}</span>
            </div>
            <div class="settings-info-item">
              <span class="settings-info-label">${t('settings.currentTerm')}</span>
              <span class="settings-info-value">
                ${session?.availableTerms?.find(term => term.id === session?.currentTermId)?.name || t('settings.unknown')}
              </span>
            </div>
          </div>
        </div>

        <!-- 数据管理 -->
        <div class="settings-card">
          <h3 class="settings-card-title">${t('settings.data')}</h3>
          <div class="settings-item">
            <div class="settings-item-info">
              <div class="settings-item-label">${t('settings.clearCache')}</div>
              <div class="settings-item-desc">${t('settings.clearCache.desc')}</div>
            </div>
            <button class="btn btn-sm" data-action="clearCache">${t('settings.clear')}</button>
          </div>
          <div class="settings-item">
            <div class="settings-item-info">
              <div class="settings-item-label">${t('settings.exportData')}</div>
              <div class="settings-item-desc">${t('settings.exportData.desc')}</div>
            </div>
            <button class="btn btn-sm" data-action="exportData">${t('settings.export')}</button>
          </div>
        </div>

        <!-- 关于 -->
        <div class="settings-card">
          <h3 class="settings-card-title">${t('settings.about')}</h3>
          <div class="settings-info-list">
            <div class="settings-info-item">
              <span class="settings-info-label">${t('settings.appName')}</span>
              <span class="settings-info-value">班学帮 Student Web</span>
            </div>
            <div class="settings-info-item">
              <span class="settings-info-label">${t('settings.version')}</span>
              <span class="settings-info-value">1.0.0</span>
            </div>
            <div class="settings-info-item">
              <span class="settings-info-label">${t('settings.server')}</span>
              <span class="settings-info-value">${session?.baseUrl || 'https://student.banxuebang.com'}</span>
            </div>
          </div>
        </div>

        <!-- 危险操作 -->
        <div class="settings-card danger">
          <h3 class="settings-card-title">${t('settings.danger')}</h3>
          <div class="settings-item">
            <div class="settings-item-info">
              <div class="settings-item-label">${t('settings.logout')}</div>
              <div class="settings-item-desc">${t('settings.logout.desc')}</div>
            </div>
            <button class="btn btn-danger btn-sm" data-action="logout">${t('settings.logout')}</button>
          </div>
        </div>
      </div>
    </div>
  `;
}