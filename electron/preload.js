const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("mike", {
  // Lock-screen flow
  getState: () => ipcRenderer.invoke("mike:getState"),
  pickWorkspace: () => ipcRenderer.invoke("mike:pickWorkspace"),
  setPassword: (password) => ipcRenderer.invoke("mike:setPassword", password),
  unlock: (password) => ipcRenderer.invoke("mike:unlock", password),

  // Post-unlock — used by the supabase shim and any code needing the API URL
  getToken: () => ipcRenderer.invoke("mike:getToken"),
  getUser: () => ipcRenderer.invoke("mike:getUser"),
  getApiPort: () => ipcRenderer.invoke("mike:getApiPort"),
});
