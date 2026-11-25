const {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  shell,
  Notification,
  safeStorage,
} = require("electron");
const path = require("node:path");
const db = require("./database.cjs");
const { createNotifier } = require("./notifications.cjs");
const { createLineNotifier } = require("./line.cjs");
const notifyLine = createLineNotifier(db.getLineDelivery);
// Windows DPAPI: readable only by this Windows account on this computer.
db.configureSecretCodec({
  encrypt(text) {
    if (!safeStorage.isEncryptionAvailable())
      throw new Error("此電腦無法加密儲存 LINE 密碼");
    return safeStorage.encryptString(text).toString("base64");
  },
  decrypt: (text) => safeStorage.decryptString(Buffer.from(text, "base64")),
});
const notify = createNotifier(Notification, db.getAlertSettings);
if (process.platform === "win32")
  app.setAppUserModelId("tw.com.c62.dashboard.angular.demo");

let mainWindow = null;
let databasePath = "";

function registerIpc() {
  ipcMain.handle("db:bootstrap", () => ({
    settings: db.visibleSettings(),
    databasePath,
  }));
  ipcMain.handle("db:status", () => db.databaseStatus());
  ipcMain.handle("editor:focus", (event) => {
    if (
      !mainWindow ||
      mainWindow.isDestroyed() ||
      event.sender !== mainWindow.webContents ||
      !mainWindow.isFocused()
    )
      return false;
    mainWindow.webContents.focus();
    return true;
  });
  ipcMain.handle("alerts:notify", (_event, input) =>
    notify(input.token, input.body, input.test === true),
  );
  ipcMain.handle("line:save", (_event, input) =>
    db.saveLineSettings(input.token, input.settings),
  );
  ipcMain.handle("line:notify", (_event, input) =>
    notifyLine(input.token, input.body, input.test === true),
  );
  ipcMain.handle("db:cleanup-history", (_event, input) =>
    db.cleanupHistory(input.token, mainWindow, dialog),
  );
  ipcMain.handle("auth:login", (_event, input) =>
    db.login(input.username, input.password),
  );
  ipcMain.handle("auth:logout", (_event, token) => db.logout(token));
  ipcMain.handle("settings:save", (_event, input) =>
    db.saveSetting(input.token, input.key, input.value),
  );
  ipcMain.handle("channels:save-limits", (_event, input) =>
    db.saveChannelLimits(input.token, input.channelId, input.limits),
  );
  ipcMain.handle("alarms:release", (_event, input) =>
    db.releaseAlarm(
      input.token,
      input.channelId,
      input.reason,
      input.saveAsOption === true,
    ),
  );
  ipcMain.handle("alarms:save-latches", (_event, input) =>
    db.saveAlarmLatches(input.token, input.latches),
  );
  ipcMain.handle("alarms:reason-usage", (_event, token) =>
    db.releaseReasonUsage(token),
  );
  ipcMain.handle("alarms:rename-reason", (_event, input) =>
    db.renameReleaseReason(input.token, input.from, input.to),
  );
  ipcMain.handle("alarms:export-releases", (_event, input) =>
    db.exportAlarmReleases(input.token, input.channelId, mainWindow, dialog),
  );
  ipcMain.handle("readings:ingest", (_event, input) =>
    db.ingestSnapshotAuthorized(input.token, input.snapshot, input.source),
  );
  ipcMain.handle("api:sync", (_event, input) =>
    typeof input === "string"
      ? db.syncApi(input, true)
      : db.syncApi(input.token, input.persist !== false),
  );
  ipcMain.handle("readings:latest", (_event, token) =>
    db.latestSnapshot(token),
  );
  ipcMain.handle("reports:query", (_event, input) =>
    db.queryReport(input.token, input.filter),
  );
  ipcMain.handle("reports:export", (_event, input) =>
    db.exportReport(input.token, input.filter, mainWindow, dialog),
  );
  ipcMain.handle("users:list", (_event, token) => db.listUsers(token));
  ipcMain.handle("users:save", (_event, input) =>
    db.saveUser(input.token, input.user),
  );
  ipcMain.handle("users:delete", (_event, input) =>
    db.deleteUser(input.token, input.id),
  );
  ipcMain.handle("roles:list", (_event, token) => db.listRoles(token));
  ipcMain.handle("roles:save", (_event, input) =>
    db.saveRole(input.token, input.role),
  );
  ipcMain.handle("roles:delete", (_event, input) =>
    db.deleteRole(input.token, input.code),
  );
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1024,
    minHeight: 700,
    show: false,
    autoHideMenuBar: true,
    backgroundColor: "#f2f6fa",
    title: "EdgeBox",
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      backgroundThrottling: false,
    },
  });
  const showWindow = () => {
    if (mainWindow && !mainWindow.isDestroyed() && !mainWindow.isVisible())
      mainWindow.show();
  };
  mainWindow.once("ready-to-show", showWindow);
  // Restore Chromium's keyboard target when Windows returns focus to the app.
  mainWindow.on("focus", () => {
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.focus();
  });
  setTimeout(showWindow, 2500);
  mainWindow.loadFile(
    path.join(
      __dirname,
      "..",
      "dist",
      "angular-dashboard",
      "browser",
      "index.html",
    ),
  );
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/.test(url)) shell.openExternal(url);
    return { action: "deny" };
  });
  mainWindow.on("closed", () => {
    mainWindow = null;
  });
}

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.whenReady().then(() => {
    databasePath = db.initializeDatabase(
      app.getPath("userData"),
      !app.isPackaged,
    );
    registerIpc();
    createWindow();
  });
  app.on("second-instance", () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
  app.on("window-all-closed", () => app.quit());
}
