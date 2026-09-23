@echo off
rem One-time setup: install deps (Windows Electron binaries), build, fetch the Live2D model.
cd /d "%~dp0.."
where node >nul 2>nul
if errorlevel 1 (
  echo Node.js 22+ is required: https://nodejs.org/
  pause
  exit /b 1
)
call npm ci || (echo npm ci failed & pause & exit /b 1)
call npm run build || (echo build failed & pause & exit /b 1)
call npm run setup:live2d -- --agree || echo Live2D model fetch skipped/failed - the placeholder avatar will be used.
echo.
echo Setup complete. Enable the Draft Advisor mod in-game and the overlay starts automatically,
echo or run scripts\start-overlay.cmd manually.
pause
