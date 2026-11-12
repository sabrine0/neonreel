@echo off
rem Neonreel - made by sabrine0 (https://github.com/sabrine0)
rem Double-click to start Neonreel. Starts ComfyUI if needed, then the app.
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0start.ps1" %*
if errorlevel 1 pause
