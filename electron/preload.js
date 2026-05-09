const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("aralegal", {
  // Lock-screen flow
  getState: () => ipcRenderer.invoke("aralegal:getState"),
  pickWorkspace: () => ipcRenderer.invoke("aralegal:pickWorkspace"),
  setPassword: (password) => ipcRenderer.invoke("aralegal:setPassword", password),
  unlock: (password) => ipcRenderer.invoke("aralegal:unlock", password),

  // Post-unlock — used by the supabase shim and any code needing the API URL
  getToken: () => ipcRenderer.invoke("aralegal:getToken"),
  getUser: () => ipcRenderer.invoke("aralegal:getUser"),
  getApiPort: () => ipcRenderer.invoke("aralegal:getApiPort"),
  signOut: () => ipcRenderer.invoke("aralegal:signOut"),
  changePassword: (oldPassword, newPassword) =>
    ipcRenderer.invoke("aralegal:changePassword", oldPassword, newPassword),
});
