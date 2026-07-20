export const locales = {
  'zh-CN': {
    // 通用
    'app.name': '班学帮 Student',
    'app.subtitle': '学生助手',
    
    // 侧边栏
    'sidebar.navigation': '导航',
    'sidebar.overview': '工作台',
    'sidebar.homework': '作业',
    'sidebar.schedule': '课程',
    'sidebar.notices': '通知',
    'sidebar.messages': '私信',
    'sidebar.files': '文件',
    'sidebar.settings': '设置',
    'sidebar.riskHomework': '风险作业',
    'sidebar.sessionTime': '登录时间',
    
    // 用户卡片
    'user.noLogin': '未登录',
    'user.noSubject': '当前未选科目',
    
    // 设置页面
    'settings.title': '设置',
    'settings.subtitle': '外观与显示偏好',
    'settings.appearance': '🎨 外观',
    'settings.account': '👤 账号信息',
    'settings.data': '💾 数据管理',
    'settings.about': 'ℹ️ 关于',
    'settings.danger': '⚠️ 危险操作',
    
    // 外观设置
    'settings.theme': '主题模式',
    'settings.theme.desc': '选择浅色或深色主题',
    'settings.theme.light': '浅色',
    'settings.theme.dark': '深色',
    'settings.theme.auto': '跟随系统',
    'settings.fontSize': '字体大小',
    'settings.fontSize.desc': '调整界面字体大小',
    'settings.fontSize.small': '小',
    'settings.fontSize.medium': '中',
    'settings.fontSize.large': '大',
    'settings.language': '界面语言',
    'settings.language.desc': '选择界面显示语言',
    'settings.language.zh': '简体中文',
    'settings.language.en': 'English',
    
    // 账号信息
    'settings.username': '用户名:',
    'settings.loginName': '登录名:',
    'settings.currentClass': '当前班级:',
    'settings.currentTerm': '当前学期:',
    'settings.unknown': '未知',
    
    // 数据管理
    'settings.clearCache': '清除缓存',
    'settings.clearCache.desc': '清除本地缓存数据',
    'settings.exportData': '导出数据',
    'settings.exportData.desc': '导出会话和设置数据',
    'settings.clear': '清除',
    'settings.export': '导出',
    
    // 关于
    'settings.appName': '应用名称:',
    'settings.version': '版本:',
    'settings.server': '服务器:',
    
    // 危险操作
    'settings.logout': '退出登录',
    'settings.logout.desc': '清除会话并返回登录页',
    
    // 页面标题
    'pages.overview': '工作台',
    'pages.homework': '作业',
    'pages.schedule': '课程表',
    'pages.notices': '通知中心',
    'pages.messages': '私信',
    'pages.files': '文件管理',
    'pages.settings': '设置',
    
    // 时间格式
    'time.justNow': '刚刚登录',
    'time.minutesAgo': '{minutes}分钟前登录',
    'time.hoursAgo': '{hours}小时前登录',
    'time.daysAgo': '{days}天前登录',
    'time.notLoggedIn': '未登录'
  },
  
  'en': {
    // 通用
    'app.name': 'Banxuebang Student',
    'app.subtitle': 'Student Assistant',
    
    // 侧边栏
    'sidebar.navigation': 'Navigation',
    'sidebar.overview': 'Overview',
    'sidebar.homework': 'Homework',
    'sidebar.schedule': 'Courses',
    'sidebar.notices': 'Notices',
    'sidebar.messages': 'Messages',
    'sidebar.files': 'Files',
    'sidebar.settings': 'Settings',
    'sidebar.riskHomework': 'Risk Homework',
    'sidebar.sessionTime': 'Session Time',
    
    // 用户卡片
    'user.noLogin': 'Not logged in',
    'user.noSubject': 'No subject selected',
    
    // 设置页面
    'settings.title': 'Settings',
    'settings.subtitle': 'Appearance and display preferences',
    'settings.appearance': '🎨 Appearance',
    'settings.account': '👤 Account Information',
    'settings.data': '💾 Data Management',
    'settings.about': 'ℹ️ About',
    'settings.danger': '⚠️ Danger Zone',
    
    // 外观设置
    'settings.theme': 'Theme Mode',
    'settings.theme.desc': 'Choose light or dark theme',
    'settings.theme.light': 'Light',
    'settings.theme.dark': 'Dark',
    'settings.theme.auto': 'Follow System',
    'settings.fontSize': 'Font Size',
    'settings.fontSize.desc': 'Adjust interface font size',
    'settings.fontSize.small': 'Small',
    'settings.fontSize.medium': 'Medium',
    'settings.fontSize.large': 'Large',
    'settings.language': 'Interface Language',
    'settings.language.desc': 'Choose interface display language',
    'settings.language.zh': '简体中文',
    'settings.language.en': 'English',
    
    // 账号信息
    'settings.username': 'Username:',
    'settings.loginName': 'Login Name:',
    'settings.currentClass': 'Current Class:',
    'settings.currentTerm': 'Current Term:',
    'settings.unknown': 'Unknown',
    
    // 数据管理
    'settings.clearCache': 'Clear Cache',
    'settings.clearCache.desc': 'Clear local cache data',
    'settings.exportData': 'Export Data',
    'settings.exportData.desc': 'Export session and settings data',
    'settings.clear': 'Clear',
    'settings.export': 'Export',
    
    // 关于
    'settings.appName': 'App Name:',
    'settings.version': 'Version:',
    'settings.server': 'Server:',
    
    // 危险操作
    'settings.logout': 'Logout',
    'settings.logout.desc': 'Clear session and return to login page',
    
    // 页面标题
    'pages.overview': 'Overview',
    'pages.homework': 'Homework',
    'pages.schedule': 'Schedule',
    'pages.notices': 'Notices',
    'pages.messages': 'Messages',
    'pages.files': 'Files',
    'pages.settings': 'Settings',
    
    // 时间格式
    'time.justNow': 'Just logged in',
    'time.minutesAgo': 'Logged in {minutes} minutes ago',
    'time.hoursAgo': 'Logged in {hours} hours ago',
    'time.daysAgo': 'Logged in {days} days ago',
    'time.notLoggedIn': 'Not logged in'
  }
};

// 当前语言
let currentLanguage = 'zh-CN';

// 获取翻译
export function t(key, params = {}) {
  const langDict = locales[currentLanguage] || locales['zh-CN'];
  let text = langDict[key] || key;
  
  // 替换参数
  Object.entries(params).forEach(([param, value]) => {
    text = text.replace(`{${param}}`, value);
  });
  
  return text;
}

// 设置语言
export function setLanguage(lang) {
  if (locales[lang]) {
    currentLanguage = lang;
    localStorage.setItem('bxb-language', lang);
    return true;
  }
  return false;
}

// 获取当前语言
export function getLanguage() {
  return currentLanguage;
}

// 初始化语言
export function initLanguage() {
  const savedLang = localStorage.getItem('bxb-language');
  if (savedLang && locales[savedLang]) {
    currentLanguage = savedLang;
  } else {
    // 检测浏览器语言
    const browserLang = navigator.language || 'zh-CN';
    if (browserLang.startsWith('en')) {
      currentLanguage = 'en';
    } else {
      currentLanguage = 'zh-CN';
    }
  }
  return currentLanguage;
}

// 导出可用的语言列表
export const availableLanguages = [
  { code: 'zh-CN', name: '简体中文', nativeName: '简体中文' },
  { code: 'en', name: 'English', nativeName: 'English' }
];