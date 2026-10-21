param(
  [string]$NodeVersion = '24.22.1',
  [string]$Revision = 'windows.1',
  [switch]$SkipWebBuild
)
$ErrorActionPreference = 'Stop'
$root = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\..'))
$package = Get-Content -LiteralPath (Join-Path $root 'package.json') -Raw | ConvertFrom-Json
$releaseVersion = "$($package.version)-$Revision"
if ($releaseVersion -notmatch '^[a-zA-Z0-9._-]+$' -or $NodeVersion -notmatch '^24\.\d+\.\d+$') { throw 'Choose a valid release and Node 24 LTS version.' }
$output = Join-Path $root "release\$releaseVersion"
if ((Test-Path -LiteralPath $output) -and @(Get-ChildItem -LiteralPath $output -Force).Count) { throw 'This release directory already exists. Choose a new revision; published packages are never overwritten.' }
$work = Join-Path $root ('work\windows-build-' + [Guid]::NewGuid().ToString('N'))
$app = Join-Path $work 'app'
$envelope = Join-Path $work 'setup'
$cache = Join-Path $root 'work\windows-runtime-cache'
New-Item -ItemType Directory -Force -Path $app, $envelope, $cache, $output | Out-Null
function Run-Checked([string]$File, [string[]]$Arguments) {
  & $File @Arguments
  if ($LASTEXITCODE -ne 0) { throw "$File failed with exit code $LASTEXITCODE." }
}
Push-Location $root
try {
  if (-not $SkipWebBuild) { Run-Checked 'npm.cmd' @('run','build') }
  # Only source tracked in the public repository is eligible. User data, .env,
  # credentials, prior releases and the developer's node_modules never enter.
  $tracked = & git ls-files
  if ($LASTEXITCODE -ne 0) { throw 'The source file inventory could not be read.' }
  foreach ($relative in $tracked) {
    if ($relative -notmatch '^(server\.cjs|package(?:-lock)?\.json|src/|plugins/|public/|scripts/)') { continue }
    $source = Join-Path $root $relative
    if (-not (Test-Path -LiteralPath $source -PathType Leaf)) { throw "A tracked release source is missing: $relative" }
    $target = Join-Path $app $relative
    New-Item -ItemType Directory -Force -Path (Split-Path -Parent $target) | Out-Null
    Copy-Item -LiteralPath $source -Destination $target
  }
  Copy-Item -LiteralPath (Join-Path $root 'dist') -Destination (Join-Path $app 'dist') -Recurse
  Push-Location $app
  try { Run-Checked 'npm.cmd' @('ci','--omit=dev','--ignore-scripts','--no-audit','--no-fund') } finally { Pop-Location }
  $nodeName = "node-v$NodeVersion-win-x64.zip"
  $nodeZip = Join-Path $cache $nodeName
  $sums = Invoke-WebRequest -UseBasicParsing -Uri "https://nodejs.org/dist/v$NodeVersion/SHASUMS256.txt" -TimeoutSec 30
  $line = ($sums.Content -split "`n" | Where-Object { $_ -match ('\s' + [regex]::Escape($nodeName) + '$') }).Trim()
  if (-not $line) { throw 'Official Node checksums did not include the requested Windows runtime.' }
  $expectedNodeHash = $line.Split(' ')[0]
  if (-not (Test-Path -LiteralPath $nodeZip)) { Invoke-WebRequest -UseBasicParsing -Uri "https://nodejs.org/dist/v$NodeVersion/$nodeName" -OutFile $nodeZip -TimeoutSec 240 }
  if ((Get-FileHash -LiteralPath $nodeZip -Algorithm SHA256).Hash -ne $expectedNodeHash) { throw 'The Node archive did not match the official SHA-256.' }
  $nodeExtract = Join-Path $work 'node'
  Expand-Archive -LiteralPath $nodeZip -DestinationPath $nodeExtract
  $nodeRoot = Join-Path $nodeExtract "node-v$NodeVersion-win-x64"
  Copy-Item -LiteralPath (Join-Path $nodeRoot 'node.exe') -Destination (Join-Path $app 'node.exe')
  $licenses = Join-Path $app 'third-party-notices'
  New-Item -ItemType Directory -Force -Path $licenses | Out-Null
  Copy-Item -LiteralPath (Join-Path $nodeRoot 'LICENSE') -Destination (Join-Path $licenses 'Node-LICENSE.txt')
  $tools = Join-Path $cache 'media-tools'
  New-Item -ItemType Directory -Force -Path $tools | Out-Null
  if (-not (Test-Path -LiteralPath (Join-Path $tools 'package.json'))) { '{"name":"homestead-build-media-tools","private":true}' | Set-Content -LiteralPath (Join-Path $tools 'package.json') -Encoding Ascii }
  Push-Location $tools
  try { Run-Checked 'npm.cmd' @('install','--no-audit','--no-fund','--save-exact','ffmpeg-static@5.3.0','ffprobe-static@3.1.0') } finally { Pop-Location }
  $runtimeTools = Join-Path $app 'runtime-tools'
  New-Item -ItemType Directory -Force -Path $runtimeTools | Out-Null
  Copy-Item -LiteralPath (Join-Path $tools 'node_modules\ffmpeg-static\ffmpeg.exe') -Destination (Join-Path $runtimeTools 'ffmpeg.exe')
  Copy-Item -LiteralPath (Join-Path $tools 'node_modules\ffprobe-static\bin\win32\x64\ffprobe.exe') -Destination (Join-Path $runtimeTools 'ffprobe.exe')
  foreach ($name in @('ffmpeg-static','ffprobe-static')) {
    $destination = Join-Path $licenses $name
    New-Item -ItemType Directory -Force -Path $destination | Out-Null
    Get-ChildItem -LiteralPath (Join-Path $tools "node_modules\$name") -File | Where-Object { $_.Name -match 'license|copying|readme|package.json' } | ForEach-Object { Copy-Item -LiteralPath $_.FullName -Destination (Join-Path $destination $_.Name) }
  }
  Copy-Item -LiteralPath (Join-Path $tools 'package-lock.json') -Destination (Join-Path $licenses 'media-tools-lock.json')
  $ffmpegVersion = (& (Join-Path $runtimeTools 'ffmpeg.exe') -version | Select-Object -First 1)
  $ffprobeVersion = (& (Join-Path $runtimeTools 'ffprobe.exe') -version | Select-Object -First 1)
  Push-Location $app
  try { Run-Checked (Join-Path $app 'node.exe') @('-e',"require('express'); require('sharp'); console.log('Bundled server dependencies load.')") } finally { Pop-Location }
  @{ appVersion=$package.version; releaseVersion=$releaseVersion; edition='free'; platform='win32-x64'; nodeVersion=$NodeVersion; nodeArchiveSha256=$expectedNodeHash; ffmpeg=$ffmpegVersion; ffprobe=$ffprobeVersion; builtAt=[DateTime]::UtcNow.ToString('o') } | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $app 'release.json') -Encoding UTF8
  @'
This package includes Node.js (license included), locked npm production dependencies
(their notices remain in node_modules), ffmpeg-static 5.3.0 and ffprobe-static 3.1.0.
Media binary licenses and supplied readme/build information are included here.
Source/build provenance: https://github.com/eugeneware/ffmpeg-static and
https://github.com/joshwnj/ffprobe-static . Upstream FFmpeg: https://ffmpeg.org/ .
'@ | Set-Content -LiteralPath (Join-Path $licenses 'README.txt') -Encoding UTF8
  Add-Type -AssemblyName System.IO.Compression.FileSystem
  $runtimeZip = Join-Path $envelope 'homestead-windows-runtime.zip'
  [IO.Compression.ZipFile]::CreateFromDirectory($app, $runtimeZip, [IO.Compression.CompressionLevel]::Optimal, $false)
  (Get-FileHash -LiteralPath $runtimeZip -Algorithm SHA256).Hash | Set-Content -LiteralPath (Join-Path $envelope 'runtime.sha256.txt') -Encoding Ascii
  Get-ChildItem -LiteralPath (Join-Path $root 'install\windows') -File | Where-Object { $_.Extension -in @('.ps1','.cmd','.txt') } | ForEach-Object { Copy-Item -LiteralPath $_.FullName -Destination (Join-Path $envelope $_.Name) }
  $setupName = "Homestead-Free-$releaseVersion-Windows-Setup.exe"
  $targetExe = Join-Path $output $setupName
  $compiler = Join-Path $cache 'inno\ISCC.exe'
  if (-not (Test-Path -LiteralPath $compiler)) { throw 'Install the official Inno Setup 6.7.3 compiler in work/windows-runtime-cache/inno before building. See install/windows/BUILD.md.' }
  $template = Get-Content -LiteralPath (Join-Path $root 'install\windows\setup.iss') -Raw
  $template = $template.Replace('@ENVELOPE@', $envelope).Replace('@OUTPUT@', $output).Replace('@VERSION@', $releaseVersion).Replace('@BASENAME@', [IO.Path]::GetFileNameWithoutExtension($setupName))
  $issPath = Join-Path $work 'setup.iss'
  [IO.File]::WriteAllText($issPath, $template, [Text.UTF8Encoding]::new($true))
  Run-Checked $compiler @('/Q', $issPath)
  if (-not (Test-Path -LiteralPath $targetExe)) { throw 'The Windows setup wizard could not be built.' }
  $portableZip = Join-Path $output "Homestead-Free-$releaseVersion-Windows.zip"
  [IO.Compression.ZipFile]::CreateFromDirectory($envelope, $portableZip, [IO.Compression.CompressionLevel]::Optimal, $false)
  "Homestead Free $($package.version), Windows installer revision $Revision. No Docker, Node.js or FFmpeg installation required. See README.txt inside the ZIP for setup and logs." | Set-Content -LiteralPath (Join-Path $output 'RELEASE_NOTES.txt') -Encoding UTF8
  $artifacts = @($targetExe,$portableZip) | ForEach-Object { @{ name=[IO.Path]::GetFileName($_); bytes=(Get-Item -LiteralPath $_).Length; sha256=(Get-FileHash -LiteralPath $_ -Algorithm SHA256).Hash.ToLowerInvariant() } }
  $artifacts | ForEach-Object { "$($_.sha256)  $($_.name)" } | Set-Content -LiteralPath (Join-Path $output 'SHA256SUMS.txt') -Encoding Ascii
  @{ version=$releaseVersion; appVersion=$package.version; platform='windows-x64'; dockerRequired=$false; files=$artifacts } | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath (Join-Path $output 'release.json') -Encoding UTF8
  @{ output=$output; envelope=$envelope; app=$app; setup=$targetExe } | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $output 'build-local.json') -Encoding UTF8
  Write-Output "Release built: $output"
} finally { Pop-Location }
