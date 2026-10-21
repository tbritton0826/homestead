param([switch]$NoBrowser, [switch]$WaitForReady, [string]$InstallRoot = $PSScriptRoot)
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'Windows-Common.ps1')
try {
  $installRoot = [IO.Path]::GetFullPath($InstallRoot)
  $runtime = Get-HomesteadRuntime $installRoot
  $nodePath = Join-Path $runtime.AppRoot 'node.exe'
  $serverPath = Join-Path $runtime.AppRoot 'server.cjs'
  $dataPath = Join-Path $installRoot 'data'
  $mediaPath = Join-Path $installRoot 'media'
  $logsPath = Join-Path $installRoot 'logs'
  $pidPath = Join-Path $dataPath 'homestead-windows.pid'
  New-Item -ItemType Directory -Force -Path $dataPath, $mediaPath, $logsPath | Out-Null
  $running = Get-HomesteadOwnedProcess $installRoot
  if (-not $running) {
    foreach ($required in @($nodePath, $serverPath)) {
      if (-not (Test-Path -LiteralPath $required -PathType Leaf)) { throw "An installed Homestead file is missing: $required. Run setup again." }
    }
    $connection = New-Object Net.Sockets.TcpClient
    try {
      $attempt = $connection.ConnectAsync('127.0.0.1', $runtime.Port)
      if ($attempt.Wait(500) -and $connection.Connected) { throw "Port $($runtime.Port) is already in use. Stop that application or choose a different Homestead port." }
    } catch [System.AggregateException] { } finally { $connection.Dispose() }
    $env:NODE_ENV = 'production'
    $env:HOMESTEAD_FREE_PREVIEW = 'true'
    $env:HOMESTEAD_DATA_DIR = $dataPath
    $env:HOMESTEAD_INSTALLATION_ID = $runtime.Instance
    $env:MEDIA_ROOT = $mediaPath
    $env:PORT = [string]$runtime.Port
    $env:PATH = "$(Join-Path $runtime.AppRoot 'runtime-tools');$($runtime.AppRoot);$env:PATH"
    $quotedServerPath = '"' + $serverPath + '"'
    $running = Start-Process -FilePath $nodePath -ArgumentList @($quotedServerPath) -WorkingDirectory $runtime.AppRoot -WindowStyle Hidden -RedirectStandardOutput (Join-Path $logsPath 'server-output.log') -RedirectStandardError (Join-Path $logsPath 'server-error.log') -PassThru
    Set-Content -LiteralPath $pidPath -Value $running.Id -Encoding Ascii
  }
  if ($WaitForReady -or -not $NoBrowser) {
    $deadline = (Get-Date).AddMinutes(2)
    $ready = $false
    while ((Get-Date) -lt $deadline) {
      $running.Refresh()
      if ($running.HasExited) { break }
      try {
        $platform = Invoke-RestMethod -Uri "http://127.0.0.1:$($runtime.Port)/api/platform" -TimeoutSec 3
        if ($platform.platform.edition -eq 'free' -and $platform.platform.installationId -eq $runtime.Instance) { $ready = $true; break }
      } catch { }
      Start-Sleep -Milliseconds 500
    }
    if (-not $ready) {
      $details = if (Test-Path -LiteralPath (Join-Path $logsPath 'server-error.log')) { (Get-Content -LiteralPath (Join-Path $logsPath 'server-error.log') -Tail 10) -join "`n" } else { 'No server log was created.' }
      throw "Homestead did not become ready. Logs are in $logsPath`n`n$details"
    }
  }
  if (-not $NoBrowser) { Start-Process "http://localhost:$($runtime.Port)" }
} catch {
  if (-not $NoBrowser) { Show-HomesteadError $_.Exception.Message }
  throw
}
