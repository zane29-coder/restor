# RESTOR Windows apps

Separate Windows 10/11 x64 installers for POS and Admin. Each opens the
production HTTPS app in its own sandboxed Electron window, with a separate
persistent session. No backend, credentials or tenant configuration is bundled.
Sign in using the normal restaurant account.

The first launch requires internet. This is a server-connected client, not a
local server: a cold launch without internet shows a retry screen. POS's existing
in-session offline queue remains in the persistent app profile; restarting or
upgrading does not clear it. Closing the app while offline does not make the
server receive those orders. Reopen with internet to sync. Do not remove the
profile or switch user before syncing pending orders.

## Build on Windows

The desktop builder is independent of the npm workspaces, so CI for the web/API
does not download Electron or build installers. No shared package build is
needed here because it loads the deployed apps rather than bundling a web build.

```powershell
npm.cmd --prefix apps/desktop ci --ignore-scripts
npm.cmd --prefix apps/desktop test
npm.cmd run build:desktop
# Optional: only one app
node apps/desktop/build.cjs pos
node apps/desktop/build.cjs admin
```

Requires Node 22+ and network access for Electron and NSIS build downloads.
If the Electron downloader stalls on this network, download the matching
official Electron ZIP and `SHASUMS256.txt` with curl, verify its SHA256, extract
it, and set `RESTOR_ELECTRON_DIST` to that directory before building.
Output: `release/desktop/{pos,admin}/RESTOR-*-Setup-0.1.0-x64.exe`.
NSIS installers install for the current Windows user, offer the installation
directory, and create Desktop/Start menu shortcuts. App data is retained on
uninstall to avoid deleting offline POS orders accidentally.

## Use

- Open the app and sign in with restaurant slug, phone and password.
- F11: toggle fullscreen. Alt: show the application menu.
- Ctrl+R: refresh; Ctrl+P: native Windows print dialog.
- Set up the receipt printer with its Windows driver. The web receipt's print
  stylesheet and `window.print()` still work. Fiscal-device integration and
  silent printing are not added by this wrapper.
- Web changes appear from the server automatically. Updates to the Electron
  runtime itself require installing a newer desktop release.

Current packages are unsigned. Windows may display an unknown publisher warning.
Code signing requires the owner's signing certificate; none is generated or
bundled. Keep Electron current and rebuild regularly.

The NSIS include supplies Uzbek messages with language ID 1091. The pinned
builder maps Uzbek to 2115 and its bundled NSIS language lacks several
MultiUser strings, so `warningsAsErrors` is disabled for those localization
fallback warnings. The custom header provides the missing Uzbek strings.

## Verify a packaged app

Set `RESTOR_DESKTOP_SMOKE_DIR` to an absolute directory and run the unpacked
EXE. It runs hidden, loads the production login page without signing in, records
the URL/text/web preferences and a screenshot, then exits. The test must show
the intended app origin, no `require` in the renderer, and sandbox/context
isolation enabled. This does not test physical printers or real sales.

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File apps/desktop/smoke.ps1 pos
powershell -NoProfile -ExecutionPolicy Bypass -File apps/desktop/smoke.ps1 admin
```
