'use strict';
const { app, BrowserWindow, ipcMain, dialog, shell, safeStorage, Menu, nativeTheme } = require('electron');
const path = require('path');
const { Store } = require('./store');
const { createApi } = require('./api');

const DEV = !!process.env.GITPILOT_DEV;
let win = null;
let core = null;

function send(channel, payload) {
  if (win && !win.isDestroyed()) win.webContents.send(channel, payload);
}

function createWindow() {
  win = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 980,
    minHeight: 600,
    title: 'GitPilot',
    backgroundColor: '#14161b',
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
    trafficLightPosition: { x: 14, y: 14 },
    webPreferences: {
      preload: path.join(__dirname, '..', 'preload', 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  if (DEV) win.loadURL('http://localhost:5173');
  else win.loadFile(path.join(__dirname, '..', '..', 'dist', 'index.html'));
  win.webContents.setWindowOpenHandler(({ url }) => { shell.openExternal(url); return { action: 'deny' }; });
  win.on('closed', () => { win = null; });
}

function buildMenu() {
  const isMac = process.platform === 'darwin';
  const template = [
    ...(isMac ? [{ role: 'appMenu' }] : []),
    {
      label: 'Archivo',
      submenu: [
        { label: 'Abrir repositorio…', accelerator: 'CmdOrCtrl+O', click: () => send('menu', 'open-repo') },
        { label: 'Clonar repositorio…', accelerator: 'CmdOrCtrl+Shift+O', click: () => send('menu', 'clone') },
        { label: 'Inicializar repositorio…', click: () => send('menu', 'init') },
        { type: 'separator' },
        { label: 'Cerrar pestaña', accelerator: 'CmdOrCtrl+W', click: () => send('menu', 'close-tab') },
        ...(isMac ? [] : [{ role: 'quit' }]),
      ],
    },
    {
      label: 'Repositorio',
      submenu: [
        { label: 'Fetch', accelerator: 'CmdOrCtrl+Shift+F', click: () => send('menu', 'fetch') },
        { label: 'Pull', accelerator: 'CmdOrCtrl+Shift+L', click: () => send('menu', 'pull') },
        { label: 'Push', accelerator: 'CmdOrCtrl+Shift+P', click: () => send('menu', 'push') },
        { type: 'separator' },
        { label: 'Refrescar', accelerator: 'CmdOrCtrl+R', click: () => send('menu', 'refresh') },
        { label: 'Perfiles de cuenta…', accelerator: 'CmdOrCtrl+,', click: () => send('menu', 'profiles') },
      ],
    },
    { role: 'editMenu' },
    { label: 'Ver', submenu: [{ role: 'toggleDevTools' }, { role: 'togglefullscreen' }, { role: 'zoomIn' }, { role: 'zoomOut' }, { role: 'resetZoom' }] },
    { role: 'windowMenu' },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

app.whenReady().then(() => {
  nativeTheme.themeSource = 'dark';
  const store = new Store(app.getPath('userData'), safeStorage);
  core = createApi({
    store,
    emit: (name, payload) => send('event', { name, payload }),
    dialogs: {
      async pickFolder(opts = {}) {
        const r = await dialog.showOpenDialog(win, { properties: ['openDirectory', 'createDirectory'], title: opts.title, defaultPath: opts.defaultPath });
        return r.canceled ? null : r.filePaths[0];
      },
      async pickFile(opts = {}) {
        const r = await dialog.showOpenDialog(win, { properties: ['openFile', 'showHiddenFiles'], title: opts.title, defaultPath: opts.defaultPath });
        return r.canceled ? null : r.filePaths[0];
      },
      openExternal: (url) => (/^https?:\/\//.test(url) ? shell.openExternal(url) : null),
      showInFinder: (p) => shell.showItemInFolder(p),
    },
  });

  ipcMain.handle('api', async (_e, method, args) => {
    const fn = core.api[method];
    if (!fn) return { ok: false, error: `Método desconocido: ${method}` };
    try {
      return { ok: true, data: await fn(...(args || [])) };
    } catch (e) {
      return { ok: false, error: e && e.message ? e.message : String(e) };
    }
  });

  buildMenu();
  createWindow();
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
});

app.on('window-all-closed', () => {
  if (core) core.shutdown();
  if (process.platform !== 'darwin') app.quit();
});
app.on('before-quit', () => { if (core) core.shutdown(); });
