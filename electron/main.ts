import path from "node:path";
import { app, BrowserWindow, shell } from "electron";
import { PosDatabase } from "./database";
import { registerIpc } from "./ipc";
import { SyncService } from "./sync";

let mainWindow: BrowserWindow | null = null;
let database: PosDatabase | null = null;
let syncTimer: NodeJS.Timeout | null = null;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1024,
    minHeight: 680,
    backgroundColor: "#f6f5f2",
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith("https://")) void shell.openExternal(url);
    return { action: "deny" };
  });
  mainWindow.webContents.on("will-navigate", (event, url) => {
    const allowed =
      process.env.VITE_DEV_SERVER_URL ??
      `file://${path.join(__dirname, "../dist/index.html")}`;
    if (!url.startsWith(allowed)) event.preventDefault();
  });
  if (process.env.VITE_DEV_SERVER_URL)
    void mainWindow.loadURL(process.env.VITE_DEV_SERVER_URL);
  else void mainWindow.loadFile(path.join(__dirname, "../dist/index.html"));
  return mainWindow;
}

if (!app.requestSingleInstanceLock()) app.quit();
else {
  app.on("second-instance", () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });
  app.whenReady().then(() => {
    database = new PosDatabase(app.getPath("userData"));
    const sync = new SyncService(database);
    const window = createWindow();
    registerIpc(database!, sync, window);
    syncTimer = setInterval(() => {
      if (sync.state().authenticated) void sync.sync().catch(() => undefined);
    }, 60_000);
    if (sync.state().authenticated) void sync.sync().catch(() => undefined);
  });
}

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
app.on("before-quit", () => {
  if (syncTimer) clearInterval(syncTimer);
  database?.close();
});
