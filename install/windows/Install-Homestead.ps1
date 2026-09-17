$ErrorActionPreference = "Stop"

$installRoot = Join-Path $env:LOCALAPPDATA "Homestead Free"
$runtimeArchive = Join-Path $PSScriptRoot "homestead-windows-runtime.zip"
$logPath = Join-Path $env:TEMP "Homestead-Free-Install.log"
$transcriptStarted = $false

try {
  Start-Transcript -LiteralPath $logPath -Append | Out-Null
  $transcriptStarted = $true
} catch {}

trap {
  $failureMessage = $_.Exception.Message
  Write-Host ""
  Write-Host "Homestead Free could not be installed: $failureMessage" -ForegroundColor Red
  Write-Host "Install log: $logPath" -ForegroundColor Yellow
  if ($transcriptStarted) {
    try { Stop-Transcript | Out-Null } catch {}
    $transcriptStarted = $false
  }
  try {
    Add-Type -AssemblyName PresentationFramework
    [System.Windows.MessageBox]::Show(
      "Homestead Free could not be installed.`n`n$failureMessage`n`nInstall log:`n$logPath",
      "Homestead Free Setup",
      [System.Windows.MessageBoxButton]::OK,
      [System.Windows.MessageBoxImage]::Error
    ) | Out-Null
  } catch {}
  exit 1
}

Write-Host "Homestead Free Preview" -ForegroundColor Cyan
Write-Host "Installing the self-contained Windows application to:"
Write-Host $installRoot -ForegroundColor Yellow
Write-Host ""

if (-not (Test-Path -LiteralPath $runtimeArchive)) {
  throw "The embedded Homestead Windows runtime is missing from this installer."
}

$existingStop = Join-Path $installRoot "Stop-Homestead.ps1"
if (Test-Path -LiteralPath $existingStop) {
  try { & powershell.exe -NoProfile -ExecutionPolicy Bypass -File $existingStop } catch {}
}

New-Item -ItemType Directory -Force -Path $installRoot | Out-Null
New-Item -ItemType Directory -Force -Path (Join-Path $installRoot "data") | Out-Null
New-Item -ItemType Directory -Force -Path (Join-Path $installRoot "media") | Out-Null
New-Item -ItemType Directory -Force -Path (Join-Path $installRoot "logs") | Out-Null
Expand-Archive -LiteralPath $runtimeArchive -DestinationPath $installRoot -Force

foreach ($fileName in @(
  "Start Homestead.cmd",
  "Stop Homestead.cmd",
  "Start-Homestead.ps1",
  "Stop-Homestead.ps1",
  "Uninstall-Homestead.ps1"
)) {
  Copy-Item -LiteralPath (Join-Path $PSScriptRoot $fileName) -Destination (Join-Path $installRoot $fileName) -Force
}

foreach ($required in @("node.exe", "server.cjs", "dist\index.html", "Start-Homestead.ps1")) {
  if (-not (Test-Path -LiteralPath (Join-Path $installRoot $required))) {
    throw "The installed Windows runtime is incomplete: $required"
  }
}

$programsFolder = [Environment]::GetFolderPath("Programs")
$shortcutFolder = Join-Path $programsFolder "Homestead Free"
New-Item -ItemType Directory -Force -Path $shortcutFolder | Out-Null
$shell = New-Object -ComObject WScript.Shell

function New-HomesteadShortcut([string]$shortcutPath, [string]$targetName) {
  $shortcut = $shell.CreateShortcut($shortcutPath)
  $shortcut.TargetPath = Join-Path $installRoot $targetName
  $shortcut.WorkingDirectory = $installRoot
  $shortcut.Save()
}

New-HomesteadShortcut (Join-Path $shortcutFolder "Homestead Free.lnk") "Start Homestead.cmd"
New-HomesteadShortcut (Join-Path $shortcutFolder "Stop Homestead.lnk") "Stop Homestead.cmd"
New-HomesteadShortcut (Join-Path $shortcutFolder "Uninstall Homestead Free.lnk") "Uninstall-Homestead.ps1"
New-HomesteadShortcut (Join-Path ([Environment]::GetFolderPath("Desktop")) "Homestead Free.lnk") "Start Homestead.cmd"

$uninstallKey = "HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\HomesteadFree"
New-Item -Path $uninstallKey -Force | Out-Null
Set-ItemProperty -Path $uninstallKey -Name DisplayName -Value "Homestead Free"
Set-ItemProperty -Path $uninstallKey -Name DisplayVersion -Value "0.6.8.64"
Set-ItemProperty -Path $uninstallKey -Name Publisher -Value "Homestead"
Set-ItemProperty -Path $uninstallKey -Name InstallLocation -Value $installRoot
Set-ItemProperty -Path $uninstallKey -Name NoModify -Value 1 -Type DWord
Set-ItemProperty -Path $uninstallKey -Name UninstallString -Value "powershell.exe -NoProfile -ExecutionPolicy Bypass -File `"$(Join-Path $installRoot 'Uninstall-Homestead.ps1')`""

& powershell.exe -NoProfile -ExecutionPolicy Bypass -File (Join-Path $installRoot "Start-Homestead.ps1") -NoBrowser -WaitForReady
if ($LASTEXITCODE -ne 0) { throw "Homestead was installed, but its Windows background process did not start." }

Write-Host ""
Write-Host "Homestead Free is ready." -ForegroundColor Green
if ($transcriptStarted) {
  try { Stop-Transcript | Out-Null } catch {}
  $transcriptStarted = $false
}
try {
  Add-Type -AssemblyName PresentationFramework
  [System.Windows.MessageBox]::Show(
    "Homestead Free is installed and running. Your browser will open now.",
    "Homestead Free Setup",
    [System.Windows.MessageBoxButton]::OK,
    [System.Windows.MessageBoxImage]::Information
  ) | Out-Null
} catch {}
Start-Process "http://localhost:7312"
