const { app, BrowserWindow, dialog, ipcMain, shell } = require('electron');
const path = require('node:path');
const db = require('./database.cjs');

let mainWindow = null;
let databasePath = '';

function registerIpc() {
  ipcMain.handle('db:bootstrap', () => ({ settings: db.settingsObject(), databasePath }));
  ipcMain.handle('auth:login', (_event, input) => db.login(input.username, input.password));
  ipcMain.handle('auth:logout', (_event, token) => db.logout(token));
  ipcMain.handle('settings:save', (_event, input) => db.saveSetting(input.token, input.key, input.value));
  ipcMain.handle('readings:ingest', (_event, input) => db.ingestSnapshotAuthorized(input.token, input.snapshot, input.source));
  ipcMain.handle('api:sync', (_event, token) => db.syncApi(token));
  ipcMain.handle('readings:latest', (_event, token) => db.latestSnapshot(token));
  ipcMain.handle('reports:query', (_event, input) => db.queryReport(input.token, input.filter));
  ipcMain.handle('reports:export', (_event, input) => db.exportReport(input.token, input.filter, mainWindow, dialog));
  ipcMain.handle('users:list', (_event, token) => db.listUsers(token));
  ipcMain.handle('users:save', (_event, input) => db.saveUser(input.token, input.user));
  ipcMain.handle('users:delete', (_event, input) => db.deleteUser(input.token, input.id));
  ipcMain.handle('roles:list', (_event, token) => db.listRoles(token));
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1024,
    minHeight: 700,
    show: false,
    autoHideMenuBar: true,
    backgroundColor: '#f2f6fa',
    title: 'E62 Angular Dashboard',
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  const showWindow = () => {
    if (mainWindow && !mainWindow.isDestroyed() && !mainWindow.isVisible()) mainWindow.show();
  };
  mainWindow.once('ready-to-show', showWindow);
  setTimeout(showWindow, 2500);
  mainWindow.loadFile(path.join(__dirname, '..', 'dist', 'angular-dashboard', 'browser', 'index.html'));
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  mainWindow.on('closed', () => { mainWindow = null; });
}

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.whenReady().then(() => {
    databasePath = db.initializeDatabase(app.getPath('userData'));
    registerIpc();
    createWindow();
  });
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
  app.on('window-all-closed', () => app.quit());
}
