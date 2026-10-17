const { app, BrowserWindow, Menu, dialog, shell } = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const { SITES, isAppUrl, isExternalUrl, allowPermission } = require('./policy.cjs');
const { variant } = require('./desktop-config.json');
const site = SITES[variant];
if (!site) throw new Error('Unknown desktop variant');

// Separate persistent profiles prevent one app from sharing the other's
// tokens, and preserve the POS queue across normal restarts and upgrades.
app.setName(site.title);
app.setPath('userData', path.join(app.getPath('appData'), site.title));
app.setAppUserModelId(site.appId);
const smokeDir = process.env.RESTOR_DESKTOP_SMOKE_DIR;
let window;

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (window?.isMinimized()) window.restore();
    window?.focus();
  });
  app.whenReady().then(start);
}

async function start() {
  window = new BrowserWindow({
    title: site.title,
    width: 1440, height: 960, minWidth: 800, minHeight: 600,
    backgroundColor: '#f3f4f6', show: false,
    autoHideMenuBar: true,
    icon: path.join(__dirname, 'icon.ico'),
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      webSecurity: true,
      allowRunningInsecureContent: false,
      webviewTag: false,
      devTools: !app.isPackaged,
    },
  });
  if (!smokeDir) window.once('ready-to-show', () => { window.maximize(); window.show(); });
  const contents = window.webContents;
  const session = contents.session;
  session.setPermissionRequestHandler((webContents, permission, callback, details) => {
    callback(isAppUrl(webContents.getURL(), site.origin) && allowPermission(permission, details.requestingUrl, site.origin));
  });
  session.setPermissionCheckHandler((webContents, permission, requestingOrigin) =>
    Boolean(webContents && isAppUrl(webContents.getURL(), site.origin) && allowPermission(permission, requestingOrigin, site.origin)));
  session.on('will-download', (_event, item) => {
    // Keep the native Save dialog for CSV/report exports; never auto-open files.
    item.setSaveDialogOptions({ title: 'Faylni saqlash' });
  });
  contents.on('will-attach-webview', event => event.preventDefault());
  for (const eventName of ['will-navigate', 'will-frame-navigate', 'will-redirect']) {
    contents.on(eventName, (event, url) => {
      if (!isAppUrl(event.url ?? url, site.origin)) event.preventDefault();
    });
  }
  contents.setWindowOpenHandler(({ url }) => {
    if (isExternalUrl(url)) void shell.openExternal(url).catch(() => undefined);
    return { action: 'deny' };
  });

  const home = () => void contents.loadURL(site.origin).catch(() => undefined);
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    { label: 'Dastur', submenu: [
      { label: 'Bosh sahifa', click: home },
      { label: 'Yangilash', accelerator: 'CmdOrCtrl+R', click: () => contents.reload() },
      { label: 'To‘liq ekran', accelerator: 'F11', click: () => window.setFullScreen(!window.isFullScreen()) },
      { label: 'Chop etish', accelerator: 'CmdOrCtrl+P', click: () => contents.print({}, (ok, reason) => {
        if (!ok && reason !== 'cancelled') void dialog.showMessageBox(window, { type: 'error', title: site.title, message: 'Chop etilmadi. Printerni tekshirib, qayta urinib ko‘ring.' });
      }) },
      { type: 'separator' }, { label: 'Chiqish', click: () => app.quit() },
    ] },
    { label: 'Tahrirlash', submenu: [
      { label: 'Bekor qilish', role: 'undo' }, { label: 'Qaytarish', role: 'redo' },
      { type: 'separator' }, { label: 'Kesish', role: 'cut' }, { label: 'Nusxalash', role: 'copy' },
      { label: 'Joylashtirish', role: 'paste' }, { label: 'Barchasini tanlash', role: 'selectAll' },
    ] },
    { label: 'Yordam', submenu: [{ label: 'Dastur haqida', click: () => void dialog.showMessageBox(window, {
      title: site.title, message: `${site.title} ${app.getVersion()}`,
      detail: 'Windows 10/11 (64-bit)\nRESTOR serveriga ulanadi. Dastlab ochishda internet talab qilinadi.\nMenyu: Alt · To‘liq ekran: F11',
    }) }] },
  ]));

  contents.on('did-fail-load', (_event, code, _description, _url, isMainFrame) => {
    if (!isMainFrame || code === -3) return;
    if (smokeDir) return finishSmoke(new Error(`Page load failed: ${code}`));
    void window.loadFile(path.join(__dirname, 'offline.html'), { query: { origin: site.origin, title: site.title } });
  });
  if (smokeDir) {
    const timeout = setTimeout(() => finishSmoke(new Error('Page load timed out')), 45_000);
    contents.once('did-finish-load', async () => {
      clearTimeout(timeout);
      try {
        await new Promise(resolve => setTimeout(resolve, 2500));
        const screenshot = await contents.capturePage();
        fs.mkdirSync(smokeDir, { recursive: true });
        fs.writeFileSync(path.join(smokeDir, `${variant}.png`), screenshot.toPNG());
        const state = await contents.executeJavaScript('({title:document.title, text:document.body.innerText.slice(0,1000), node:typeof require})');
        fs.writeFileSync(path.join(smokeDir, `${variant}.json`), JSON.stringify({ url: contents.getURL(), ...state, preferences: contents.getLastWebPreferences() }, null, 2));
        finishSmoke();
      } catch (error) { finishSmoke(error); }
    });
  }
  home();
}

function finishSmoke(error) {
  if (error) {
    fs.mkdirSync(smokeDir, { recursive: true });
    fs.writeFileSync(path.join(smokeDir, `${variant}-error.txt`), error.message);
  }
  app.exit(error ? 1 : 0);
}
app.on('window-all-closed', () => app.quit());
