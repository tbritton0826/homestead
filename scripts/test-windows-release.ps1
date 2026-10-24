param([Parameter(Mandatory=$true)][string]$SetupExe)
$ErrorActionPreference='Stop'
$root=[IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$fixture=Join-Path $root ('work\windows-release-test-'+[Guid]::NewGuid().ToString('N')+'\Homestead Free')
$parent=Split-Path -Parent $fixture
New-Item -ItemType Directory -Path $parent -Force | Out-Null
$node=(Get-Command node.exe).Source
$listener=New-Object Net.Sockets.TcpListener([Net.IPAddress]::Loopback,0)
$listener.Start();$port=$listener.LocalEndpoint.Port;$listener.Stop()
$oldPath=$env:PATH
function Assert([bool]$Condition,[string]$Message){if(-not $Condition){throw $Message}}
function Install-Test([bool]$IsUpdate){
  $arguments=@('/VERYSILENT','/SUPPRESSMSGBOXES','/NORESTART','/NoShell=1',('/DIR="'+$fixture+'"'),('/LOG="'+(Join-Path $parent 'setup.log')+'"'))
  if(-not $IsUpdate){$arguments+=('/Port='+$port)}
  $process=Start-Process -FilePath $SetupExe -ArgumentList $arguments -WindowStyle Hidden -PassThru
  Assert ($process.WaitForExit(180000)) 'The setup wizard did not finish in three minutes.'
  Assert ($process.ExitCode -eq 0) ('Setup failed with exit code '+$process.ExitCode+'. See '+$parent+'\setup.log')
}
try{
 $env:PATH="$env:SystemRoot\System32;$env:SystemRoot;$env:SystemRoot\System32\WindowsPowerShell\v1.0"
 Install-Test $false
 & $node (Join-Path $PSScriptRoot 'test-windows-installed.cjs') $fixture
 Assert ($LASTEXITCODE -eq 0) 'Installed runtime smoke checks failed.'
 $before=Get-Content -LiteralPath (Join-Path $fixture 'runtime.json') -Raw | ConvertFrom-Json
 $retained=@('data\next-version\accounts.json','data\setup-config.json','data\update-preservation.txt','media\update-preservation.txt')
 $hashes=@{}
 foreach($file in $retained){$hashes[$file]=(Get-FileHash -LiteralPath (Join-Path $fixture $file)).Hash}
 Install-Test $true
 $after=Get-Content -LiteralPath (Join-Path $fixture 'runtime.json') -Raw | ConvertFrom-Json
 Assert ($before.relativePath -ne $after.relativePath) 'An update must select a new private runtime.'
 Assert ($after.port -eq $port) 'An update changed the saved port.'
 Assert ($before.instance -eq $after.instance) 'An update changed the installation identity.'
 foreach($file in $retained){Assert ((Get-FileHash -LiteralPath (Join-Path $fixture $file)).Hash -eq $hashes[$file]) ('Update changed '+$file)}
 & $node (Join-Path $PSScriptRoot 'test-windows-installed.cjs') $fixture
 Assert ($LASTEXITCODE -eq 0) 'Updated runtime smoke checks failed.'
 $processIdBefore=Get-Content -LiteralPath (Join-Path $fixture 'data\homestead-windows.pid')
 & powershell.exe -NoProfile -ExecutionPolicy Bypass -File (Join-Path $fixture 'Start-Homestead.ps1') -NoBrowser -WaitForReady
 Assert ($LASTEXITCODE -eq 0) 'Starting an already running installation failed.'
 Assert ((Get-Content -LiteralPath (Join-Path $fixture 'data\homestead-windows.pid')) -eq $processIdBefore) 'A second launch created another server.'
 & powershell.exe -NoProfile -ExecutionPolicy Bypass -File (Join-Path $fixture 'Stop-Homestead.ps1')
 $listener=New-Object Net.Sockets.TcpListener([Net.IPAddress]::Loopback,$port)
 $listener.Start()
 try{
  $blocked=Start-Process -FilePath powershell.exe -ArgumentList @('-NoProfile','-ExecutionPolicy','Bypass','-File',('"'+(Join-Path $fixture 'Start-Homestead.ps1')+'"'),'-NoBrowser') -WindowStyle Hidden -RedirectStandardError (Join-Path $parent 'occupied-port.log') -PassThru
  $blocked.WaitForExit()
  Assert ($blocked.ExitCode -ne 0) 'An occupied port was not reported.'
  Assert $listener.Server.IsBound 'The unrelated port listener was stopped.'
 }finally{$listener.Stop()}
 Write-Output ('Windows EXE fresh install/update checks passed. Owner, configuration, data/media bytes, port, identity, one server, and occupied-port safety verified. Fixture: '+$fixture)
}finally{
 $env:PATH=$oldPath
 if(Test-Path -LiteralPath (Join-Path $fixture 'Stop-Homestead.ps1')){& powershell.exe -NoProfile -ExecutionPolicy Bypass -File (Join-Path $fixture 'Stop-Homestead.ps1')}
}
