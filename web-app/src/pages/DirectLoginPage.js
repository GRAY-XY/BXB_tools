/**
 * 直接登录页面
 * 使用后端 Playwright 自动登录
 */

export function DirectLoginPage({ app, state }) {
  return `
    <div class="login-container">
      <!-- 动态背景 -->
      <div class="login-bg">
        <div class="bg-gradient"></div>
        <div class="bg-shapes">
          <div class="shape shape-1"></div>
          <div class="shape shape-2"></div>
          <div class="shape shape-3"></div>
          <div class="shape shape-4"></div>
          <div class="shape shape-5"></div>
        </div>
      </div>

      <div class="login-content">
        <div class="login-card">
          <div class="login-header">
            <div class="app-icon">🎓</div>
            <h1 class="app-title">BXB Student</h1>
            <p class="login-subtitle">班学帮学生助手</p>
          </div>

          <div class="login-main">
            <div class="login-form">
              <div class="form-group">
                <label for="username">
                  <span class="label-icon">👤</span>
                  <span>账号</span>
                </label>
                <input 
                  type="text" 
                  id="username" 
                  placeholder="请输入班学帮账号"
                  autocomplete="username"
                  class="form-input"
                />
              </div>
              
              <div class="form-group">
                <label for="password">
                  <span class="label-icon">🔒</span>
                  <span>密码</span>
                </label>
                <input 
                  type="password" 
                  id="password" 
                  placeholder="请输入密码"
                  autocomplete="current-password"
                  class="form-input"
                />
              </div>
              
              <button class="btn-login" id="loginBtn">
                <span class="btn-text">登录</span>
                <span class="btn-arrow">→</span>
              </button>
            </div>

            <div id="loginStatus" class="login-status"></div>

            <div class="login-info">
              <div class="info-title">💡 登录说明</div>
              <ul class="info-list">
                <li>系统将在后台自动打开浏览器完成登录</li>
                <li>整个过程大约需要 10-30 秒</li>
                <li>如遇验证码，会自动尝试识别或等待</li>
              </ul>
            </div>

            <div class="login-help">
              <details>
                <summary>❓ 遇到问题？</summary>
                <div class="help-content">
                  <h4>常见问题：</h4>
                  <ul>
                    <li><strong>登录超时？</strong> 可能是网络问题，请重试</li>
                    <li><strong>账号密码错误？</strong> 请检查输入是否正确</li>
                    <li><strong>一直显示登录中？</strong> 查看浏览器控制台了解详情</li>
                  </ul>
                </div>
              </details>
            </div>
          </div>
        </div>
      </div>
    </div>
  `;
}

export function initDirectLoginPage(app) {
  const loginBtn = document.getElementById('loginBtn');
  const usernameInput = document.getElementById('username');
  const passwordInput = document.getElementById('password');
  const loginStatus = document.getElementById('loginStatus');

  if (loginBtn) {
    loginBtn.addEventListener('click', async () => {
      const username = usernameInput.value.trim();
      const password = passwordInput.value.trim();
      
      if (!username || !password) {
        showStatus('❌ 请输入账号和密码', 'error');
        return;
      }
      
      console.log('=== 开始登录 ===');
      console.log('账号:', username);
      
      // 禁用按钮和输入框
      loginBtn.disabled = true;
      usernameInput.disabled = true;
      passwordInput.disabled = true;
      
      showStatus(
        '🔄 正在登录...<br>' +
        '后台浏览器正在启动，请稍候...<br>' +
        '<small>这个过程可能需要 10-30 秒</small>',
        'loading'
      );
      
      try {
        const response = await fetch('http://localhost:3000/api/session/login', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            username,
            password
          }),
          credentials: 'include'
        });
        
        console.log('收到响应:', response.status);
        const data = await response.json();
        console.log('响应数据:', data);
        
        if (data.success) {
          console.log('✓ 登录成功！');
          showStatus('✓ 登录成功！正在跳转...', 'success');
          
          // 清空密码
          passwordInput.value = '';
          
          setTimeout(async () => {
            await app.checkSession();
            // 登录后自动切到最新学期
            await app.ensureLatestTerm();
            await app.checkSession();
            app.navigateTo('overview');
          }, 1000);
        } else {
          console.error('✗ 登录失败:', data.error);
          
          // 重新启用
          loginBtn.disabled = false;
          usernameInput.disabled = false;
          passwordInput.disabled = false;
          
          showStatus(
            '❌ 登录失败<br><br>' +
            '<strong>错误信息：</strong><br>' + 
            data.error + '<br><br>' +
            '请检查账号密码是否正确',
            'error'
          );
        }
      } catch (error) {
        console.error('=== 网络错误 ===');
        console.error(error);
        
        // 重新启用
        loginBtn.disabled = false;
        usernameInput.disabled = false;
        passwordInput.disabled = false;
        
        showStatus(
          '❌ 网络错误<br><br>' +
          error.message + '<br><br>' +
          '请确保后端服务器正在运行',
          'error'
        );
      }
    });
  }
  
  // 回车登录
  if (passwordInput) {
    passwordInput.addEventListener('keypress', (e) => {
      if (e.key === 'Enter') {
        loginBtn.click();
      }
    });
  }

  function showStatus(message, type) {
    loginStatus.innerHTML = `
      <div class="status-${type}">
        ${message}
      </div>
    `;
  }
}
