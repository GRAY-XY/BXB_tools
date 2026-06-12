import { sessionAPI, termsAPI, coursesAPI, homeworkAPI, achievementAPI, messagesAPI, workspaceAPI, dashboardAPI } from './api/client.js';

export class App {
  constructor() {
    this.state = {
      session: null,
      currentPage: 'overview',
      dashboard: null,
      courses: [],
      homework: [],
      messages: [],
      messageThread: [],
      files: [],
      selectedTask: null,
      selectedContact: null,
      loading: false
    };
    
    this.listeners = [];
  }

  subscribe(listener) {
    this.listeners.push(listener);
    return () => {
      this.listeners = this.listeners.filter(l => l !== listener);
    };
  }

  setState(updates) {
    this.state = { ...this.state, ...updates };
    this.listeners.forEach(listener => listener(this.state));
  }

  async init() {
    await this.checkSession();
  }

  async checkSession() {
    const result = await sessionAPI.status();
    if (result.success) {
      this.setState({ session: result.data });
      if (result.data.ready) {
        await this.loadDashboard();
      }
    }
  }

  async login(username, password) {
    this.setState({ loading: true });
    try {
      const result = await sessionAPI.login(username, password);
      if (result.success) {
        await this.checkSession();
        return { success: true };
      }
      return { success: false, error: result.error };
    } catch (error) {
      return { success: false, error: error.message };
    } finally {
      this.setState({ loading: false });
    }
  }

  async logout() {
    await sessionAPI.clear();
    this.setState({ 
      session: null, 
      dashboard: null,
      currentPage: 'overview'
    });
  }

  async loadDashboard() {
    const result = await dashboardAPI.get();
    if (result.success) {
      this.setState({ dashboard: result.data });
    }
  }

  async loadCourses() {
    const result = await coursesAPI.list();
    if (result.success) {
      this.setState({ courses: result.data.subjects || [] });
    }
  }

  async setCurrentCourse(subjectName) {
    const result = await coursesAPI.set(subjectName);
    if (result.success) {
      await this.checkSession();
      await this.loadDashboard();
      // 如果在作业页，刷新作业列表
      if (this.state.currentPage === 'homework') {
        await this.loadHomework();
      }
    }
  }

  async loadHomework(status = '', page = 1) {
    const result = await homeworkAPI.list(status, page, 20);
    if (result.success) {
      this.setState({ homework: result.data.items || [] });
    }
  }

  async loadTask(taskId) {
    const result = await homeworkAPI.getTask(taskId);
    if (result.success) {
      this.setState({ 
        selectedTask: result.data,
        currentPage: 'homework'
      });
    }
  }

  async loadMessages() {
    const result = await messagesAPI.contacts();
    if (result.success) {
      this.setState({ messages: result.data.contacts || [] });
    }
  }

  async loadMessageThread(contact) {
    const result = await messagesAPI.thread(contact, 50);
    if (result.success) {
      this.setState({ 
        messageThread: result.data.messages || [],
        selectedContact: contact
      });
    }
  }

  async sendMessage(contact, content) {
    const result = await messagesAPI.send(contact, content);
    if (result.success) {
      // 重新加载消息线程
      await this.loadMessageThread(contact);
    }
    return result;
  }

  async loadFiles(query = '') {
    const result = await workspaceAPI.listFiles(query);
    if (result.success) {
      this.setState({ files: result.data.files || [] });
    }
  }

  navigateTo(page) {
    this.setState({ 
      currentPage: page,
      selectedTask: null,
      selectedContact: null,
      messageThread: []
    });
    
    // 加载页面数据
    switch(page) {
      case 'overview':
        this.loadDashboard();
        break;
      case 'homework':
        this.loadHomework();
        break;
      case 'messages':
        this.loadMessages();
        break;
      case 'files':
        this.loadFiles();
        break;
    }
  }
}
