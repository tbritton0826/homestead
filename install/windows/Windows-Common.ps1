$ErrorActionPreference = 'Stop'
function Get-HomesteadRuntime([string]$InstallRoot) {
  $configuration = Join-Path $InstallRoot 'runtime.json'
  if (-not (Test-Path -LiteralPath $configuration)) { return @{ AppRoot = $InstallRoot; Port = 7312; Instance = '' } }
  $saved = Get-Content -LiteralPath $configuration -Raw | ConvertFrom-Json
  if ($saved.relativePath -notmatch '^versions/[a-zA-Z0-9._-]+$') { throw 'The saved Homestead runtime path is invalid.' }
  if ([int]$saved.port -lt 1024 -or [int]$saved.port -gt 65535) { throw 'The saved Homestead port is invalid.' }
  $appRoot = [IO.Path]::GetFullPath((Join-Path $InstallRoot $saved.relativePath))
  if (-not $appRoot.StartsWith([IO.Path]::GetFullPath($InstallRoot) + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase)) { throw 'The runtime is outside the installation.' }
  return @{ AppRoot = $appRoot; Port = [int]$saved.port; Instance = [string]$saved.instance }
}
function Get-HomesteadOwnedProcess([string]$InstallRoot) {
  $pidPath = Join-Path $InstallRoot 'data\homestead-windows.pid'
  if (-not (Test-Path -LiteralPath $pidPath)) { return $null }
  $serverProcessId = 0
  if (-not [int]::TryParse((Get-Content -LiteralPath $pidPath -Raw).Trim(), [ref]$serverProcessId)) { throw 'The saved Homestead process identity is invalid.' }
  try { $process = Get-Process -Id $serverProcessId -ErrorAction Stop } catch { return $null }
  $expected = Join-Path (Get-HomesteadRuntime $InstallRoot).AppRoot 'node.exe'
  if ($process.Path -and [IO.Path]::GetFullPath($process.Path).Equals([IO.Path]::GetFullPath($expected), [StringComparison]::OrdinalIgnoreCase)) { return $process }
  throw 'The saved process belongs to another application. It will not be stopped.'
}
function Show-HomesteadError([string]$Message) {
  try { Add-Type -AssemblyName PresentationFramework; [System.Windows.MessageBox]::Show($Message, 'Homestead Free', 'OK', 'Error') | Out-Null }
  catch { Write-Host $Message -ForegroundColor Red }
}
