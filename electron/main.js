const { app, BrowserWindow, Tray, Menu, shell } = require('electron');
const path = require('node:path');
const fs = require('node:fs');

let win = null;
let tray = null;

function normalizePath(p) {
  return p.split(path.sep).join(path.posix.sep);
}

function getClientIndexPath() {
  // Dev layout, built frontend: electron/../client/dist (npm run client:build at
  // the repo root). The build is what ships, so it is preferred over the raw
  // source, whose pages now load their scripts as ES modules.
  const builtPath = path.join(__dirname, '../client/dist/index.html');
  if (fs.existsSync(builtPath)) {
    return normalizePath(builtPath);
  }
  // Legacy dev layout: electron/../client
  const devPath = path.join(__dirname, '../client/index.html');
  if (fs.existsSync(devPath)) {
    return normalizePath(devPath);
  }
  // Packaged layout: electron/client (files copied into app)
  const prodPath = path.join(__dirname, 'client/index.html');
  if (fs.existsSync(prodPath)) {
    return normalizePath(prodPath);
  }
  // Fallback to resources path – in-app copy
  const resourcesPath = process.resourcesPath;
  const fallbackApp = path.join(resourcesPath, 'app/client/index.html');
  if (fs.existsSync(fallbackApp)) {
    return normalizePath(fallbackApp);
  }
  // Fallback to extraResources – electron-builder extraResources
  const fallbackExtra = path.join(resourcesPath, 'extraResources/client/index.html');
  if (fs.existsSync(fallbackExtra)) {
    return normalizePath(fallbackExtra);
  }
  return normalizePath(devPath); // let Electron error if missing
}

function createWindow () {
  win = new BrowserWindow({
    width: 1200,
    height: 800,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      enableRemoteModule: false,
      nodeIntegration: false
    }
  });

  // Load the existing SPA from local client folder
  const clientIndex = getClientIndexPath();
  console.log('Loading client index from:', clientIndex);
  win.loadFile(clientIndex);

  win.webContents.on('did-finish-load', () => {
    console.log('Page loaded successfully');
    win.show();
  });

  win.webContents.on('did-fail-load', (event, errorCode, errorDescription, validatedURL) => {
    console.error('Failed to load:', errorCode, errorDescription, validatedURL);
  });

  win.webContents.on('console-message', (event, level, message, line, sourceId) => {
    console.log(`Renderer [${level}]: ${message}`);
  });
  
  // Hide window instead of closing on minimize
  win.on('close', (e) => {
    if (!app.isQuitting) {
      e.preventDefault();
      win.hide();
    }
  });
}

function createTray() {
  const iconPath = path.join(__dirname, 'resources', 'icon.png');
  // Fallback tray creation if icon missing
  if (!fs.existsSync(iconPath)) {
    console.warn('Tray icon not found, creating tray without icon');
    tray = new Tray(null);
  } else {
    tray = new Tray(iconPath);
  }
  
  const contextMenu = Menu.buildFromTemplate([
    {
      label: 'Show App',
      click: () => {
        win.show();
        win.focus();
      }
    },
    { type: 'separator' },
    {
      label: 'Quit',
      click: () => {
        app.isQuitting = true;
        app.quit();
      }
    }
  ]);
  
  tray.setToolTip('LGU System Admin');
  tray.setContextMenu(contextMenu);
  
  tray.on('click', () => {
    if (win.isVisible()) {
      win.hide();
    } else {
      win.show();
      win.focus();
    }
  });
}

app.whenReady().then(() => {
  createWindow();
  createTray();
  
  // Create native menu
  const isMac = process.platform === 'darwin';
  const template = [
    ...(isMac ? [{
      label: app.name,
      submenu: [
        { role: 'about' },
        { type: 'separator' },
        { role: 'services' },
        { type: 'separator' },
        { role: 'hide' },
        { role: 'hideOthers' },
        { role: 'unhide' },
        { type: 'separator' },
        { role: 'quit' }
      ]
    }] : []),
    {
      label: 'File',
      submenu: [
        { label: 'Show App', click: () => { win.show(); win.focus(); } },
        { type: 'separator' },
        isMac ? { role: 'closeWindow' } : { role: 'quit' }
      ]
    },
    {
      label: 'Edit',
      submenu: [
        { role: 'undo' },
        { role: 'redo' },
        { type: 'separator' },
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' },
        ...(isMac ? [
          { role: 'pasteAndMatchStyle' },
          { role: 'deleteAndSelect' },
          { type: 'separator' },
          { role: 'selectAll' }
        ] : [
          { role: 'delete' },
          { type: 'separator' },
          { role: 'selectAll' }
        ])
      ]
    },
    {
      label: 'View',
      submenu: [
        { role: 'reload' },
        { role: 'forceReload' },
        { role: 'toggleDevTools' },
        { type: 'separator' },
        { role: 'resetZoom' },
        { role: 'zoomIn' },
        { role: 'zoomOut' },
        { type: 'separator' },
        { role: 'togglefullscreen' }
      ]
    },
    {
      label: 'Window',
      submenu: [
        { role: 'minimize' },
        { role: 'zoom' },
        ...(isMac ? [
          { role: 'front' },
          { type: 'separator' },
          { role: 'window' }
        ] : [
          { role: 'close' }
        ])
      ]
    },
    {
      label: 'Help',
      submenu: [
        {
          label: 'Learn More',
          click: async () => {
            await shell.openExternal('https://github.com');
          }
        },
        { role: 'about' }
      ]
    }
  ];
  
  const menu = Menu.buildFromTemplate(template);
  Menu.setApplicationMenu(menu);

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.isQuitting = true;
    app.quit();
  }
});