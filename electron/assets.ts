import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import type { PosDatabase } from "./database";

const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
const MIME_EXTENSIONS: Record<string, string> = {
  "image/jpeg": ".jpg",
  "image/png": ".png",
  "image/webp": ".webp",
  "image/gif": ".gif",
};

export class ProductAssetService {
  readonly root: string;
  private readonly productsRoot: string;
  private readonly draftsRoot: string;
  private running: Promise<void> | null = null;

  constructor(
    private readonly database: PosDatabase,
    userDataPath: string,
  ) {
    this.root = path.join(userDataPath, "assets");
    this.productsRoot = path.join(this.root, "products");
    this.draftsRoot = path.join(this.root, "catalog-drafts");
  }

  async initialize() {
    await mkdir(this.productsRoot, { recursive: true });
    await mkdir(this.draftsRoot, { recursive: true });
  }

  async importCatalogDraft(sourcePath: string) {
    await this.initialize();
    const extension = path.extname(sourcePath).toLowerCase();
    const mimeType = extension === ".png" ? "image/png"
      : extension === ".webp" ? "image/webp"
        : extension === ".jpg" || extension === ".jpeg" ? "image/jpeg"
          : "";
    if (!mimeType) throw new Error("Unsupported image format. Use JPG, PNG, or WebP");
    const details = await stat(sourcePath);
    if (!details.isFile() || !details.size || details.size > MAX_IMAGE_BYTES)
      throw new Error("Image must be smaller than 8 MB");
    const bytes = await readFile(sourcePath);
    const checksum = createHash("sha256").update(bytes).digest("hex");
    const filename = `${checksum.slice(0, 24)}-${randomUUID().slice(0, 8)}${extension === ".jpeg" ? ".jpg" : extension}`;
    const relativePath = path.posix.join("catalog-drafts", filename);
    await writeFile(path.join(this.root, relativePath), bytes, { flag: "wx" }).catch(async (error: NodeJS.ErrnoException) => {
      if (error.code !== "EEXIST") throw error;
    });
    return {
      ref: `draft:${relativePath}`,
      previewUrl: `shea-asset://local/${relativePath}`,
      filename,
      mimeType,
    };
  }

  async readCatalogDraft(reference: string) {
    if (!reference.startsWith("draft:catalog-drafts/")) throw new Error("Invalid catalog draft image");
    const relativePath = reference.slice("draft:".length);
    const target = path.resolve(this.root, relativePath);
    const draftsRoot = `${path.resolve(this.draftsRoot)}${path.sep}`;
    if (!target.startsWith(draftsRoot)) throw new Error("Unsafe catalog draft image path");
    const extension = path.extname(target).toLowerCase();
    const mimeType = extension === ".png" ? "image/png" : extension === ".webp" ? "image/webp" : "image/jpeg";
    return { bytes: await readFile(target), filename: path.basename(target), mimeType };
  }

  localizeActiveProducts() {
    if (this.running) return this.running;
    this.running = this.runLocalization().finally(() => {
      this.running = null;
    });
    return this.running;
  }

  async localizeProduct(localId: string) {
    await this.initialize();
    const row = this.database.productImageCandidate(localId);
    if (row) await this.download(row);
  }

  async refreshProduct(localId: string) {
    await this.initialize();
    const row = this.database.productImageCandidate(localId);
    if (!row) throw new Error("This product does not have a server image path");
    await this.download(row, true, true);
    return this.database.getProductByLocalId(localId);
  }

  async refreshProducts(localIds?: string[]) {
    await this.initialize();
    const selected = localIds?.length ? new Set(localIds) : null;
    const rows = this.database
      .productImageCandidates()
      .filter((row) => !selected || selected.has(row.local_id));
    const results: Array<{ localId: string; ok: boolean; error?: string }> = [];
    for (const row of rows) {
      try {
        await this.download(row, true, true);
        results.push({ localId: row.local_id, ok: true });
      } catch (error) {
        results.push({
          localId: row.local_id,
          ok: false,
          error: error instanceof Error ? error.message : "Image download failed",
        });
      }
    }
    return {
      total: results.length,
      refreshed: results.filter((result) => result.ok).length,
      failed: results.filter((result) => !result.ok).length,
      results,
    };
  }

  private async runLocalization() {
    await this.initialize();
    const rows = this.database.productImageCandidates();
    for (const row of rows) await this.download(row);
  }

  private async download(row: { local_id: string; remote_image_url: string; local_image_path?: string | null; image_sync_state: string }, force = false, rethrow = false) {
    if (!force && row.local_image_path && row.image_sync_state === "READY") {
      try {
        await readFile(path.join(this.root, row.local_image_path));
        this.database.markProductImageReady(row.local_id, row.local_image_path);
        return;
      } catch {
        // A deleted cache file is downloaded again below.
      }
    }

    let temporaryPath = "";
    try {
      const remoteUrl = this.absoluteRemoteUrl(row.remote_image_url);
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 15_000);
      const response = await fetch(remoteUrl, {
        signal: controller.signal,
        redirect: "follow",
        headers: { Accept: "image/avif,image/webp,image/png,image/jpeg,image/gif" },
      }).finally(() => clearTimeout(timeout));
      if (!response.ok) throw new Error(`Image download failed (${response.status})`);
      const type = response.headers.get("content-type")?.split(";")[0].trim().toLowerCase() ?? "";
      const extension = MIME_EXTENSIONS[type];
      if (!extension) throw new Error("Unsupported product image format");
      const declaredSize = Number(response.headers.get("content-length") || 0);
      if (declaredSize > MAX_IMAGE_BYTES) throw new Error("Product image is larger than 8 MB");
      const bytes = Buffer.from(await response.arrayBuffer());
      if (!bytes.length || bytes.length > MAX_IMAGE_BYTES) throw new Error("Invalid product image size");
      const checksum = createHash("sha256").update(bytes).digest("hex");
      const filename = `${checksum.slice(0, 24)}-${randomUUID().slice(0, 8)}${extension}`;
      const relativePath = path.posix.join("products", filename);
      const destination = path.join(this.root, relativePath);
      temporaryPath = `${destination}.tmp`;
      await writeFile(temporaryPath, bytes, { flag: "wx" });
      await rename(temporaryPath, destination);
      this.database.markProductImageReady(row.local_id, relativePath, checksum);
      if (row.local_image_path && row.local_image_path !== relativePath)
        await rm(path.join(this.root, row.local_image_path), { force: true }).catch(() => undefined);
    } catch (error) {
      if (temporaryPath) await rm(temporaryPath, { force: true }).catch(() => undefined);
      this.database.markProductImageFailed(
        row.local_id,
        error instanceof Error ? error.message : "Image download failed",
      );
      if (rethrow) throw error;
    }
  }

  private absoluteRemoteUrl(value: string) {
    const base = this.database.getSetting("assetBase") ?? "";
    if (!base) throw new Error("The backend asset origin is not configured");
    const url = new URL(value, base || undefined);
    if (!['http:', 'https:'].includes(url.protocol)) throw new Error("Unsafe product image URL");
    const backend = new URL(base);
    if (url.origin !== backend.origin) throw new Error("Product image must use the configured Shea backend");
    if (!url.pathname.startsWith("/uploads/") && !url.pathname.startsWith("/api/uploads/"))
      throw new Error(`Invalid product image path: expected /uploads/... or /api/uploads/..., received ${url.pathname}`);
    return url.toString();
  }
}
