# Neonreel - made by sabrine0 (https://github.com/sabrine0)
# Starts everything Neonreel needs and opens it in the browser.
#   1. ComfyUI (images and video on the graphics card), if it is not already running
#   2. The app, built for production, on http://localhost:4000
# Run it by double-clicking "Start Neonreel.cmd", or:  pwsh -File start.ps1 [-Rebuild] [-Port 4000]

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
if (Test-Url "$appUrl/") {
  Write-Host "Neonreel is already running at $appUrl"
  Start-Process $appUrl
  exit 0
}

# --- ComfyUI -----------------------------------------------------------------
$comfyUrl = if ($env:COMFY_URL) { $env:COMFY_URL } else { "http://127.0.0.1:8188" }
if (Test-Url "$comfyUrl/system_stats") {
  Write-Host "ComfyUI is already running."
} else {
  $comfy = Join-Path $env:USERPROFILE "ComfyUI"
  $python = Join-Path $comfy ".venv\Scripts\python.exe"
  if (Test-Path $python) {
    Write-Host "Starting ComfyUI in its own window..."
    Start-Process -FilePath $python -ArgumentList "main.py", "--listen", "127.0.0.1", "--port", "8188", "--disable-auto-launch" -WorkingDirectory $comfy -WindowStyle Minimized
  } else {
    Write-Warning "ComfyUI was not found at $comfy. The app will open, but only the demo models will work."
  }
}

# --- App ---------------------------------------------------------------------
if (-not (Test-Path "node_modules")) {
  Write-Host "Installing dependencies (first run only)..."
  npm install --no-audit --no-fund
  if ($LASTEXITCODE -ne 0) { throw "npm install failed." }
}

if ($Rebuild -or -not (Test-Path ".next\BUILD_ID")) {
  Write-Host "Building the app (about a minute)..."
  npx next build
  if ($LASTEXITCODE -ne 0) { throw "The build failed. Fix the errors above, then run this again." }
}

Write-Host "Starting Neonreel at $appUrl  (keep this window open; close it to stop the app)"
Start-Job -ScriptBlock {
  param($url)
  for ($i = 0; $i -lt 60; $i++) {
    try { if ((Invoke-WebRequest -Uri $url -UseBasicParsing -TimeoutSec 2).StatusCode -eq 200) { Start-Process $url; break } } catch {}
    Start-Sleep -Seconds 1
  }
} -ArgumentList $appUrl | Out-Null

npx next start -p $Port
