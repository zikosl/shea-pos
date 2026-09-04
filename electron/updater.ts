import { autoUpdater } from "electron-updater";
import type { BrowserWindow } from "electron";

export type UpdateStatus = {
  status: "idle" | "checking" | "available" | "not-available" | "downloading" | "downloaded" | "error";
  version?: string;
  percent?: number;
  error?: string;
};

const UPDATE_URL = process.env.POS_UPDATE_URL || "https://shea.openzey.com/downloads/pos";

export class PosUpdater {
  private current: UpdateStatus = { status: "idle" };
  private timer: NodeJS.Timeout | null = null;

  constructor(private readonly window: BrowserWindow) {
    autoUpdater.autoDownload = false;
    autoUpdater.autoInstallOnAppQuit = false;
    autoUpdater.allowPrerelease = false;
    autoUpdater.setFeedURL({ provider: "generic", url: UPDATE_URL });
    autoUpdater.on("checking-for-update", () => this.publish({ status: "checking" }));
    autoUpdater.on("update-available", (info) => this.publish({ status: "available", version: info.version }));
    autoUpdater.on("update-not-available", (info) => this.publish({ status: "not-available", version: info.version }));
    autoUpdater.on("download-progress", (progress) => this.publish({ status: "downloading", percent: progress.percent }));
    autoUpdater.on("update-downloaded", (info) => this.publish({ status: "downloaded", version: info.version, percent: 100 }));
    autoUpdater.on("error", (error) => this.publish({ status: "error", error: error.message }));
  }

  private publish(status: UpdateStatus) {
    this.current = status;
    if (!this.window.isDestroyed()) this.window.webContents.send("pos:update-status", status);
  }
  status() { return this.current; }

  async check(): Promise<UpdateStatus> {
    if (appIsPackaged()) {
      try { await autoUpdater.checkForUpdates(); }
      catch (error) { this.publish({ status: "error", error: error instanceof Error ? error.message : String(error) }); }
    } else this.publish({ status: "not-available" });
    return this.current;
  }
  async download() {
    if (this.current.status !== "available") return this.current;
    try { await autoUpdater.downloadUpdate(); }
    catch (error) { this.publish({ status: "error", error: error instanceof Error ? error.message : String(error) }); }
    return this.current;
  }
  install() {
    if (this.current.status !== "downloaded") throw new Error("UPDATE_NOT_READY");
    autoUpdater.quitAndInstall(false, true);
  }
  start() {
    if (this.timer || !appIsPackaged()) return;
    setTimeout(() => void this.check(), 30_000);
    this.timer = setInterval(() => void this.check(), 6 * 60 * 60 * 1000);
  }
  stop() { if (this.timer) clearInterval(this.timer); this.timer = null; }
}

function appIsPackaged() {
  return !process.defaultApp;
}
