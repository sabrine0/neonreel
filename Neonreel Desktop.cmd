@echo off
rem Neonreel - made by sabrine0 (https://github.com/sabrine0)
rem Opens Neonreel in its own window. Run "npm install" once first.
cd /d "%~dp0"
if not exist node_modules (
  echo Installing, first run only...
  call npm install --no-audit --no-fund
)
start "" /b node desktop\launch.cjs
