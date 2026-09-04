import { spawn } from "node:child_process";
import { watch } from "node:fs";
import { readFile as readFileAsync } from "node:fs/promises";
import electronPath from "electron";
import waitOn from "wait-on";

await waitOn({ resources: ["file:.vite-dev-port", "file:dist-electron/main.js"] });
const port = (await readFileAsync(".vite-dev-port", "utf8")).trim();
await waitOn({ resources: [`tcp:127.0.0.1:${port}`] });

let electronProcess;
let restartTimer;
let shuttingDown = false;

function startElectron() {
  electronProcess = spawn(electronPath, ["."], {
    env: {
      ...process.env,
      VITE_DEV_SERVER_URL: `http://127.0.0.1:${port}`,
    },
    stdio: "inherit",
  });

  electronProcess.once("exit", () => {
    electronProcess = undefined;
  });
}

function restartElectron() {
  clearTimeout(restartTimer);
  restartTimer = setTimeout(() => {
    if (shuttingDown) return;
    electronProcess?.kill();
    startElectron();
  }, 300);
}

const watcher = watch("dist-electron", { recursive: true }, restartElectron);
startElectron();

function shutdown() {
  shuttingDown = true;
  clearTimeout(restartTimer);
  watcher.close();
  electronProcess?.kill();
  process.exit(0);
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
