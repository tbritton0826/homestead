; Build-only wrapper. PowerShell handles the same verified installation for EXE and ZIP.
[Setup]
AppId=HomesteadFreeStandalone
AppName=Homestead Free
AppVersion=@VERSION@
AppPublisher=Homestead
AppPublisherURL=https://gethomesteadapp.com
DefaultDirName={localappdata}\Homestead Free
DisableProgramGroupPage=yes
DisableDirPage=no
PrivilegesRequired=lowest
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
MinVersion=10.0
CreateAppDir=yes
Uninstallable=no
OutputDir=@OUTPUT@
OutputBaseFilename=@BASENAME@
Compression=zip
SolidCompression=no
WizardStyle=modern
SetupIconFile=@ENVELOPE@\homestead.ico
SetupLogging=yes
CloseApplications=no
RestartApplications=no
InfoBeforeFile=@ENVELOPE@\README.txt
[Files]
Source: "@ENVELOPE@\*"; Flags: dontcopy
[Run]
Filename: "{sys}\WindowsPowerShell\v1.0\powershell.exe"; Parameters: "-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File ""{app}\Start-Homestead.ps1"""; Description: "Open Homestead"; Flags: postinstall nowait skipifsilent
[Code]
function PrepareToInstall(var NeedsRestart: Boolean): String;
var
  ExitCode: Integer;
  Arguments, PortValue: String;
  PortNumber: Integer;
begin
  Result := '';
  WizardForm.StatusLabel.Caption := 'Extracting and starting Homestead Free. This may take a few minutes.';
  WizardForm.Update;
  ExtractTemporaryFile('homestead-windows-runtime.zip');
  ExtractTemporaryFile('runtime.sha256.txt');
  ExtractTemporaryFile('Install-Homestead.ps1');
  ExtractTemporaryFile('Start-Homestead.ps1');
  ExtractTemporaryFile('Stop-Homestead.ps1');
  ExtractTemporaryFile('Windows-Common.ps1');
  ExtractTemporaryFile('Uninstall-Homestead.ps1');
  ExtractTemporaryFile('Start Homestead.cmd');
  ExtractTemporaryFile('Stop Homestead.cmd');
  Arguments := '-NoProfile -ExecutionPolicy Bypass -File "' + ExpandConstant('{tmp}\Install-Homestead.ps1') + '" -InstallRoot "' + ExpandConstant('{app}') + '" -NoBrowser -NoDialogs';
  PortValue := ExpandConstant('{param:Port|}');
  if PortValue <> '' then begin
    PortNumber := StrToIntDef(PortValue, 0);
    if (PortNumber < 1024) or (PortNumber > 65535) then begin Result := 'Choose a port from 1024 through 65535.'; Exit; end;
    Arguments := Arguments + ' -Port ' + IntToStr(PortNumber);
  end;
  if ExpandConstant('{param:NoShell|0}') = '1' then Arguments := Arguments + ' -SkipShellIntegration';
  if not Exec(ExpandConstant('{sys}\WindowsPowerShell\v1.0\powershell.exe'), Arguments, ExpandConstant('{tmp}'), SW_HIDE, ewWaitUntilTerminated, ExitCode) then
    Result := 'Windows could not start Homestead setup. See %TEMP%\Homestead-Free-Install.log.'
  else if ExitCode <> 0 then
    Result := 'Homestead setup could not finish. See %TEMP%\Homestead-Free-Install.log for the error. Your existing data and media are preserved.';
end;
