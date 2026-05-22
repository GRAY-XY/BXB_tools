const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("bxb", {
  getAppInfo: () => ipcRenderer.invoke("app:info"),
  openAppPath: (key) => ipcRenderer.invoke("app:open-path", { key }),
  getSession: () => ipcRenderer.invoke("bxb:session"),
  callTool: (name, args = {}) => ipcRenderer.invoke("bxb:tool", { name, args }),
  importWorkspaceFiles: () => ipcRenderer.invoke("workspace:import"),
  openWorkspaceFolder: () => ipcRenderer.invoke("workspace:open"),
  getWorkspaceImageDataUrl: (filePath) => ipcRenderer.invoke("workspace:image-data-url", { filePath }),
  checkForUpdates: () => ipcRenderer.invoke("update:check"),
  downloadUpdate: () => ipcRenderer.invoke("update:download"),
  installUpdate: () => ipcRenderer.invoke("update:install"),
  cancelUpdateDownload: () => ipcRenderer.invoke("update:cancel"),
  getUpdateStatus: () => ipcRenderer.invoke("update:status"),
  openUpdateUrl: (url) => ipcRenderer.invoke("update:open-url", { url }),
  loadModelConfig: () => ipcRenderer.invoke("config:model:load"),
  saveModelConfig: (config) => ipcRenderer.invoke("config:model:save", config),
  clearModelConfig: () => ipcRenderer.invoke("config:model:clear"),
  listModelOptions: (config) => ipcRenderer.invoke("config:model:list", config),
  testModelConfig: (config) => ipcRenderer.invoke("config:model:test", config),
  chat: (payload) => ipcRenderer.invoke("agent:chat", payload),
  compactChat: (payload = {}) => ipcRenderer.invoke("agent:compact", payload),
  listConversations: () => ipcRenderer.invoke("agent:conversations:list"),
  createConversation: (payload = {}) => ipcRenderer.invoke("agent:conversations:create", payload),
  selectConversation: (conversationId) => ipcRenderer.invoke("agent:conversations:select", { conversationId }),
  renameConversation: (conversationId, title) => ipcRenderer.invoke("agent:conversations:rename", { conversationId, title }),
  deleteConversation: (conversationId) => ipcRenderer.invoke("agent:conversations:delete", { conversationId }),
  resetChat: () => ipcRenderer.invoke("agent:reset"),
  onAgentProgress: (callback) => {
    const listener = (_event, payload) => callback(payload);
    ipcRenderer.on("agent:progress", listener);
    return () => ipcRenderer.removeListener("agent:progress", listener);
  },
  onUpdateProgress: (callback) => {
    const listener = (_event, payload) => callback(payload);
    ipcRenderer.on("update:progress", listener);
    return () => ipcRenderer.removeListener("update:progress", listener);
  },
});
