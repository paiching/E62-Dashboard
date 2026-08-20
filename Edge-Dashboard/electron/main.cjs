const { app, BrowserWindow, shell } = require('electron');
const path = require('node:path');

const gotLock = app.requestSingleInstanceLock();

if (!gotLock) {
  app.quit();
} else {
  let mainWindow = null;

  const createWindow = () => {
    mainWindow = new BrowserWindow({
      width: 1440,
      height: 900,
      minWidth: 1024,
      minHeight: 700,
      show: false,
      autoHideMenuBar: true,
      backgroundColor: '#f4f7fb',
      title: 'E62 Dashboard Demo',
      webPreferences: {
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
      },
    });

    const showWindow = () => {
      if (mainWindow && !mainWindow.isDestroyed() && !mainWindow.isVisible()) {
        mainWindow.show();
      }
    };
    mainWindow.once('ready-to-show', showWindow);
    // Portable builds can occasionally miss ready-to-show while extracting.
    setTimeout(showWindow, 2500);
    mainWindow.loadFile(path.join(__dirname, '..', 'dist', 'index.html'));
    mainWindow.webContents.setWindowOpenHandler(({ url }) => {
      if (url.startsWith('https://') || url.startsWith('http://')) shell.openExternal(url);
      return { action: 'deny' };
    });
    mainWindow.on('closed', () => { mainWindow = null; });
  };

  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });
  app.whenReady().then(() => {
    createWindow();
    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
  });
  app.on('window-all-closed', () => app.quit());
}
