const API_BASE = 'http://localhost:3000/api';

export async function api(endpoint, options = {}) {
  const response = await fetch(`${API_BASE}${endpoint}`, {
    ...options,
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json',
      ...options.headers
    }
  });
  return response.json();
}

export const sessionAPI = {
  status: () => api('/session/status'),
  login: (username, password) => api('/session/login', {
    method: 'POST',
    body: JSON.stringify({ username, password })
  }),
  clear: () => api('/session/clear', { method: 'POST' })
};

export const termsAPI = {
  list: () => api('/terms'),
  set: (termId) => api('/terms/set', {
    method: 'POST',
    body: JSON.stringify({ termId })
  })
};

export const coursesAPI = {
  list: () => api('/courses'),
  set: (subjectName) => api('/courses/set', {
    method: 'POST',
    body: JSON.stringify({ subjectName })
  })
};

export const homeworkAPI = {
  list: (status = '', page = 1, pageSize = 20) => 
    api(`/homework?status=${status}&page=${page}&pageSize=${pageSize}`),
  getTask: (taskId) => api(`/tasks/${taskId}`),
  getTaskContent: (taskId) => api(`/tasks/${taskId}/content`),
  downloadAttachment: (taskId, fileId, directory) => api(`/tasks/${taskId}/download`, {
    method: 'POST',
    body: JSON.stringify({ fileId, directory })
  }),
  submit: (taskId, data) => api(`/tasks/${taskId}/submit`, {
    method: 'POST',
    body: JSON.stringify(data)
  })
};

export const achievementAPI = {
  overview: () => api('/achievement'),
  gpa: () => api('/gpa')
};

export const messagesAPI = {
  contacts: () => api('/messages/contacts'),
  thread: (contact, size, endTime) => api('/messages/thread', {
    method: 'POST',
    body: JSON.stringify({ contact, size, endTime })
  }),
  send: (contact, content) => api('/messages/send', {
    method: 'POST',
    body: JSON.stringify({ contact, content })
  })
};

export const workspaceAPI = {
  listFiles: (query = '', maxFiles = 200) => 
    api(`/workspace/files?query=${query}&maxFiles=${maxFiles}`),
  readFile: (file, maxChars = 8000) => 
    api(`/workspace/files/${encodeURIComponent(file)}?maxChars=${maxChars}`),
  writeFile: (fileName, content, overwrite = false) => api('/workspace/files', {
    method: 'POST',
    body: JSON.stringify({ fileName, content, overwrite })
  })
};

export const dashboardAPI = {
  get: () => api('/dashboard')
};
