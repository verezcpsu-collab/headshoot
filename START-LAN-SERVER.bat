@echo off
cd /d "%~dp0"
if not exist node_modules\ws (
  echo Installing multiplayer server dependency...
  call npm install
  if errorlevel 1 pause & exit /b 1
)
echo.
echo Starting HIDE & SHOOT LAN server...
call npm start
pause
