const { build, Platform, Arch } = require('electron-builder');
const fs = require('node:fs');
const path = require('node:path');
const { SITES } = require('./policy.cjs');
const root = path.resolve(__dirname, '../..');
// Keep rebuilds practical; higher LZMA levels save little on Chromium binaries.
process.env.ELECTRON_BUILDER_COMPRESSION_LEVEL ??= '3';

(async () => {
  const requested = process.argv[2];
  if (requested && !SITES[requested]) throw new Error('Use pos or admin');
  for (const variant of requested ? [requested] : Object.keys(SITES)) {
    const site = SITES[variant];
    const stage = path.join(__dirname, 'out', variant);
    fs.mkdirSync(stage, { recursive: true });
    for (const name of ['main.cjs', 'policy.cjs', 'offline.html', 'offline.js', 'icon.ico']) fs.copyFileSync(path.join(__dirname, name), path.join(stage, name));
    fs.writeFileSync(path.join(stage, 'desktop-config.json'), JSON.stringify({ variant }));
    fs.writeFileSync(path.join(stage, 'package.json'), JSON.stringify({ name: `restor-${variant}`, version: '0.1.0', main: 'main.cjs', description: `${site.title} Windows application`, author: 'RESTOR', license: 'UNLICENSED' }, null, 2));
    await build({
      targets: Platform.WINDOWS.createTarget(['nsis'], Arch.x64),
      projectDir: __dirname,
      config: {
        appId: site.appId, productName: site.title, electronVersion: require('./package.json').devDependencies.electron,
        ...(process.env.RESTOR_ELECTRON_DIST ? { electronDist: path.resolve(process.env.RESTOR_ELECTRON_DIST) } : {}),
        directories: { app: stage, output: path.join(root, 'release', 'desktop', variant) },
        files: ['**/*'], asar: true, npmRebuild: false,
        win: { icon: path.join(__dirname, 'icon.ico'), signExecutable: false, artifactName: `RESTOR-${variant.toUpperCase()}-Setup-\${version}-\${arch}.exe` },
        nsis: { oneClick: false, perMachine: false, allowElevation: false, allowToChangeInstallationDirectory: true, createDesktopShortcut: true, createStartMenuShortcut: true, shortcutName: site.title, runAfterFinish: false, deleteAppDataOnUninstall: false, installerLanguages: ['uz_UZ'], language: '1091', include: path.join(__dirname, 'installer.nsh'), warningsAsErrors: false },
      },
    });
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
