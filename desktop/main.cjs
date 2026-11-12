// Neonreel - made by sabrine0 (https://github.com/sabrine0)
// Neonreel as a desktop app: its own window instead of a browser tab.
// Starts ComfyUI and the app server if they are not already running.
// Run with:  npm run desktop   (or double-click "Neonreel Desktop.cmd")

const { app, BrowserWindow, shell } = require("electron");
const { spawn } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const ROOT = path.join(__dirname, "..");
const PORT = Number(process.env.NEONREEL_PORT) || 4000;
const APP_URL = `http://localhost:${PORT}`;
const COMFY_URL = (process.env.COMFY_URL || "http://127.0.0.1:8188").replace(/\/$/, "");
const VENV_PYTHON = process.platform === "win32" ? ".venv/Scripts/python.exe" : ".venv/bin/python";
const SERVER_PYTHON = path.join(ROOT, VENV_PYTHON);

/** The app server, if this window started it. Stopped again when the window closes. */
let server = null;

async function isUp(url) {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(2000) });
    return res.ok;
  } catch {
    return false;
  }
}

async function waitFor(url, seconds) {
  for (let i = 0; i < seconds; i++) {
    if (await isUp(url)) return true;
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  return false;
}

function startComfy() {
  const comfy = path.join(os.homedir(), "ComfyUI");
  const python = path.join(comfy, VENV_PYTHON);
  if (!fs.existsSync(python)) return;
  // Left running when the window closes: a render may still be in progress.
  spawn(python, ["main.py", "--listen", "127.0.0.1", "--port", "8188", "--disable-auto-launch"], {
    cwd: comfy,
    detached: true,
    stdio: "ignore",
    windowsHide: true,
  }).unref();
}

function page(message) {
  const html = `<body style="margin:0;height:100vh;display:grid;place-items:center;background:#07080f;color:#fff;font:500 18px system-ui">
    <div style="text-align:center;max-width:34rem;padding:2rem"><div style="font-size:28px;font-weight:700;margin-bottom:12px">
    <span style="color:#38d6ff">Neon</span><span style="color:#ff4fd8">reel</span></div>${message}</div></body>`;
  return `data:text/html;charset=utf-8,${encodeURIComponent(html)}`;
}

/** Makes sure the app server answers. Returns a message for the user if it cannot. */
async function startServer() {
  if (await isUp(`${APP_URL}/api/status`)) return null;
  if (!fs.existsSync(SERVER_PYTHON)) {
    return 'Neonreel is not installed yet. Double-click "Setup Neonreel.cmd" in the project folder first.';
  }
  if (!(await isUp(`${COMFY_URL}/queue`))) startComfy();

  server = spawn(
    SERVER_PYTHON,
    ["-m", "uvicorn", "neonreel.main:app", "--app-dir", "backend", "--host", "127.0.0.1", "--port", String(PORT), "--log-level", "warning"],
    { cwd: ROOT, env: { ...process.env, PORT: String(PORT) }, stdio: "ignore", windowsHide: true },
  );
  if (await waitFor(`${APP_URL}/api/status`, 60)) return null;
  return 'Neonreel could not start. Run "Start Neonreel.cmd" to see the error.';
}

async function open() {
  const win = new BrowserWindow({
    width: 1440,
    height: 920,
    minWidth: 900,
    minHeight: 600,
    title: "Neonreel",
    backgroundColor: "#07080f",
    autoHideMenuBar: true,
    webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true },
  });

  // Links to other sites (the upload pages in Share) open in the normal browser.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//.test(url)) void shell.openExternal(url);
    return { action: "deny" };
  });
  win.webContents.on("will-navigate", (event, url) => {
    if (!url.startsWith(APP_URL) && !url.startsWith("data:")) {
      event.preventDefault();
      if (/^https?:\/\//.test(url)) void shell.openExternal(url);
    }
  });

  await win.loadURL(page("Starting…"));
  const problem = await startServer();
  await win.loadURL(problem ? page(problem) : APP_URL);

  // Used by the project's own check: save a picture of the window, then quit.
  if (process.env.NEONREEL_SHOT) {
    await new Promise((resolve) => setTimeout(resolve, 4000));
    fs.writeFileSync(process.env.NEONREEL_SHOT, (await win.webContents.capturePage()).toPNG());
    app.quit();
  }
}

app.whenReady().then(open);
app.on("window-all-closed", () => app.quit());
app.on("quit", () => {
  if (server) server.kill();
});
