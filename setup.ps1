# Neonreel - made by sabrine0 (https://github.com/sabrine0)
# Installs everything Neonreel needs on a new Windows computer. Safe to run again:
# every step is skipped when it is already done, and downloads resume where they stopped.
#
#   1. Checks for Git, Python, Node.js and FFmpeg (offers to install missing ones)
#   2. The app: Python packages, the voice engine, and the built interface
#   3. ComfyUI, which runs the AI models on the graphics card
#   4. The model files, about 55 GB
#   5. The voice files, and Ollama with a small language model
#
# Run it by double-clicking "Setup Neonreel.cmd", or:
#   powershell -ExecutionPolicy Bypass -File setup.ps1 [-SkipModels] [-SkipComfy] [-SkipOllama]
#                                                      [-ModelFilter flux] [-ComfyDir D:\ComfyUI]

param(
  [switch]$SkipModels,
  [switch]$SkipComfy,
  [switch]$SkipOllama,
  # Only download model files whose name or purpose matches this text, for example "flux" or "video".
  [string]$ModelFilter = "",
  [string]$ComfyDir = (Join-Path $env:USERPROFILE "ComfyUI"),
  [string]$LanguageModel = "qwen2.5:7b-instruct"
)

$ErrorActionPreference = "Stop"
Set-Location $PSScriptRoot
$problems = @()

function Step($text) { Write-Host ""; Write-Host "== $text" -ForegroundColor Cyan }
function Note($text) { Write-Host "   $text" }
function Have($name) { return [bool](Get-Command $name -ErrorAction SilentlyContinue) }

function Update-Path {
  # Programs installed a moment ago are not on this window's PATH yet.
  $env:Path = [Environment]::GetEnvironmentVariable("Path", "Machine") + ";" + [Environment]::GetEnvironmentVariable("Path", "User")
}

function Install-Tool($command, $wingetId, $label) {
  if (Have $command) { Note "$label is installed."; return }
  if (-not (Have "winget")) {
    $script:problems += "$label is missing. Install it, then run this setup again."
    Write-Warning "$label is missing and winget is not available to install it."
    return
  }
  Note "Installing $label..."
  winget install --id $wingetId -e --accept-source-agreements --accept-package-agreements --silent
  Update-Path
  if (-not (Have $command)) {
    $script:problems += "$label was installed but is not on PATH yet. Close this window and run the setup again."
  }
}

function Get-File($url, $target) {
  # Downloads to "<name>.part" and renames at the end, so a stopped download is never mistaken for a finished one.
  if (Test-Path $target) { Note "Already here: $(Split-Path $target -Leaf)"; return $true }
  New-Item -ItemType Directory -Force -Path (Split-Path $target) | Out-Null
  $part = "$target.part"
  Note "Downloading $(Split-Path $target -Leaf)"
  & curl.exe -L --fail --retry 5 --retry-delay 5 -C - -o $part $url
  if ($LASTEXITCODE -ne 0) {
    $script:problems += "Could not download $(Split-Path $target -Leaf). Run the setup again to resume."
    return $false
  }
  Move-Item -Force $part $target
  return $true
}

# --- 1. Tools ------------------------------------------------------------------
Step "Checking the tools Neonreel is built on"
Install-Tool "git" "Git.Git" "Git"
Install-Tool "python" "Python.Python.3.12" "Python"
Install-Tool "node" "OpenJS.NodeJS.LTS" "Node.js"
Install-Tool "ffmpeg" "Gyan.FFmpeg" "FFmpeg"
if ($problems.Count -gt 0) {
  Write-Host ""
  $problems | ForEach-Object { Write-Warning $_ }
  exit 1
}

if (Have "nvidia-smi") {
  $memory = (& nvidia-smi --query-gpu=memory.total --format=csv,noheader,nounits | Select-Object -First 1)
  Note "NVIDIA graphics card found, $([math]::Round([int]$memory / 1024)) GB."
  if ([int]$memory -lt 15000) {
    Write-Warning "Neonreel was tested with 16 GB of graphics memory. With less, video and consistent characters may fail."
  }
} else {
  Write-Warning "No NVIDIA graphics card was found. The app will open, but only the demo models and the Loop, Reverse and Slow motion tools will work."
}

# --- 2. The app ----------------------------------------------------------------
Step "Installing the app"
$python = Join-Path $PSScriptRoot ".venv\Scripts\python.exe"
if (-not (Test-Path $python)) {
  Note "Creating the Python environment..."
  python -m venv .venv
}
& $python -m pip install --quiet --disable-pip-version-check -r backend\requirements.txt kokoro-onnx soundfile
if ($LASTEXITCODE -ne 0) { throw "Installing the Python packages failed." }
Note "Python packages are installed."

Push-Location frontend
try {
  if (-not (Test-Path "node_modules")) {
    Note "Installing the interface's packages..."
    npm install --no-audit --no-fund
    if ($LASTEXITCODE -ne 0) { throw "npm install failed." }
  }
  Note "Building the interface..."
  npm run build
  if ($LASTEXITCODE -ne 0) { throw "Building the interface failed." }
} finally { Pop-Location }

if (-not (Test-Path "node_modules")) {
  Note "Installing the desktop window..."
  npm install --no-audit --no-fund
  if ($LASTEXITCODE -ne 0) { Write-Warning "The desktop window could not be installed. The app still works in the browser." }
}

# --- 3. ComfyUI ----------------------------------------------------------------
$comfyPython = Join-Path $ComfyDir ".venv\Scripts\python.exe"
if (-not $SkipComfy) {
  Step "Installing ComfyUI in $ComfyDir"
  if (-not (Test-Path (Join-Path $ComfyDir "main.py"))) {
    git clone --depth 1 https://github.com/comfyanonymous/ComfyUI.git $ComfyDir
    if ($LASTEXITCODE -ne 0) { throw "Downloading ComfyUI failed." }
  } else { Note "ComfyUI is already downloaded." }

  if (-not (Test-Path $comfyPython)) {
    Note "Creating ComfyUI's Python environment..."
    python -m venv (Join-Path $ComfyDir ".venv")
  }
  & $comfyPython -c "import torch" 2>$null
  if ($LASTEXITCODE -ne 0) {
    Note "Installing PyTorch for NVIDIA cards (about 3 GB)..."
    & $comfyPython -m pip install --disable-pip-version-check torch torchvision torchaudio --index-url https://download.pytorch.org/whl/cu128
    if ($LASTEXITCODE -ne 0) { throw "Installing PyTorch failed." }
  } else { Note "PyTorch is installed." }
  Note "Installing ComfyUI's packages..."
  & $comfyPython -m pip install --quiet --disable-pip-version-check -r (Join-Path $ComfyDir "requirements.txt")
  if ($LASTEXITCODE -ne 0) { throw "Installing ComfyUI's packages failed." }
}

# --- 4 and 5. Model and voice files ----------------------------------------------
$catalog = Get-Content tools\models.json -Raw | ConvertFrom-Json
if (-not $SkipModels) {
  Step "Downloading the model files into $ComfyDir\models (about 55 GB the first time)"
  foreach ($model in $catalog.comfyui) {
    if ($ModelFilter -and "$($model.name) $($model.for)" -notmatch [regex]::Escape($ModelFilter)) { continue }
    Get-File $model.url (Join-Path $ComfyDir "models\$($model.folder)\$($model.name)") | Out-Null
  }
  Step "Downloading the voice files"
  foreach ($file in $catalog.voice) {
    Get-File $file.url (Join-Path $PSScriptRoot ".tts\models\$($file.name)") | Out-Null
  }
}

if (-not $SkipOllama) {
  Step "Setting up the language model (writes scenes, improves prompts, runs the assistant)"
  if (-not (Have "ollama")) {
    if (Have "winget") {
      Note "Installing Ollama..."
      winget install --id Ollama.Ollama -e --accept-source-agreements --accept-package-agreements --silent
      Update-Path
    }
  }
  if (Have "ollama") {
    $models = (& ollama list 2>$null | Select-Object -Skip 1)
    if ($models) { Note "Ollama already has a model." }
    else {
      Note "Downloading $LanguageModel (about 5 GB)..."
      & ollama pull $LanguageModel
      if ($LASTEXITCODE -ne 0) { $problems += "The language model could not be downloaded. Run: ollama pull $LanguageModel" }
    }
  } else {
    $problems += "Ollama is not installed, so scenes are written by hand and the assistant is off. Get it from https://ollama.com"
  }
}

# --- Done ----------------------------------------------------------------------
Write-Host ""
if ($problems.Count -gt 0) {
  Write-Host "Setup finished with things left to do:" -ForegroundColor Yellow
  $problems | ForEach-Object { Write-Host " - $_" -ForegroundColor Yellow }
  exit 1
}
Write-Host "Setup is complete. Double-click 'Start Neonreel.cmd' to open the app." -ForegroundColor Green
