import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import type { PosDatabase } from "./database";
import { resolveProductImageUrl } from "./image-url";

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
    const extension = path.extname(sourcePath).toLowerCase();
    const mimeType = extension === ".png" ? "image/png"
      : extension === ".webp" ? "image/webp"
        : extension === ".jpg" || extension === ".jpeg" ? "image/jpeg"
          : "";
    if (!mimeType) throw new Error("Unsupported image format. Use JPG, PNG, or WebP");
    const details = await stat(sourcePath);
    if (!details.isFile() || !details.size || details.size > MAX_IMAGE_BYTES)
      throw new Error("Image must be smaller than 8 MB");
    return this.saveCatalogDraft(await readFile(sourcePath), mimeType);
  }

  async importCatalogDraftBytes(bytes: Buffer, mimeType: string) {
    if (!MIME_EXTENSIONS[mimeType]) throw new Error("Unsupported image format. Use JPG, PNG, or WebP");
    if (!bytes.length || bytes.length > MAX_IMAGE_BYTES) throw new Error("Image must be smaller than 8 MB");
    return this.saveCatalogDraft(bytes, mimeType);
  }

  async importCatalogDraftUrl(value: string) {
    const assetBase = this.database.getSetting("assetBase") ?? "";
    const url = resolveProductImageUrl(value.trim(), assetBase);
    if (!url) throw new Error("Enter a public HTTPS image URL");
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15_000);
    try {
      const response = await this.fetchImage(url, controller.signal);
      if (!response.ok) throw new Error(`Image download failed (${response.status})`);
      const mimeType = response.headers.get("content-type")?.split(";")[0].trim().toLowerCase() ?? "";
      if (!MIME_EXTENSIONS[mimeType]) throw new Error("URL must point directly to a JPG, PNG, or WebP image");
      const declaredSize = Number(response.headers.get("content-length") || 0);
      if (declaredSize > MAX_IMAGE_BYTES) throw new Error("Image must be smaller than 8 MB");
      return this.importCatalogDraftBytes(Buffer.from(await response.arrayBuffer()), mimeType);
    } finally {
      clearTimeout(timeout);
    }
  }

  private async saveCatalogDraft(bytes: Buffer, mimeType: string) {
    await this.initialize();
    if (!bytes.length || bytes.length > MAX_IMAGE_BYTES) throw new Error("Image must be smaller than 8 MB");
    const extension = MIME_EXTENSIONS[mimeType];
    const checksum = createHash("sha256").update(bytes).digest("hex");
    const filename = `${checksum.slice(0, 24)}-${randomUUID().slice(0, 8)}${extension}`;
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
    return this.database.getInventoryProductByLocalId(localId);
  }

  async refreshProducts(localIds?: string[]) {
    await this.initialize();
    const selected = localIds?.length ? new Set(localIds) : null;
    const rows = this.database
      .productImageCandidates()
      .filter((row) => !selected || selected.has(row.local_id));
    const results: Array<{ localId: string; ok: boolean; error?: string; image?: string | null }> = [];
    for (const row of rows) {
      try {
        await this.download(row, true, true);
        results.push({
          localId: row.local_id,
          ok: true,
          image: this.database.getInventoryProductImageByLocalId(row.local_id),
        });
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
      const response = await this.fetchImage(remoteUrl, controller.signal).finally(() => clearTimeout(timeout));
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
    const url = resolveProductImageUrl(value, base);
    if (!url) throw new Error("Product image URL is not a permitted public HTTPS source");
    return url;
  }

  private async fetchImage(initialUrl: URL, signal: AbortSignal) {
    const assetBase = this.database.getSetting("assetBase") ?? "";
    let url = initialUrl;
    for (let redirectCount = 0; redirectCount < 4; redirectCount += 1) {
      const response = await fetch(url, {
        signal,
        redirect: "manual",
        headers: { Accept: "image/avif,image/webp,image/png,image/jpeg,image/gif" },
      });
      if (![301, 302, 303, 307, 308].includes(response.status)) return response;
      const destination = response.headers.get("location");
      const next = destination ? resolveProductImageUrl(new URL(destination, url).toString(), assetBase) : null;
      if (!next) throw new Error("Product image redirect is not a permitted public HTTPS source");
      url = next;
    }
    throw new Error("Product image redirected too many times");
  }
}
