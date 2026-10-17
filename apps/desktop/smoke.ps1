param([ValidateSet('pos', 'admin')][string]$Variant)
$ErrorActionPreference = 'Stop'
$desktopRepo = (Resolve-Path (Join-Path $PSScriptRoot '../..')).Path
$desktopTitle = if ($Variant -eq 'pos') { 'RESTOR POS' } else { 'RESTOR Admin' }
$desktopExe = Join-Path $desktopRepo "release/desktop/$Variant/win-unpacked/$desktopTitle.exe"
$desktopOutput = Join-Path $desktopRepo 'release/desktop/verification'
$desktopPrevious = $env:RESTOR_DESKTOP_SMOKE_DIR
$desktopRunAsNode = $env:ELECTRON_RUN_AS_NODE
try {
  $env:ELECTRON_RUN_AS_NODE = $null
  $env:RESTOR_DESKTOP_SMOKE_DIR = $desktopOutput
  $desktopStarted = Get-Date
  $desktopProcess = Start-Process -FilePath $desktopExe -WindowStyle Hidden -PassThru
  if (-not $desktopProcess.WaitForExit(55000)) {
    $desktopProcess.Kill()
    throw 'Desktop smoke test timed out'
  }
  if ($desktopProcess.ExitCode -ne 0) { throw "Desktop process exited with $($desktopProcess.ExitCode)" }
  $desktopResult = Get-Item (Join-Path $desktopOutput "$Variant.json")
  if ($desktopResult.LastWriteTime -lt $desktopStarted) { throw 'Smoke output was not refreshed' }
  $desktopState = Get-Content -Raw $desktopResult.FullName | ConvertFrom-Json
  $desktopOrigin = if ($Variant -eq 'pos') { 'https://pos.restor.uz' } else { 'https://app.restor.uz' }
  if (-not $desktopState.url.StartsWith($desktopOrigin + '/')) { throw 'Unexpected app origin' }
  if ($desktopState.node -ne 'undefined') { throw 'Node was exposed to the page' }
  if ($desktopState.text -notmatch 'kirish') { throw 'Login form did not render' }
  if (-not $desktopState.preferences.sandbox -or -not $desktopState.preferences.contextIsolation -or $desktopState.preferences.nodeIntegration) { throw 'Unexpected renderer security settings' }
  Write-Output "PASS: $desktopTitle login opened with sandbox and context isolation"
  Write-Output "Screenshot: $desktopOutput/$Variant.png"
} finally {
  $env:RESTOR_DESKTOP_SMOKE_DIR = $desktopPrevious
  $env:ELECTRON_RUN_AS_NODE = $desktopRunAsNode
}
