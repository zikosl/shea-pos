import path from "node:path";
import { fileURLToPath } from "node:url";
import { readFile } from "node:fs/promises";
import { app, BrowserWindow, protocol, shell } from "electron";
import { PosDatabase } from "./database";
import { registerIpc } from "./ipc";
import { SyncService } from "./sync";
import { LocalAccessService } from "./access";
import { ProductAssetService } from "./assets";
import { PosUpdater } from "./updater";
import { GatewayService } from "./gateway";

let mainWindow: BrowserWindow | null = null;
let database: PosDatabase | null = null;
let syncTimer: NodeJS.Timeout | null = null;
let updater: PosUpdater | null = null;

function applicationIcon() {
  return app.isPackaged
    ? path.join(process.resourcesPath, "icon.png")
    : path.join(__dirname, "../build/icon.png");
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1024,
    minHeight: 680,
    backgroundColor: "#f6f5f2",
    autoHideMenuBar: true,
    icon: applicationIcon(),
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    try {
      const parsed = new URL(url);
      if (parsed.protocol === "https:" && ["shea.openzey.com", "openzey.com"].includes(parsed.hostname))
        void shell.openExternal(parsed.toString());
    } catch {
      // Ignore malformed or unsupported external URLs.
    }
    return { action: "deny" };
  });
  mainWindow.webContents.on("will-navigate", (event, url) => {
    try {
      if (app.isPackaged) {
        if (fileURLToPath(new URL(url)) !== path.resolve(__dirname, "../dist/index.html")) event.preventDefault();
        return;
      }
      const devUrl = process.env.VITE_DEV_SERVER_URL;
      if (!devUrl || new URL(url).origin !== new URL(devUrl).origin) event.preventDefault();
    } catch {
      event.preventDefault();
    }
  });
  if (!app.isPackaged && process.env.VITE_DEV_SERVER_URL)
    void mainWindow.loadURL(process.env.VITE_DEV_SERVER_URL);
  else void mainWindow.loadFile(path.join(__dirname, "../dist/index.html"));
  return mainWindow;
}

app.setAppUserModelId("com.openzey.shea.pos");
protocol.registerSchemesAsPrivileged([
  { scheme: "shea-asset", privileges: { standard: true, secure: true, supportFetchAPI: true } },
]);

if (!app.requestSingleInstanceLock()) app.quit();
else {
  app.on("second-instance", () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });
  app.whenReady().then(() => {
    if (process.platform === "darwin") app.dock?.setIcon(applicationIcon());
    database = new PosDatabase(app.getPath("userData"));
    const assets = new ProductAssetService(database, app.getPath("userData"));
    protocol.handle("shea-asset", async (request) => {
      const url = new URL(request.url);
      if (url.hostname !== "local") return new Response("Not found", { status: 404 });
      const relative = decodeURIComponent(url.pathname).replace(/^\/+/, "");
      const target = path.resolve(assets.root, relative);
      const root = `${path.resolve(assets.root)}${path.sep}`;
      if (!target.startsWith(root)) return new Response("Forbidden", { status: 403 });
      try {
        const bytes = await readFile(target);
        const extension = path.extname(target).toLowerCase();
        const contentType = extension === ".png"
          ? "image/png"
          : extension === ".jpg" || extension === ".jpeg"
            ? "image/jpeg"
            : extension === ".gif"
              ? "image/gif"
              : "image/webp";
        return new Response(new Uint8Array(bytes), {
          headers: {
            "content-type": contentType,
            "content-length": String(bytes.byteLength),
            "cache-control": "private, max-age=31536000, immutable",
          },
        });
      } catch {
        return new Response("Not found", { status: 404 });
      }
    });
    void assets.initialize();
    const sync = new SyncService(database, assets);
    const gateway = new GatewayService(database);
    const existingState = sync.state();
    if (
      existingState.authenticated &&
      existingState.user?.id &&
      !database.getSetting("boundPartnerUserId")
    )
      database.setSetting("boundPartnerUserId", String(existingState.user.id));
    const access = new LocalAccessService(database);
    const window = createWindow();
    updater = new PosUpdater(window);
    registerIpc(database!, sync, access, assets, window, updater, gateway);
    updater.start();
    syncTimer = setInterval(() => {
      if (sync.state().authenticated) void sync.sync().catch(() => undefined);
    }, 60_000);
    if (sync.state().authenticated) void sync.sync().catch(() => undefined);
    else void assets.localizeActiveProducts();
  });
}

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
app.on("before-quit", () => {
  if (syncTimer) clearInterval(syncTimer);
  updater?.stop();
  database?.close();
});
