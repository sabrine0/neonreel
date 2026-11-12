@echo off
rem Double-click to start Neonreel. Starts ComfyUI if needed, then the app.
pwsh -NoProfile -ExecutionPolicy Bypass -File "%~dp0start.ps1" %*
if errorlevel 1 pause
