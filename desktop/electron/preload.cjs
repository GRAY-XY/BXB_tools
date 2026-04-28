const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("bxb", {
  getAppInfo: () => ipcRenderer.invoke("app:info"),
  getSession: () => ipcRenderer.invoke("bxb:session"),
  callTool: (name, args = {}) => ipcRenderer.invoke("bxb:tool", { name, args }),
  loadModelConfig: () => ipcRenderer.invoke("config:model:load"),
  saveModelConfig: (config) => ipcRenderer.invoke("config:model:save", config),
  clearModelConfig: () => ipcRenderer.invoke("config:model:clear"),
  testModelConfig: (config) => ipcRenderer.invoke("config:model:test", config),
  chat: (payload) => ipcRenderer.invoke("agent:chat", payload),
  resetChat: () => ipcRenderer.invoke("agent:reset"),
  onAgentProgress: (callback) => {
    const listener = (_event, payload) => callback(payload);
    ipcRenderer.on("agent:progress", listener);
    return () => ipcRenderer.removeListener("agent:progress", listener);
  },
});
