@echo off
setlocal
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0Start-Homestead.ps1"
if errorlevel 1 (
  echo.
  echo Homestead could not be started. See the logs folder for details.
  pause
)
endlocal
