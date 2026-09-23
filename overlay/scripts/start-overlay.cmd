@echo off
rem Launch the Draft Advisor overlay manually (the mod also starts it automatically).
cd /d "%~dp0.."
if not exist "node_modules\electron\dist\electron.exe" (
  echo Electron is not installed yet. Run scripts\setup-overlay.cmd first.
  pause
  exit /b 1
)
start "" "node_modules\electron\dist\electron.exe" .
