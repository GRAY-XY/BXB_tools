export function MessagesPage({ app, state }) {
  const { messages, selectedContact } = state;

  if (selectedContact) {
    return renderMessageThread(selectedContact, app, state);
  }

  return `
    <div class="page-container">
      <div class="page-header">
        <h1 class="page-title">私信</h1>
        <p class="page-subtitle">与老师的私信会话。</p>
      </div>

      <div class="messages-list">
        ${messages.length === 0 ? `
          <div class="empty-state-large">
            <div class="empty-icon">💬</div>
            <h3>暂无私信</h3>
            <p>您还没有任何私信会话</p>
          </div>
        ` : messages.map(contact => `
          <div class="message-contact-card" data-contact-id="${contact.id}">
            <div class="contact-avatar">
              ${contact.peerName ? contact.peerName[0] : '?'}
            </div>
            <div class="contact-info">
              <div class="contact-header">
                <div class="contact-name">
                  ${contact.peerName || '未知联系人'}
                  ${contact.peerType === 'T' ? '<span class="contact-role">老师</span>' : ''}
                </div>
                <div class="contact-time">${formatMessageTime(contact.lastTime)}</div>
              </div>
              <div class="contact-meta">
                <span class="contact-course">${contact.courseName || contact.className || ''}</span>
              </div>
              <div class="contact-preview">
                ${contact.lastContent || '暂无消息'}
              </div>
            </div>
            ${contact.unreadNum > 0 ? `
              <div class="contact-unread">${contact.unreadNum}</div>
            ` : ''}
          </div>
        `).join('')}
      </div>
    </div>
  `;
}

function renderMessageThread(contact, app, state) {
  const thread = state.messageThread || [];
  
  return `
    <div class="page-container messages-thread">
      <div class="page-header">
        <button class="btn-back" data-action="backToMessages">
          ← 返回私信列表
        </button>
        <div class="thread-header-info">
          <h1 class="page-title">${contact.peerName || '未知联系人'}</h1>
          <p class="page-subtitle">${contact.courseName || contact.className || ''}</p>
        </div>
      </div>

      <div class="messages-container">
        <div class="messages-thread-list" id="messagesList">
          ${thread.length === 0 ? `
            <div class="empty-state-large">
              <div class="empty-icon">💬</div>
              <p>暂无消息记录</p>
            </div>
          ` : thread.map(msg => {
            const isSent = msg.senderType === 'S';
            return `
              <div class="message-item ${isSent ? 'sent' : 'received'}">
                <div class="message-avatar">
                  ${isSent ? (msg.senderName ? msg.senderName[0] : 'S') : (msg.senderName ? msg.senderName[0] : 'T')}
                </div>
                <div class="message-content-wrapper">
                  <div class="message-sender">
                    ${msg.senderName || (isSent ? '我' : '对方')}
                    <span class="message-time">${formatMessageTime(msg.createTime)}</span>
                  </div>
                  <div class="message-bubble">
                    ${formatMessageContent(msg.content)}
                  </div>
                </div>
              </div>
            `;
          }).join('')}
        </div>

        <div class="message-input-container">
          <textarea id="messageInput" 
                    class="message-input" 
                    placeholder="输入消息内容..." 
                    rows="3"></textarea>
          <button class="btn btn-primary" 
                  data-action="sendMessage" 
                  data-contact-id="${contact.id}">
            发送
          </button>
        </div>
      </div>
    </div>
  `;
}

function formatMessageTime(timeStr) {
  if (!timeStr) return '';
  const date = new Date(timeStr);
  const now = new Date();
  const diff = now - date;
  const days = Math.floor(diff / (1000 * 60 * 60 * 24));
  
  if (days === 0) {
    return date.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });
  } else if (days === 1) {
    return '昨天 ' + date.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });
  } else if (days < 7) {
    return days + '天前';
  }
  return date.toLocaleDateString('zh-CN', { month: 'numeric', day: 'numeric' });
}

function formatMessageContent(content) {
  if (!content) return '';
  return content
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/\n/g, '<br>');
}
