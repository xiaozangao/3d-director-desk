@echo off
setlocal
cd /d "%~dp0"
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\kimodo-service.ps1" install
set "KIMODO_EXIT=%ERRORLEVEL%"
echo.
if "%KIMODO_EXIT%"=="0" (
  echo Kimodo service installation completed.
) else (
  echo Kimodo service installation failed with exit code %KIMODO_EXIT%.
)
pause
exit /b %KIMODO_EXIT%
