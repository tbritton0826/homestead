param(
  [switch]$NoBrowser,
  [switch]$WaitForReady
)

$ErrorActionPreference = "Stop"
$installRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$nodePath = Join-Path $installRoot "node.exe"
$serverPath = Join-Path $installRoot "server.cjs"
$dataPath = Join-Path $installRoot "data"
$mediaPath = Join-Path $installRoot "media"
$logsPath = Join-Path $installRoot "logs"
$pidPath = Join-Path $dataPath "homestead-windows.pid"
$healthUrl = "http://127.0.0.1:7312/api/platform"

New-Item -ItemType Directory -Force -Path $dataPath, $mediaPath, $logsPath | Out-Null

function Get-HomesteadProcess {
  if (-not (Test-Path -LiteralPath $pidPath)) { return $null }
  $serverProcessId = [int](Get-Content -LiteralPath $pidPath -Raw)
  try {
    $process = Get-Process -Id $serverProcessId -ErrorAction Stop
    if ([IO.Path]::GetFullPath($process.Path) -eq [IO.Path]::GetFullPath($nodePath)) { return $process }
  } catch {}
  Remove-Item -LiteralPath $pidPath -Force -ErrorAction SilentlyContinue
  return $null
}

$running = Get-HomesteadProcess
if (-not $running) {
  if (-not (Test-Path -LiteralPath $nodePath)) { throw "The bundled Homestead Node runtime is missing." }
  if (-not (Test-Path -LiteralPath $serverPath)) { throw "The Homestead server is missing." }

  $env:NODE_ENV = "production"
  $env:HOMESTEAD_FREE_PREVIEW = "true"
  $env:HOMESTEAD_DATA_DIR = $dataPath
  $env:MEDIA_ROOT = $mediaPath
  $env:PORT = "7312"
  $env:PATH = "$(Join-Path $installRoot 'runtime-tools');$installRoot;$env:PATH"

  $quotedServerPath = '"' + $serverPath.Replace('"', '\"') + '"'
  $running = Start-Process -FilePath $nodePath -ArgumentList @($quotedServerPath) -WorkingDirectory $installRoot -WindowStyle Hidden -RedirectStandardOutput (Join-Path $logsPath "server-output.log") -RedirectStandardError (Join-Path $logsPath "server-error.log") -PassThru
  Set-Content -LiteralPath $pidPath -Value $running.Id -Encoding Ascii
}

if ($WaitForReady -or -not $NoBrowser) {
  $deadline = (Get-Date).AddMinutes(3)
  $ready = $false
  while ((Get-Date) -lt $deadline) {
    if ($running.HasExited) { break }
    try {
      $platform = Invoke-RestMethod -Uri $healthUrl -TimeoutSec 3
      if ($platform.platform.edition -eq "free") { $ready = $true; break }
    } catch {}
    Start-Sleep -Seconds 2
  }
  if (-not $ready) {
    if ($running.HasExited) { Remove-Item -LiteralPath $pidPath -Force -ErrorAction SilentlyContinue }
    $errorLog = Join-Path $logsPath "server-error.log"
    $details = if (Test-Path -LiteralPath $errorLog) { (Get-Content -LiteralPath $errorLog -Tail 12) -join "`n" } else { "No server error log was created." }
    throw "Homestead did not become ready.`n`n$details"
  }
}

if (-not $NoBrowser) { Start-Process "http://localhost:7312" }
