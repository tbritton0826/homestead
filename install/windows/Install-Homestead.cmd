@echo off
setlocal
title Homestead Free Installer
echo Starting Homestead Free setup...
echo.
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0Install-Homestead.ps1"
set "install_result=%errorlevel%"
if not "%install_result%"=="0" (
  echo.
  echo Homestead could not be installed.
  echo A detailed error window and log should identify the cause.
  echo.
  pause
)
endlocal & exit /b %install_result%
