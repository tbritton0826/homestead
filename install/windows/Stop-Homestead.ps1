param([string]$InstallRoot = $PSScriptRoot)
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'Windows-Common.ps1')
$process = Get-HomesteadOwnedProcess $InstallRoot
if ($process) { Stop-Process -Id $process.Id -Force; $process.WaitForExit(10000) }
$pidPath = Join-Path $InstallRoot 'data\homestead-windows.pid'
if (Test-Path -LiteralPath $pidPath) { Remove-Item -LiteralPath $pidPath -Force }
Write-Host 'Homestead Free is stopped.'
