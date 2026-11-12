@echo off
rem Neonreel - made by sabrine0 (https://github.com/sabrine0)
rem Double-click once on a new computer. Installs the app, ComfyUI and the model files (about 55 GB).
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0setup.ps1" %*
pause
