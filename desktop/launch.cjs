// Neonreel - made by sabrine0 (https://github.com/sabrine0)
// Starts the desktop window. Terminals inside editors such as VS Code set
// ELECTRON_RUN_AS_NODE, which makes Electron behave as plain Node and fail to
// open a window, so it is removed here first.
const { spawn } = require("node:child_process");
const path = require("node:path");

const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;

spawn(require("electron"), [path.join(__dirname, "..")], { env, stdio: "inherit", windowsHide: false }).on(
  "exit",
  (code) => process.exit(code ?? 0),
);
