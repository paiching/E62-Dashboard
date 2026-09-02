const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('e62Db', {
  bootstrap: () => ipcRenderer.invoke('db:bootstrap'),
  login: (username,password) => ipcRenderer.invoke('auth:login',{username,password}),
  logout: (token) => ipcRenderer.invoke('auth:logout',token),
  saveSetting: (token,key,value) => ipcRenderer.invoke('settings:save',{token,key,value}),
  ingestSnapshot: (token,snapshot,source='mock') => ipcRenderer.invoke('readings:ingest',{token,snapshot,source}),
  syncApi: (token) => ipcRenderer.invoke('api:sync',token),
  latestChannels: (token) => ipcRenderer.invoke('readings:latest',token),
  queryReport: (token,filter) => ipcRenderer.invoke('reports:query',{token,filter}),
  exportReport: (token,filter) => ipcRenderer.invoke('reports:export',{token,filter}),
  listUsers: (token) => ipcRenderer.invoke('users:list',token),
  saveUser: (token,user) => ipcRenderer.invoke('users:save',{token,user}),
  deleteUser: (token,id) => ipcRenderer.invoke('users:delete',{token,id}),
  listRoles: (token) => ipcRenderer.invoke('roles:list',token),
});
