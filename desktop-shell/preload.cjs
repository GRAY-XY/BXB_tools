const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("bxbApp", {
  loadDashboard: () => ipcRenderer.invoke("dashboard:load"),
  login: () => ipcRenderer.invoke("session:login"),
  logout: () => ipcRenderer.invoke("session:logout"),
  setSubject: (subjectName) => ipcRenderer.invoke("subject:set", subjectName),
  openTask: (taskId) => ipcRenderer.invoke("task:open", taskId),
  submitTask: (payload) => ipcRenderer.invoke("task:submit", payload),
  pickFiles: () => ipcRenderer.invoke("files:pick"),
  openExternal: (url) => ipcRenderer.invoke("shell:open-external", url),
  window: {
    minimize: () => ipcRenderer.invoke("window:minimize"),
    toggleMaximize: () => ipcRenderer.invoke("window:toggle-maximize"),
    close: () => ipcRenderer.invoke("window:close"),
    isMaximized: () => ipcRenderer.invoke("window:is-maximized"),
    onStateChange: (callback) => {
      const handler = (_event, state) => callback(state);
      ipcRenderer.on("window-state", handler);
      return () => ipcRenderer.removeListener("window-state", handler);
    },
  },
});
