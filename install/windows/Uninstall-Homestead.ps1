$ErrorActionPreference = "Stop"
$installRoot = Join-Path $env:LOCALAPPDATA "Homestead Free"
$expectedRoot = [IO.Path]::GetFullPath((Join-Path $env:LOCALAPPDATA "Homestead Free"))

if ([IO.Path]::GetFullPath($installRoot) -ne $expectedRoot) {
  throw "Refusing to uninstall an unexpected folder."
}

$stopScript = Join-Path $installRoot "Stop-Homestead.ps1"
if (Test-Path -LiteralPath $stopScript) { & $stopScript }

$shortcutFolder = Join-Path ([Environment]::GetFolderPath("Programs")) "Homestead Free"
if (Test-Path -LiteralPath $shortcutFolder) { Remove-Item -LiteralPath $shortcutFolder -Recurse -Force }
$desktopShortcut = Join-Path ([Environment]::GetFolderPath("Desktop")) "Homestead Free.lnk"
if (Test-Path -LiteralPath $desktopShortcut) { Remove-Item -LiteralPath $desktopShortcut -Force }
$uninstallKey = "HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\HomesteadFree"
if (Test-Path -LiteralPath $uninstallKey) { Remove-Item -LiteralPath $uninstallKey -Recurse -Force }

Get-ChildItem -LiteralPath $installRoot -Force | Where-Object { $_.Name -notin @("data", "media") } | ForEach-Object {
  Remove-Item -LiteralPath $_.FullName -Recurse -Force
}

Write-Host "Homestead Free was removed."
Write-Host "Your data and media remain in $installRoot."
