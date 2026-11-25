const { contextBridge, ipcRenderer } = require("electron");
contextBridge.exposeInMainWorld("c62Db", {
  bootstrap: () => ipcRenderer.invoke("db:bootstrap"),
  status: () => ipcRenderer.invoke("db:status"),
  focusEditor: () => ipcRenderer.invoke("editor:focus"),
  notify: (token, body, test = false) =>
    ipcRenderer.invoke("alerts:notify", { token, body, test }),
  saveLineSettings: (token, settings) =>
    ipcRenderer.invoke("line:save", { token, settings }),
  notifyLine: (token, body, test = false) =>
    ipcRenderer.invoke("line:notify", { token, body, test }),
  cleanupHistory: (token) =>
    ipcRenderer.invoke("db:cleanup-history", { token }),
  login: (username, password) =>
    ipcRenderer.invoke("auth:login", { username, password }),
  logout: (token) => ipcRenderer.invoke("auth:logout", token),
  saveSetting: (token, key, value) =>
    ipcRenderer.invoke("settings:save", { token, key, value }),
  saveChannelLimits: (token, channelId, limits) =>
    ipcRenderer.invoke("channels:save-limits", { token, channelId, limits }),
  releaseAlarm: (token, channelId, reason, saveAsOption = false) =>
    ipcRenderer.invoke("alarms:release", {
      token,
      channelId,
      reason,
      saveAsOption,
    }),
  saveAlarmLatches: (token, latches) =>
    ipcRenderer.invoke("alarms:save-latches", { token, latches }),
  releaseReasonUsage: (token) => ipcRenderer.invoke("alarms:reason-usage", token),
  renameReleaseReason: (token, from, to) =>
    ipcRenderer.invoke("alarms:rename-reason", { token, from, to }),
  exportAlarmReleases: (token, channelId) =>
    ipcRenderer.invoke("alarms:export-releases", { token, channelId }),
  ingestSnapshot: (token, snapshot, source = "mock") =>
    ipcRenderer.invoke("readings:ingest", { token, snapshot, source }),
  syncApi: (token, persist = true) =>
    ipcRenderer.invoke("api:sync", { token, persist }),
  latestChannels: (token) => ipcRenderer.invoke("readings:latest", token),
  queryReport: (token, filter) =>
    ipcRenderer.invoke("reports:query", { token, filter }),
  exportReport: (token, filter) =>
    ipcRenderer.invoke("reports:export", { token, filter }),
  listUsers: (token) => ipcRenderer.invoke("users:list", token),
  saveUser: (token, user) => ipcRenderer.invoke("users:save", { token, user }),
  deleteUser: (token, id) => ipcRenderer.invoke("users:delete", { token, id }),
  listRoles: (token) => ipcRenderer.invoke("roles:list", token),
  saveRole: (token, role) => ipcRenderer.invoke("roles:save", { token, role }),
  deleteRole: (token, code) =>
    ipcRenderer.invoke("roles:delete", { token, code }),
});
