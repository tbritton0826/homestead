$ErrorActionPreference = "Stop"
$installRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$nodePath = Join-Path $installRoot "node.exe"
$pidPath = Join-Path $installRoot "data\homestead-windows.pid"

if (Test-Path -LiteralPath $pidPath) {
  $serverProcessId = [int](Get-Content -LiteralPath $pidPath -Raw)
  try {
    $process = Get-Process -Id $serverProcessId -ErrorAction Stop
    if ([IO.Path]::GetFullPath($process.Path) -eq [IO.Path]::GetFullPath($nodePath)) {
      Stop-Process -Id $serverProcessId -Force
      $process.WaitForExit(10000)
    }
  } catch {}
  Remove-Item -LiteralPath $pidPath -Force -ErrorAction SilentlyContinue
}

Write-Host "Homestead Free is stopped."
