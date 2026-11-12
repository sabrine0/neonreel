# Neonreel - made by sabrine0 (https://github.com/sabrine0)
# Starts everything Neonreel needs and opens it in the browser.
#   1. ComfyUI (images and video on the graphics card), if it is not already running
#   2. The app on http://localhost:4000
# Run it by double-clicking "Start Neonreel.cmd", or:
#   powershell -ExecutionPolicy Bypass -File start.ps1 [-Rebuild] [-Port 4000]
# On a new computer run "Setup Neonreel.cmd" once first.

param(
  [switch]$Rebuild,
  [int]$Port = 4000
)

$ErrorActionPreference = "Stop"
Set-Location $PSScriptRoot

function Test-Url($url) {
  try { return (Invoke-WebRequest -Uri $url -UseBasicParsing -TimeoutSec 2).StatusCode -eq 200 } catch { return $false }
}

$appUrl = "http://localhost:$Port"
if (Test-Url "$appUrl/api/status") {
  Write-Host "Neonreel is already running at $appUrl"
  Start-Process $appUrl
  exit 0
}

$python = Join-Path $PSScriptRoot ".venv\Scripts\python.exe"
if (-not (Test-Path $python)) {
  Write-Warning "Neonreel is not installed yet. Double-click 'Setup Neonreel.cmd' first."
  exit 1
}

# --- ComfyUI -----------------------------------------------------------------
$comfyUrl = if ($env:COMFY_URL) { $env:COMFY_URL } else { "http://127.0.0.1:8188" }
if (Test-Url "$comfyUrl/queue") {
  Write-Host "ComfyUI is already running."
} else {
  $comfy = Join-Path $env:USERPROFILE "ComfyUI"
  $comfyPython = Join-Path $comfy ".venv\Scripts\python.exe"
  if (Test-Path $comfyPython) {
    Write-Host "Starting ComfyUI in its own window..."
    Start-Process -FilePath $comfyPython -ArgumentList "main.py", "--listen", "127.0.0.1", "--port", "8188", "--disable-auto-launch" -WorkingDirectory $comfy -WindowStyle Minimized
  } else {
    Write-Warning "ComfyUI was not found at $comfy. The app will open, but only the demo models will work."
  }
}

# --- App ---------------------------------------------------------------------
if ($Rebuild -or -not (Test-Path "frontend\dist\index.html")) {
  Write-Host "Building the interface (about half a minute)..."
  Push-Location frontend
  try {
    if (-not (Test-Path "node_modules")) { npm install --no-audit --no-fund }
    npm run build
    if ($LASTEXITCODE -ne 0) { throw "The build failed. Fix the errors above, then run this again." }
  } finally { Pop-Location }
}

Write-Host "Starting Neonreel at $appUrl  (keep this window open; close it to stop the app)"
Start-Job -ScriptBlock {
  param($url)
  for ($i = 0; $i -lt 60; $i++) {
    try { if ((Invoke-WebRequest -Uri "$url/api/status" -UseBasicParsing -TimeoutSec 2).StatusCode -eq 200) { Start-Process $url; break } } catch {}
    Start-Sleep -Seconds 1
  }
} -ArgumentList $appUrl | Out-Null

$env:PORT = "$Port"
& $python -m uvicorn neonreel.main:app --app-dir backend --host 127.0.0.1 --port $Port --log-level warning
