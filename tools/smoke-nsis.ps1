# Runs only on disposable Windows CI runners; never on an ordinary workstation.
$ErrorActionPreference = 'Stop'
if ($env:CI -ne 'true' -or $env:RUNNER_OS -ne 'Windows' -or -not $env:RUNNER_TEMP) {
  throw 'NSIS smoke tests require a disposable Windows CI runner.'
}
$root = Split-Path $PSScriptRoot -Parent
$installers = @(Get-ChildItem (Join-Path $root 'dist') -Filter 'Mechvibes-*-x64.exe' -File)
if ($installers.Count -ne 1) { throw 'Expected exactly one x64 NSIS installer.' }
$installDir = Join-Path $env:RUNNER_TEMP ('mechvibes-smoke-' + [guid]::NewGuid())
$customDir = Join-Path $env:APPDATA 'mechvibes\custom'
$fixture = Join-Path $customDir ('ci-preservation-' + [guid]::NewGuid() + '.txt')
$uninstaller = Join-Path $installDir 'Uninstall Mechvibes.exe'

function Invoke-CheckedInstaller([string]$File, [string]$Arguments) {
  $process = Start-Process -FilePath $File -ArgumentList $Arguments -PassThru
  if (-not $process.WaitForExit(180000)) {
    Stop-Process -Id $process.Id -Force -ErrorAction SilentlyContinue
    throw 'Installer smoke test exceeded its three-minute process timeout.'
  }
  $process.Refresh()
  if ($process.ExitCode -notin @(0, 3010)) { throw "Installer failed with exit code $($process.ExitCode)" }
}

try {
  New-Item -ItemType Directory -Path $customDir -Force | Out-Null
  Set-Content -LiteralPath $fixture -Value 'preserve-me' -NoNewline
  # /D must be the final NSIS argument; it intentionally consumes the remaining path.
  $arguments = "/S /currentuser /D=$installDir"
  Invoke-CheckedInstaller $installers[0].FullName $arguments
  foreach ($file in @('Mechvibes.exe', 'resources\app.asar', 'LICENSE.Mechvibes.txt', 'LICENSE.upstream.txt', 'NOTICE.Mechvibes.txt')) {
    if (-not (Test-Path -LiteralPath (Join-Path $installDir $file))) { throw "Missing installed file: $file" }
  }
  Invoke-CheckedInstaller $installers[0].FullName $arguments
  if ((Get-Content -LiteralPath $fixture -Raw) -ne 'preserve-me') { throw 'Reinstallation changed user data.' }
  # _?= keeps the uninstaller in this process, so waiting really waits for removal.
  Invoke-CheckedInstaller $uninstaller "/S /currentuser _?=$installDir"
  if (Test-Path -LiteralPath (Join-Path $installDir 'Mechvibes.exe')) { throw 'Uninstaller left the application installed.' }
  if ((Get-Content -LiteralPath $fixture -Raw) -ne 'preserve-me') { throw 'Uninstallation changed user data.' }
  Write-Output 'NSIS install, reinstall, uninstall and user-data preservation checks passed.'
} finally {
  if (Test-Path -LiteralPath (Join-Path $installDir 'Mechvibes.exe')) {
    if (Test-Path -LiteralPath $uninstaller) { Invoke-CheckedInstaller $uninstaller "/S /currentuser _?=$installDir" }
  }
  Remove-Item -LiteralPath $fixture -Force -ErrorAction SilentlyContinue
  Remove-Item -LiteralPath $installDir -Recurse -Force -ErrorAction SilentlyContinue
}
