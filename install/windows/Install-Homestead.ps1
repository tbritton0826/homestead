param(
  [string]$InstallRoot = (Join-Path $env:LOCALAPPDATA 'Homestead Free'),
  [ValidateRange(1024,65535)][int]$Port = 7312,
  [switch]$SkipShellIntegration,
  [switch]$NoBrowser,
  [switch]$NoDialogs
)
$ErrorActionPreference = 'Stop'
$installRoot = [IO.Path]::GetFullPath($InstallRoot)
$runtimeArchive = Join-Path $PSScriptRoot 'homestead-windows-runtime.zip'
$logPath = Join-Path $env:TEMP 'Homestead-Free-Install.log'
$transcriptStarted = $false
$mutex = $null
$lockHeld = $false
try { Start-Transcript -LiteralPath $logPath -Append | Out-Null; $transcriptStarted = $true } catch { }
try {
  if ([IO.Path]::GetPathRoot($installRoot).TrimEnd('\') -eq $installRoot.TrimEnd('\')) { throw 'Choose an application folder, not the root of a drive.' }
  foreach ($protected in @($env:SystemRoot, $env:USERPROFILE, $env:LOCALAPPDATA, $env:ProgramFiles)) {
    if ($protected -and $installRoot.TrimEnd('\').Equals([IO.Path]::GetFullPath($protected).TrimEnd('\'), [StringComparison]::OrdinalIgnoreCase)) { throw 'Choose a dedicated Homestead folder.' }
  }
  $hashProvider = [Security.Cryptography.SHA256]::Create()
  $lockId = ([BitConverter]::ToString($hashProvider.ComputeHash([Text.Encoding]::UTF8.GetBytes($installRoot.ToLowerInvariant())))).Replace('-','')
  $hashProvider.Dispose()
  $mutex = New-Object Threading.Mutex($false, "Local\HomesteadInstall-$lockId")
  $lockHeld = $mutex.WaitOne(0)
  if (-not $lockHeld) { throw 'Another Homestead setup is already running. Wait for it to finish.' }
  Write-Host "Windows PowerShell: $PSHOME; 64-bit process: $([Environment]::Is64BitProcess)"
  Import-Module (Join-Path $PSHOME 'Modules\Microsoft.PowerShell.Utility') -Force
  Write-Host 'Installing Homestead Free for Windows. Please leave this window open.' -ForegroundColor Cyan
  Write-Host 'Your settings and media are kept separately from application updates.'
  if (-not [Environment]::Is64BitOperatingSystem) { throw 'Homestead requires 64-bit Windows.' }
  if (-not (Test-Path -LiteralPath $runtimeArchive -PathType Leaf)) { throw 'The embedded Windows runtime is missing. Download the complete setup package again.' }
  $expectedHash = (Get-Content -LiteralPath (Join-Path $PSScriptRoot 'runtime.sha256.txt') -Raw).Trim().Split(' ')[0]
  $archiveHash = (Get-FileHash -LiteralPath $runtimeArchive -Algorithm SHA256).Hash
  if ($archiveHash -ne $expectedHash) { throw 'The embedded runtime failed its integrity check. Download setup again.' }
  New-Item -ItemType Directory -Force -Path $installRoot | Out-Null
  foreach ($name in @('data','media','logs','versions')) { New-Item -ItemType Directory -Force -Path (Join-Path $installRoot $name) | Out-Null }
  $stage = Join-Path $installRoot ('versions\staging-' + [Guid]::NewGuid().ToString('N'))
  New-Item -ItemType Directory -Path $stage | Out-Null
  Add-Type -AssemblyName System.IO.Compression.FileSystem
  $archive = [IO.Compression.ZipFile]::OpenRead($runtimeArchive)
  try {
    $seenPaths = New-Object 'Collections.Generic.HashSet[string]' ([StringComparer]::OrdinalIgnoreCase)
    foreach ($entry in $archive.Entries) {
      $target = [IO.Path]::GetFullPath((Join-Path $stage $entry.FullName))
      if (-not $seenPaths.Add($target)) { throw 'The runtime contains duplicate archive paths.' }
      if (-not $target.StartsWith($stage + '\', [StringComparison]::OrdinalIgnoreCase) -or $entry.FullName -match '(^|[\\/])\.\.([\\/]|$)') { throw 'The runtime contains an invalid archive path.' }
      if ((($entry.ExternalAttributes -shr 16) -band 0xF000) -eq 0xA000) { throw 'Linked archive files are not supported.' }
      if ($entry.FullName -match '^(data|media|logs)[\\/]') { throw 'Application packages cannot replace user data.' }
    }
  } finally { $archive.Dispose() }
  Write-Host 'Extracting the private application runtimes...'
  [IO.Compression.ZipFile]::ExtractToDirectory($runtimeArchive, $stage)
  foreach ($required in @('node.exe','server.cjs','dist\index.html','node_modules\express\package.json','runtime-tools\ffmpeg.exe','runtime-tools\ffprobe.exe','release.json')) {
    if (-not (Test-Path -LiteralPath (Join-Path $stage $required) -PathType Leaf)) { throw "The Windows runtime is incomplete: $required" }
  }
  $release = Get-Content -LiteralPath (Join-Path $stage 'release.json') -Raw | ConvertFrom-Json
  & (Join-Path $stage 'node.exe') --check (Join-Path $stage 'server.cjs')
  if ($LASTEXITCODE -ne 0) { throw 'The bundled application did not pass its startup syntax check.' }
  $previous = if (Test-Path -LiteralPath (Join-Path $installRoot 'runtime.json')) { Get-Content -LiteralPath (Join-Path $installRoot 'runtime.json') -Raw } else { $null }
  $existingStop = Join-Path $installRoot 'Stop-Homestead.ps1'
  if (Test-Path -LiteralPath $existingStop) {
    & powershell.exe -NoProfile -ExecutionPolicy Bypass -File $existingStop
    if ($LASTEXITCODE -ne 0) { throw 'The current Homestead process could not stop safely. Close it and retry setup.' }
  }
  $versionName = $release.releaseVersion + '-' + [Guid]::NewGuid().ToString('N').Substring(0,8)
  $runtimeTarget = Join-Path $installRoot ('versions\' + $versionName)
  Move-Item -LiteralPath $stage -Destination $runtimeTarget
  foreach ($fileName in @('Start Homestead.cmd','Stop Homestead.cmd','Start-Homestead.ps1','Stop-Homestead.ps1','Windows-Common.ps1','Uninstall-Homestead.ps1')) {
    Copy-Item -LiteralPath (Join-Path $PSScriptRoot $fileName) -Destination (Join-Path $installRoot $fileName) -Force
  }
  $instanceId = if ($previous) { ($previous | ConvertFrom-Json).instance } else { [Guid]::NewGuid().ToString() }
  $effectivePort = if ($previous -and -not $PSBoundParameters.ContainsKey('Port')) { [int]($previous | ConvertFrom-Json).port } else { $Port }
  $configuration = @{ relativePath = "versions/$versionName"; port = $effectivePort; instance = $instanceId; version = $release.releaseVersion }
  $configuration | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $installRoot 'runtime.json') -Encoding UTF8
  try {
    & powershell.exe -NoProfile -ExecutionPolicy Bypass -File (Join-Path $installRoot 'Start-Homestead.ps1') -NoBrowser -WaitForReady
    if ($LASTEXITCODE -ne 0) { throw 'The installed application could not start. See the server logs.' }
  } catch {
    if ($previous) {
      try { & powershell.exe -NoProfile -ExecutionPolicy Bypass -File (Join-Path $installRoot 'Stop-Homestead.ps1') } catch { }
      Set-Content -LiteralPath (Join-Path $installRoot 'runtime.json') -Value $previous -Encoding UTF8
      try { & powershell.exe -NoProfile -ExecutionPolicy Bypass -File (Join-Path $installRoot 'Start-Homestead.ps1') -NoBrowser -WaitForReady } catch { }
    }
    throw
  }
  Copy-Item -LiteralPath (Join-Path $runtimeTarget 'public\homestead.ico') -Destination (Join-Path $installRoot 'homestead.ico') -Force
  if (-not $SkipShellIntegration) {
    $programsFolder = Join-Path ([Environment]::GetFolderPath('Programs')) 'Homestead Free'
    New-Item -ItemType Directory -Force -Path $programsFolder | Out-Null
    $shell = New-Object -ComObject WScript.Shell
    function New-HomesteadShortcut([string]$Path, [string]$Script) {
      $shortcut = $shell.CreateShortcut($Path)
      $shortcut.TargetPath = Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe'
      $shortcut.Arguments = '-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File "' + (Join-Path $installRoot $Script) + '"'
      $shortcut.WorkingDirectory = $installRoot
      $shortcut.IconLocation = (Join-Path $installRoot 'homestead.ico') + ",0"
      $shortcut.Save()
    }
    New-HomesteadShortcut (Join-Path $programsFolder 'Homestead Free.lnk') 'Start-Homestead.ps1'
    New-HomesteadShortcut (Join-Path ([Environment]::GetFolderPath('Desktop')) 'Homestead Free.lnk') 'Start-Homestead.ps1'
    New-HomesteadShortcut (Join-Path $programsFolder 'Stop Homestead.lnk') 'Stop-Homestead.ps1'
    New-HomesteadShortcut (Join-Path $programsFolder 'Uninstall Homestead Free.lnk') 'Uninstall-Homestead.ps1'
    $uninstallKey = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\HomesteadFree'
    New-Item -Path $uninstallKey -Force | Out-Null
    foreach ($item in @{DisplayName='Homestead Free'; DisplayVersion=$release.releaseVersion; Publisher='Homestead'; InstallLocation=$installRoot; DisplayIcon=(Join-Path $installRoot 'homestead.ico'); UninstallString=('powershell.exe -NoProfile -ExecutionPolicy Bypass -File "' + (Join-Path $installRoot 'Uninstall-Homestead.ps1') + '"')}.GetEnumerator()) {
      Set-ItemProperty -Path $uninstallKey -Name $item.Key -Value $item.Value
    }
    Set-ItemProperty -Path $uninstallKey -Name NoModify -Value 1 -Type DWord
  }
  Write-Host "Homestead Free is ready at http://localhost:$effectivePort" -ForegroundColor Green
  if (-not $NoBrowser) { Start-Process "http://localhost:$effectivePort" }
} catch {
  $message = "Homestead Free setup could not finish.`n`n$($_.Exception.Message)`n`nInstall log: $logPath"
  Write-Host $message -ForegroundColor Red
  if (-not $NoDialogs) { . (Join-Path $PSScriptRoot 'Windows-Common.ps1'); Show-HomesteadError $message }
  exit 1
} finally {
  if ($lockHeld) { $mutex.ReleaseMutex() }
  if ($mutex) { $mutex.Dispose() }
  if ($transcriptStarted) { try { Stop-Transcript | Out-Null } catch { } }
}
