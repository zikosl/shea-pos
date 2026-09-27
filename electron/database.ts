import Database from "better-sqlite3";
import { randomUUID } from "node:crypto";
import { cpSync, existsSync, mkdirSync, readFileSync, renameSync, rmSync } from "node:fs";
import path from "node:path";
import type {
  ActivateProductInput,
  CheckoutInput,
  CreateLocalProductInput,
  CreateLocalProductBundleInput,
  CreateStockEntryInput,
  CreateCustomOrderInput,
  InvoiceDetailsCorrectionInput,
  HeldCartInput,
  ProposalInput,
  RefundSaleInput,
} from "./contracts";
import { calculateTotals, prepareLine } from "./domain/sale";

type BootstrapPayload = {
  schemaVersion: number;
  partner: Record<string, unknown>;
  device: { id: string; deviceKey: string; name?: string };
  catalog: {
    niches: any[];
    categories: any[];
    productTypes: any[];
    brands: any[];
    templates: any[];
  };
  products: any[];
  proposals: any[];
  productRequests?: any[];
  catalogSubmissions?: any[];
  provisionalProducts?: any[];
  orders: any[];
  openCashSession?: any;
  extensions?: { giftStore?: { orders?: any[]; templates?: any[] } | null };
};

export class PosDatabase {
  readonly db: Database.Database;
  private readonly userDataPath: string;
  private readonly assetRoot: string;
  private readonly imageDataUrlCache = new Map<string, string>();

  constructor(userDataPath: string) {
    this.userDataPath = userDataPath;
    this.db = new Database(path.join(userDataPath, "shea-pos.sqlite"));
    this.assetRoot = path.join(userDataPath, "assets");
    this.db.pragma("journal_mode = WAL");
    this.db.pragma("foreign_keys = ON");
    this.db.pragma("busy_timeout = 5000");
    this.migrate();

    // Existing activated installations predate deployment-mode onboarding.
    // Keep their current mode and reserve the setup screen for fresh databases.
    if (this.getSetting("device") && !this.getSetting("deploymentConfigured")) {
      if (!this.getSetting("deploymentMode")) this.setSetting("deploymentMode", "solo");
      this.setSetting("deploymentConfigured", "true");
    }
  }

  static applyStagedRestore(userDataPath: string) {
    const staged = path.join(userDataPath, ".restore-pending");
    const database = path.join(staged, "shea-pos.sqlite");
    if (!existsSync(database)) return false;
    const current = path.join(userDataPath, "shea-pos.sqlite");
    const rollback = path.join(userDataPath, `shea-pos.before-restore-${Date.now()}.sqlite`);
    if (existsSync(current)) renameSync(current, rollback);
    rmSync(`${current}-wal`, { force: true });
    rmSync(`${current}-shm`, { force: true });
    cpSync(database, current);
    const assets = path.join(staged, "assets");
    if (existsSync(assets)) {
      rmSync(path.join(userDataPath, "assets"), { recursive: true, force: true });
      cpSync(assets, path.join(userDataPath, "assets"), { recursive: true, force: true });
    }
    rmSync(staged, { recursive: true, force: true });
    return true;
  }

  async createBackup(destinationRoot: string) {
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    const target = path.join(destinationRoot, `Shea-POS-Backup-${stamp}`);
    mkdirSync(target, { recursive: false });
    await this.db.backup(path.join(target, "shea-pos.sqlite"));
    if (existsSync(this.assetRoot)) cpSync(this.assetRoot, path.join(target, "assets"), { recursive: true });
    return target;
  }

  stageRestore(source: string) {
    const sourceDatabase = path.join(source, "shea-pos.sqlite");
    if (!existsSync(sourceDatabase)) throw new Error("INVALID_BACKUP_FOLDER");
    const candidate = new Database(sourceDatabase, { readonly: true, fileMustExist: true });
    try {
      const result = candidate.pragma("quick_check", { simple: true });
      if (result !== "ok") throw new Error("BACKUP_INTEGRITY_CHECK_FAILED");
      const migration = candidate.prepare("SELECT MAX(version) version FROM schema_migrations").get() as any;
      if (!migration?.version) throw new Error("INVALID_BACKUP_DATABASE");
    } finally {
      candidate.close();
    }
    const staged = path.join(this.userDataPath, ".restore-pending");
    rmSync(staged, { recursive: true, force: true });
    mkdirSync(staged, { recursive: true });
    cpSync(sourceDatabase, path.join(staged, "shea-pos.sqlite"));
    const assets = path.join(source, "assets");
    if (existsSync(assets)) cpSync(assets, path.join(staged, "assets"), { recursive: true });
  }

  private migrate() {
    this.db.exec(`CREATE TABLE IF NOT EXISTS schema_migrations (
      version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );`);
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS settings (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL,
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
      CREATE TABLE IF NOT EXISTS niches (
        id INTEGER PRIMARY KEY, name TEXT NOT NULL, name_ar TEXT NOT NULL DEFAULT '', image TEXT NOT NULL DEFAULT ''
      );
      CREATE TABLE IF NOT EXISTS categories (
        id INTEGER PRIMARY KEY, niche_id INTEGER, name TEXT NOT NULL, name_ar TEXT NOT NULL DEFAULT '', image TEXT NOT NULL DEFAULT ''
      );
      CREATE TABLE IF NOT EXISTS product_types (
        id INTEGER PRIMARY KEY, category_id INTEGER NOT NULL, name TEXT NOT NULL, name_ar TEXT NOT NULL DEFAULT ''
      );
      CREATE TABLE IF NOT EXISTS brands (
        id INTEGER PRIMARY KEY, niche_id INTEGER, name TEXT NOT NULL, image TEXT NOT NULL DEFAULT ''
      );
      CREATE TABLE IF NOT EXISTS templates (
        id INTEGER PRIMARY KEY, category_id INTEGER NOT NULL, product_type_id INTEGER, brand_id INTEGER,
        name TEXT NOT NULL, name_ar TEXT NOT NULL DEFAULT '', description TEXT NOT NULL DEFAULT '', image TEXT
      );
      CREATE TABLE IF NOT EXISTS variants (
        id INTEGER PRIMARY KEY, template_id INTEGER NOT NULL, name TEXT, description TEXT, sku TEXT, image TEXT, tags_json TEXT NOT NULL DEFAULT '[]'
      );
      CREATE TABLE IF NOT EXISTS products (
        local_id TEXT PRIMARY KEY, server_id INTEGER UNIQUE, variant_id INTEGER, template_id INTEGER,
        category_id INTEGER, product_type_id INTEGER, brand_id INTEGER, name TEXT NOT NULL, variant_name TEXT,
        sku TEXT, barcode TEXT, image TEXT, price REAL NOT NULL DEFAULT 0, discount REAL NOT NULL DEFAULT 0,
        stock REAL NOT NULL DEFAULT 0, reorder_threshold REAL NOT NULL DEFAULT 0,
        inventory_policy TEXT NOT NULL DEFAULT 'TRACKED', available INTEGER NOT NULL DEFAULT 1,
        visible_in_pos INTEGER NOT NULL DEFAULT 1, active INTEGER NOT NULL DEFAULT 1,
        provisional INTEGER NOT NULL DEFAULT 0, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
      CREATE INDEX IF NOT EXISTS products_search_idx ON products(name, sku, barcode);
      CREATE INDEX IF NOT EXISTS products_category_idx ON products(category_id, active, visible_in_pos);
      CREATE TABLE IF NOT EXISTS catalog_proposals (
        local_id TEXT PRIMARY KEY, server_id TEXT UNIQUE, entity_type TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'LOCAL_DRAFT',
        name TEXT NOT NULL, name_ar TEXT NOT NULL DEFAULT '', description TEXT NOT NULL DEFAULT '', image TEXT,
        niche_id INTEGER NOT NULL, category_id INTEGER, parent_proposal_id TEXT,
        resolved_entity_id INTEGER, rejection_reason TEXT, sync_state TEXT NOT NULL DEFAULT 'PENDING',
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
      CREATE TABLE IF NOT EXISTS sales (
        id TEXT PRIMARY KEY, server_id TEXT, sale_number TEXT NOT NULL UNIQUE, status TEXT NOT NULL,
        customer_name TEXT, note TEXT, subtotal REAL NOT NULL, discount_total REAL NOT NULL,
        tax_total REAL NOT NULL, total REAL NOT NULL, payment_method TEXT NOT NULL,
        amount_tendered REAL, change_due REAL, sync_state TEXT NOT NULL DEFAULT 'PENDING',
        created_at TEXT NOT NULL, synced_at TEXT
      );
      CREATE TABLE IF NOT EXISTS sale_items (
        id TEXT PRIMARY KEY, sale_id TEXT NOT NULL, product_local_id TEXT NOT NULL, product_server_id INTEGER,
        product_name TEXT NOT NULL, variant_name TEXT, sku TEXT, quantity REAL NOT NULL,
        unit_price REAL NOT NULL, discount REAL NOT NULL DEFAULT 0, tax REAL NOT NULL DEFAULT 0, total REAL NOT NULL,
        FOREIGN KEY(sale_id) REFERENCES sales(id) ON DELETE CASCADE
      );
      CREATE TABLE IF NOT EXISTS stock_movements (
        id TEXT PRIMARY KEY, product_local_id TEXT NOT NULL, sale_id TEXT, type TEXT NOT NULL,
        quantity_delta REAL NOT NULL, stock_before REAL NOT NULL, stock_after REAL NOT NULL,
        reason TEXT, sync_state TEXT NOT NULL DEFAULT 'PENDING', created_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS orders (
        server_id INTEGER PRIMARY KEY, status TEXT, total REAL NOT NULL DEFAULT 0, customer_name TEXT,
        payload_json TEXT NOT NULL, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
      CREATE TABLE IF NOT EXISTS outbox (
        id TEXT PRIMARY KEY, operation TEXT NOT NULL, aggregate_type TEXT NOT NULL, aggregate_id TEXT NOT NULL,
        payload_json TEXT NOT NULL, state TEXT NOT NULL DEFAULT 'PENDING', attempts INTEGER NOT NULL DEFAULT 0,
        next_attempt_at TEXT, last_error TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS outbox_pending_idx ON outbox(state, next_attempt_at, created_at);
    `);
    this.db
      .prepare("INSERT OR IGNORE INTO schema_migrations(version) VALUES (1)")
      .run();
    const hasRegisterMigration = this.db
      .prepare("SELECT 1 FROM schema_migrations WHERE version=2")
      .get();
    if (!hasRegisterMigration)
      this.db.transaction(() => {
        this.db.exec(`
        CREATE TABLE cash_sessions (
          local_id TEXT PRIMARY KEY, server_id TEXT UNIQUE, status TEXT NOT NULL,
          opening_amount REAL NOT NULL DEFAULT 0, expected_cash REAL NOT NULL DEFAULT 0,
          counted_cash REAL, difference REAL, note TEXT,
          sync_state TEXT NOT NULL DEFAULT 'PENDING', opened_at TEXT NOT NULL,
          closed_at TEXT
        );
        CREATE INDEX cash_sessions_status_idx ON cash_sessions(status, opened_at);
      `);
        this.db
          .prepare("INSERT INTO schema_migrations(version) VALUES (2)")
          .run();
      })();
    const hasProfitMigration = this.db
      .prepare("SELECT 1 FROM schema_migrations WHERE version=3")
      .get();
    if (!hasProfitMigration)
      this.db.transaction(() => {
        this.db.exec(`
        ALTER TABLE products ADD COLUMN cost_price REAL NOT NULL DEFAULT 0;
        ALTER TABLE sales ADD COLUMN cost_total REAL NOT NULL DEFAULT 0;
        ALTER TABLE sales ADD COLUMN gross_profit REAL NOT NULL DEFAULT 0;
        ALTER TABLE sales ADD COLUMN partner_fee REAL NOT NULL DEFAULT 0;
        ALTER TABLE sales ADD COLUMN net_profit REAL NOT NULL DEFAULT 0;
        ALTER TABLE sale_items ADD COLUMN cost_price REAL NOT NULL DEFAULT 0;
        ALTER TABLE sale_items ADD COLUMN profit REAL NOT NULL DEFAULT 0;
        CREATE INDEX stock_movements_created_idx ON stock_movements(created_at,type);
      `);
        this.db
          .prepare("INSERT INTO schema_migrations(version) VALUES (3)")
          .run();
      })();
    const hasProductRequestMigration = this.db
      .prepare("SELECT 1 FROM schema_migrations WHERE version=4")
      .get();
    if (!hasProductRequestMigration)
      this.db.transaction(() => {
        this.db.exec(`
          ALTER TABLE products ADD COLUMN request_server_id INTEGER;
          ALTER TABLE products ADD COLUMN request_status TEXT;
          ALTER TABLE products ADD COLUMN rejection_reason TEXT;
        `);
        this.db
          .prepare("INSERT INTO schema_migrations(version) VALUES (4)")
          .run();
      })();
    const hasStockEntryMigration = this.db
      .prepare("SELECT 1 FROM schema_migrations WHERE version=5")
      .get();
    if (!hasStockEntryMigration)
      this.db.transaction(() => {
        this.db.exec(`
          CREATE TABLE stock_entries (
            id TEXT PRIMARY KEY, entry_number TEXT NOT NULL UNIQUE,
            status TEXT NOT NULL DEFAULT 'POSTED', supplier_name TEXT,
            supplier_invoice TEXT, entry_date TEXT NOT NULL, note TEXT,
            total_cost REAL NOT NULL DEFAULT 0, created_at TEXT NOT NULL,
            cancelled_at TEXT
          );
          CREATE TABLE stock_entry_items (
            id TEXT PRIMARY KEY, entry_id TEXT NOT NULL, product_local_id TEXT NOT NULL,
            product_name TEXT NOT NULL, variant_name TEXT, quantity REAL NOT NULL,
            pricing_mode TEXT NOT NULL, entered_price REAL NOT NULL,
            unit_cost REAL NOT NULL, total_cost REAL NOT NULL,
            stock_before REAL NOT NULL, stock_after REAL NOT NULL,
            cost_before REAL NOT NULL, cost_after REAL NOT NULL,
            FOREIGN KEY(entry_id) REFERENCES stock_entries(id) ON DELETE CASCADE
          );
          CREATE INDEX stock_entries_date_idx ON stock_entries(entry_date,status);
          CREATE INDEX stock_entry_items_entry_idx ON stock_entry_items(entry_id);
          ALTER TABLE stock_movements ADD COLUMN stock_entry_id TEXT;
        `);
        this.db.prepare("INSERT INTO schema_migrations(version) VALUES (5)").run();
      })();
    const hasLocalUsersMigration = this.db
      .prepare("SELECT 1 FROM schema_migrations WHERE version=6")
      .get();
    if (!hasLocalUsersMigration)
      this.db.transaction(() => {
        this.db.exec(`
          CREATE TABLE local_users (
            id TEXT PRIMARY KEY, name TEXT NOT NULL, username TEXT NOT NULL UNIQUE,
            password_hash TEXT NOT NULL, role TEXT NOT NULL,
            permissions_json TEXT NOT NULL DEFAULT '[]', active INTEGER NOT NULL DEFAULT 1,
            failed_attempts INTEGER NOT NULL DEFAULT 0, locked_until TEXT,
            created_at TEXT NOT NULL, updated_at TEXT NOT NULL, last_login_at TEXT
          );
          CREATE INDEX local_users_active_idx ON local_users(active,name);
          CREATE TABLE audit_logs (
            id TEXT PRIMARY KEY, user_id TEXT, user_name TEXT NOT NULL,
            action TEXT NOT NULL, entity_type TEXT, entity_id TEXT,
            details_json TEXT, created_at TEXT NOT NULL
          );
          CREATE INDEX audit_logs_created_idx ON audit_logs(created_at,action);
        `);
        this.db.prepare("INSERT INTO schema_migrations(version) VALUES (6)").run();
      })();
    const hasOperatorAttributionMigration = this.db
      .prepare("SELECT 1 FROM schema_migrations WHERE version=7")
      .get();
    if (!hasOperatorAttributionMigration)
      this.db.transaction(() => {
        this.db.exec(`
          ALTER TABLE sales ADD COLUMN operator_id TEXT;
          ALTER TABLE sales ADD COLUMN operator_name TEXT;
          ALTER TABLE stock_entries ADD COLUMN operator_id TEXT;
          ALTER TABLE stock_entries ADD COLUMN operator_name TEXT;
        `);
        this.db.prepare("INSERT INTO schema_migrations(version) VALUES (7)").run();
      })();
    const hasLocalProductImagesMigration = this.db
      .prepare("SELECT 1 FROM schema_migrations WHERE version=8")
      .get();
    if (!hasLocalProductImagesMigration)
      this.db.transaction(() => {
        this.db.exec(`
          ALTER TABLE products ADD COLUMN remote_image_url TEXT;
          ALTER TABLE products ADD COLUMN local_image_path TEXT;
          ALTER TABLE products ADD COLUMN image_sync_state TEXT NOT NULL DEFAULT 'PENDING';
          ALTER TABLE products ADD COLUMN image_checksum TEXT;
          ALTER TABLE products ADD COLUMN image_sync_error TEXT;
          UPDATE products SET remote_image_url=image
          WHERE image IS NOT NULL AND image<>'';
          CREATE INDEX products_image_sync_idx ON products(active,image_sync_state);
        `);
        this.db.prepare("INSERT INTO schema_migrations(version) VALUES (8)").run();
      })();
    const hasGiftStoreMigration = this.db
      .prepare("SELECT 1 FROM schema_migrations WHERE version=9")
      .get();
    if (!hasGiftStoreMigration)
      this.db.transaction(() => {
        this.db.exec(`
          CREATE TABLE custom_orders (
            id TEXT PRIMARY KEY, order_number TEXT NOT NULL, customer_name TEXT NOT NULL,
            status TEXT NOT NULL, required_at TEXT, fulfillment_mode TEXT NOT NULL,
            total REAL NOT NULL DEFAULT 0, version INTEGER NOT NULL DEFAULT 1,
            payload_json TEXT NOT NULL, updated_at TEXT NOT NULL
          );
          CREATE INDEX custom_orders_status_idx ON custom_orders(status,required_at,updated_at);
          CREATE TABLE gift_templates (
            id TEXT PRIMARY KEY, name TEXT NOT NULL, occasion TEXT, image TEXT,
            payload_json TEXT NOT NULL, updated_at TEXT NOT NULL
          );
        `);
        this.db.prepare("INSERT INTO schema_migrations(version) VALUES (9)").run();
      })();
    const hasGiftSyncMigration = this.db.prepare("SELECT 1 FROM schema_migrations WHERE version=10").get();
    if (!hasGiftSyncMigration)
      this.db.transaction(() => {
        this.db.exec(`
          ALTER TABLE custom_orders ADD COLUMN server_id TEXT;
          ALTER TABLE custom_orders ADD COLUMN sync_state TEXT NOT NULL DEFAULT 'SYNCED';
          ALTER TABLE custom_orders ADD COLUMN last_error TEXT;
          ALTER TABLE custom_orders ADD COLUMN created_at TEXT;
          CREATE UNIQUE INDEX custom_orders_server_idx ON custom_orders(server_id);
          UPDATE custom_orders SET server_id=id,created_at=updated_at;
        `);
        this.db.prepare("INSERT INTO schema_migrations(version) VALUES (10)").run();
      })();
    const hasGiftNicheMigration = this.db.prepare("SELECT 1 FROM schema_migrations WHERE version=11").get();
    if (!hasGiftNicheMigration)
      this.db.transaction(() => {
        this.db.exec("ALTER TABLE custom_orders ADD COLUMN niche_id INTEGER;");
        this.db.prepare("INSERT INTO schema_migrations(version) VALUES (11)").run();
      })();
    const hasUnifiedWorkflowMigration = this.db.prepare("SELECT 1 FROM schema_migrations WHERE version=12").get();
    if (!hasUnifiedWorkflowMigration)
      this.db.transaction(() => {
        this.db.exec(`
          ALTER TABLE products ADD COLUMN price_on_request INTEGER NOT NULL DEFAULT 0;
          ALTER TABLE orders ADD COLUMN delivery_status TEXT;
          ALTER TABLE orders ADD COLUMN pricing_mode TEXT NOT NULL DEFAULT 'FIXED';
          ALTER TABLE orders ADD COLUMN version INTEGER NOT NULL DEFAULT 1;
        `);
        this.db.prepare("INSERT INTO schema_migrations(version) VALUES (12)").run();
      })();
    const hasOrderSyncStateMigration = this.db.prepare("SELECT 1 FROM schema_migrations WHERE version=13").get();
    if (!hasOrderSyncStateMigration)
      this.db.transaction(() => {
        this.db.exec(`
          ALTER TABLE orders ADD COLUMN sync_state TEXT NOT NULL DEFAULT 'SYNCED';
          ALTER TABLE orders ADD COLUMN last_error TEXT;
        `);
        this.db.prepare("INSERT INTO schema_migrations(version) VALUES (13)").run();
      })();
    const hasInvoiceCorrectionMigration = this.db.prepare("SELECT 1 FROM schema_migrations WHERE version=14").get();
    if (!hasInvoiceCorrectionMigration)
      this.db.transaction(() => {
        this.db.exec(`
          ALTER TABLE sales ADD COLUMN revision INTEGER NOT NULL DEFAULT 1;
          ALTER TABLE sales ADD COLUMN corrected_at TEXT;
          CREATE TABLE invoice_revisions (
            id TEXT PRIMARY KEY, sale_id TEXT NOT NULL, revision INTEGER NOT NULL,
            customer_name_before TEXT, customer_name_after TEXT,
            note_before TEXT, note_after TEXT, reason TEXT NOT NULL,
            operator_id TEXT, operator_name TEXT, created_at TEXT NOT NULL,
            FOREIGN KEY(sale_id) REFERENCES sales(id) ON DELETE CASCADE,
            UNIQUE(sale_id, revision)
          );
          CREATE INDEX invoice_revisions_sale_idx ON invoice_revisions(sale_id,revision DESC);
        `);
        this.db.prepare("INSERT INTO schema_migrations(version) VALUES (14)").run();
      })();
    const hasRetailSafetyMigration = this.db.prepare("SELECT 1 FROM schema_migrations WHERE version=15").get();
    if (!hasRetailSafetyMigration)
      this.db.transaction(() => {
        this.db.exec(`
          ALTER TABLE sales ADD COLUMN refunded_total REAL NOT NULL DEFAULT 0;
          ALTER TABLE sales ADD COLUMN refunded_at TEXT;
          ALTER TABLE sale_items ADD COLUMN returned_quantity REAL NOT NULL DEFAULT 0;
          CREATE TABLE sale_refunds (
            id TEXT PRIMARY KEY, server_id TEXT UNIQUE, sale_id TEXT NOT NULL,
            amount REAL NOT NULL, reason TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'COMPLETED',
            sync_state TEXT NOT NULL DEFAULT 'PENDING', operator_id TEXT, operator_name TEXT,
            created_at TEXT NOT NULL, synced_at TEXT,
            FOREIGN KEY(sale_id) REFERENCES sales(id) ON DELETE RESTRICT
          );
          CREATE TABLE sale_refund_items (
            id TEXT PRIMARY KEY, refund_id TEXT NOT NULL, sale_item_id TEXT NOT NULL,
            product_local_id TEXT NOT NULL, quantity REAL NOT NULL, amount REAL NOT NULL,
            FOREIGN KEY(refund_id) REFERENCES sale_refunds(id) ON DELETE CASCADE,
            FOREIGN KEY(sale_item_id) REFERENCES sale_items(id) ON DELETE RESTRICT
          );
          CREATE INDEX sale_refunds_sale_idx ON sale_refunds(sale_id,created_at DESC);
          CREATE TABLE held_carts (
            id TEXT PRIMARY KEY, name TEXT, customer_name TEXT, payload_json TEXT NOT NULL,
            operator_id TEXT, operator_name TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
          );
          CREATE INDEX held_carts_updated_idx ON held_carts(updated_at DESC);
        `);
        this.db.prepare("INSERT INTO schema_migrations(version) VALUES (15)").run();
      })();
  }

  private productImageUrl(row: any) {
    if (!row.local_image_path) return null;
    const relativePath = String(row.local_image_path).replace(/\\/g, "/");
    const cached = this.imageDataUrlCache.get(relativePath);
    if (cached) return cached;
    const target = path.resolve(this.assetRoot, relativePath);
    const root = `${path.resolve(this.assetRoot)}${path.sep}`;
    if (!target.startsWith(root)) return null;
    try {
      const extension = path.extname(target).toLowerCase();
      const contentType = extension === ".png"
        ? "image/png"
        : extension === ".jpg" || extension === ".jpeg"
          ? "image/jpeg"
          : extension === ".gif"
            ? "image/gif"
            : "image/webp";
      const dataUrl = `data:${contentType};base64,${readFileSync(target).toString("base64")}`;
      this.imageDataUrlCache.set(relativePath, dataUrl);
      return dataUrl;
    } catch {
      return null;
    }
  }

  productImageCandidates() {
    return this.db.prepare(
      `SELECT local_id,remote_image_url,local_image_path,image_sync_state FROM products
       WHERE active=1 AND remote_image_url IS NOT NULL AND remote_image_url<>''
       ORDER BY updated_at`,
    ).all() as Array<{ local_id: string; remote_image_url: string; local_image_path?: string | null; image_sync_state: string }>;
  }

  productImageCandidate(localId: string) {
    return this.db.prepare(
      `SELECT local_id,remote_image_url,local_image_path,image_sync_state FROM products
       WHERE local_id=? AND active=1 AND remote_image_url IS NOT NULL AND remote_image_url<>''`,
    ).get(localId) as { local_id: string; remote_image_url: string; local_image_path?: string | null; image_sync_state: string } | undefined;
  }

  markProductImageReady(localId: string, relativePath: string, checksum?: string) {
    this.imageDataUrlCache.delete(relativePath);
    this.db.prepare(
      "UPDATE products SET local_image_path=?,image_checksum=COALESCE(?,image_checksum),image_sync_state='READY',image_sync_error=NULL WHERE local_id=?",
    ).run(relativePath, checksum ?? null, localId);
  }

  markProductImageFailed(localId: string, message: string) {
    this.db.prepare(
      "UPDATE products SET image_sync_state='FAILED',image_sync_error=? WHERE local_id=?",
    ).run(message.slice(0, 500), localId);
  }

  getSetting(key: string) {
    return (
      this.db.prepare("SELECT value FROM settings WHERE key = ?").get(key) as
        { value: string } | undefined
    )?.value;
  }

  setSetting(key: string, value: string) {
    this.db
      .prepare(
        `INSERT INTO settings(key, value, updated_at) VALUES (?, ?, CURRENT_TIMESTAMP)
      ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = CURRENT_TIMESTAMP`,
      )
      .run(key, value);
  }

  deleteSetting(key: string) {
    this.db.prepare("DELETE FROM settings WHERE key = ?").run(key);
  }

  getSettings() {
    return Object.fromEntries(
      (
        this.db.prepare("SELECT key, value FROM settings").all() as Array<{
          key: string;
          value: string;
        }>
      ).map((row) => [row.key, row.value]),
    );
  }

  countPendingOutbox() {
    return (
      this.db
        .prepare(
          "SELECT COUNT(*) AS count FROM outbox WHERE state IN ('PENDING','ERROR','BLOCKED')",
        )
        .get() as { count: number }
    ).count;
  }

  listCatalog() {
    const assetBase = this.getSetting("assetBase") ?? "";
    const asset = (value?: string) =>
      value?.startsWith("/") ? `${assetBase}${value}` : value;
    const result = {
      niches: this.db.prepare("SELECT * FROM niches ORDER BY name").all(),
      categories: this.db
        .prepare(
          `SELECT c.*,COUNT(p.local_id) product_count FROM categories c LEFT JOIN products p ON p.category_id=c.id AND p.active=1 AND p.visible_in_pos=1 GROUP BY c.id ORDER BY c.name`,
        )
        .all(),
      productTypes: this.db
        .prepare("SELECT * FROM product_types ORDER BY name")
        .all(),
      brands: this.db.prepare("SELECT * FROM brands ORDER BY name").all(),
    } as any;
    result.niches = result.niches.map((row: any) => ({
      ...row,
      image: asset(row.image),
    }));
    result.categories = result.categories.map((row: any) => ({
      ...row,
      image: asset(row.image),
    }));
    result.brands = result.brands.map((row: any) => ({
      ...row,
      image: asset(row.image),
    }));
    return result;
  }

  listTemplates(
    input: {
      search?: string;
      categoryId?: number;
      nicheId?: number;
      limit?: number;
      offset?: number;
    } = {},
  ) {
    const search = `%${input.search?.trim() ?? ""}%`;
    const rows = this.db
      .prepare(
        `SELECT v.id variant_id,v.template_id,v.name variant_name,v.description variant_description,
      v.sku,v.image,v.tags_json,t.name,t.name_ar,t.description,t.category_id,t.product_type_id,t.brand_id,t.image template_image,
      p.local_id product_local_id
      FROM variants v JOIN templates t ON t.id=v.template_id
      LEFT JOIN products p ON p.variant_id=v.id AND p.active=1
      WHERE (? IS NULL OR t.category_id=?)
        AND (t.name LIKE ? OR COALESCE(t.name_ar,'') LIKE ? OR COALESCE(v.name,'') LIKE ? OR COALESCE(v.sku,'') LIKE ?)
      ORDER BY t.name,COALESCE(v.name,'') LIMIT ? OFFSET ?`,
      )
      .all(
        input.categoryId ?? null,
        input.categoryId ?? null,
        search,
        search,
        search,
        search,
        Math.min(input.limit ?? 100, 250),
        input.offset ?? 0,
      ) as any[];
    const assetBase = this.getSetting("assetBase") ?? "";
    return rows.map((row) => {
      const image = row.image || row.template_image;
      return {
        ...row,
        image: image?.startsWith("/") ? `${assetBase}${image}` : image,
        tags: JSON.parse(row.tags_json || "[]"),
      };
    });
  }

  overview(input: { from?: string; to?: string } = {}) {
    const from =
      input.from ?? new Date(new Date().setHours(0, 0, 0, 0)).toISOString();
    const to = input.to ?? new Date().toISOString();
    const summary = this.db
      .prepare(
        `SELECT COUNT(*) sale_count,COALESCE(SUM(s.total-s.refunded_total),0) revenue,
      COALESCE(SUM(s.cost_total*(CASE WHEN s.total>0 THEN (s.total-s.refunded_total)/s.total ELSE 0 END)),0) cost,
      COALESCE(SUM(s.gross_profit*(CASE WHEN s.total>0 THEN (s.total-s.refunded_total)/s.total ELSE 0 END)),0) gross_profit,
      COALESCE(SUM(s.partner_fee*(CASE WHEN s.total>0 THEN (s.total-s.refunded_total)/s.total ELSE 0 END)),0) partner_fee,
      COALESCE(SUM(s.net_profit*(CASE WHEN s.total>0 THEN (s.total-s.refunded_total)/s.total ELSE 0 END)),0) net_profit,
      COALESCE(AVG(s.total-s.refunded_total),0) average_sale FROM sales s WHERE s.status IN ('COMPLETED','PARTIALLY_REFUNDED','REFUNDED') AND s.created_at BETWEEN ? AND ?`,
      )
      .get(from, to);
    const stock = this.db
      .prepare(
        "SELECT COUNT(*) total, SUM(CASE WHEN inventory_policy='TRACKED' AND stock<=reorder_threshold THEN 1 ELSE 0 END) low FROM products WHERE active=1",
      )
      .get();
    const payments = this.db
      .prepare(
        `SELECT s.payment_method method,COUNT(*) count,COALESCE(SUM(s.total-s.refunded_total),0) total
        FROM sales s WHERE s.status IN ('COMPLETED','PARTIALLY_REFUNDED','REFUNDED') AND s.created_at BETWEEN ? AND ?
        GROUP BY s.payment_method ORDER BY total DESC`,
      )
      .all(from, to);
    const topProducts = this.db
      .prepare(
        `SELECT si.product_name,si.variant_name,SUM(si.quantity-si.returned_quantity) quantity,
        COALESCE(SUM(si.total*(si.quantity-si.returned_quantity)/si.quantity),0) revenue,
        COALESCE(SUM(si.profit*(si.quantity-si.returned_quantity)/si.quantity),0) profit
        FROM sale_items si JOIN sales s ON s.id=si.sale_id
        WHERE s.status IN ('COMPLETED','PARTIALLY_REFUNDED','REFUNDED') AND s.created_at BETWEEN ? AND ?
        GROUP BY si.product_name,si.variant_name ORDER BY revenue DESC LIMIT 8`,
      )
      .all(from, to);
    const trend = this.db
      .prepare(
        `SELECT date(s.created_at,'localtime') day,COUNT(*) count,
        COALESCE(SUM(s.total-s.refunded_total),0) revenue,
        COALESCE(SUM(s.net_profit*(CASE WHEN s.total>0 THEN (s.total-s.refunded_total)/s.total ELSE 0 END)),0) net_profit
        FROM sales s WHERE s.status IN ('COMPLETED','PARTIALLY_REFUNDED','REFUNDED') AND s.created_at BETWEEN ? AND ?
        GROUP BY day ORDER BY day`,
      )
      .all(from, to);
    return {
      summary,
      stock,
      payments,
      topProducts,
      trend,
      pendingChanges: this.countPendingOutbox(),
      from,
      to,
    };
  }

  applyBootstrap(
    payload: BootstrapPayload,
    cursor: string,
    offlineUntil: string,
  ) {
    this.db.transaction(() => {
      const upsertNiche = this.db.prepare(
        "INSERT OR REPLACE INTO niches(id,name,name_ar,image) VALUES (@id,@name,@name_ar,@image)",
      );
      const upsertCategory = this.db.prepare(
        "INSERT OR REPLACE INTO categories(id,niche_id,name,name_ar,image) VALUES (@id,@niche_id,@name,@name_ar,@image)",
      );
      const upsertType = this.db.prepare(
        "INSERT OR REPLACE INTO product_types(id,category_id,name,name_ar) VALUES (@id,@category_id,@name,@name_ar)",
      );
      const upsertBrand = this.db.prepare(
        "INSERT OR REPLACE INTO brands(id,niche_id,name,image) VALUES (@id,@niche_id,@name,@image)",
      );
      const upsertTemplate = this.db.prepare(
        "INSERT OR REPLACE INTO templates(id,category_id,product_type_id,brand_id,name,name_ar,description,image) VALUES (@id,@category_id,@product_type_id,@brand_id,@name,@name_ar,@description,@image)",
      );
      const upsertVariant = this.db.prepare(
        "INSERT OR REPLACE INTO variants(id,template_id,name,description,sku,image,tags_json) VALUES (@id,@template_id,@name,@description,@sku,@image,@tags_json)",
      );
      const upsertProduct = this.db
        .prepare(`INSERT INTO products(local_id,server_id,variant_id,template_id,category_id,product_type_id,brand_id,name,variant_name,sku,barcode,image,remote_image_url,price,cost_price,discount,stock,reorder_threshold,inventory_policy,available,visible_in_pos,active,price_on_request,provisional,updated_at)
        VALUES (@local_id,@server_id,@variant_id,@template_id,@category_id,@product_type_id,@brand_id,@name,@variant_name,@sku,@barcode,@image,@image,@price,@cost_price,@discount,@stock,@reorder_threshold,@inventory_policy,@available,@visible_in_pos,@active,@price_on_request,0,CURRENT_TIMESTAMP)
        ON CONFLICT(local_id) DO UPDATE SET server_id=excluded.server_id,variant_id=excluded.variant_id,template_id=excluded.template_id,category_id=excluded.category_id,product_type_id=excluded.product_type_id,brand_id=excluded.brand_id,name=excluded.name,variant_name=excluded.variant_name,sku=excluded.sku,barcode=excluded.barcode,image=excluded.image,remote_image_url=excluded.remote_image_url,image_sync_state=CASE WHEN COALESCE(products.remote_image_url,'')<>COALESCE(excluded.remote_image_url,'') THEN 'PENDING' ELSE products.image_sync_state END,price=excluded.price,cost_price=excluded.cost_price,discount=excluded.discount,stock=excluded.stock,reorder_threshold=excluded.reorder_threshold,inventory_policy=excluded.inventory_policy,available=excluded.available,visible_in_pos=excluded.visible_in_pos,active=excluded.active,price_on_request=excluded.price_on_request,provisional=0,updated_at=CURRENT_TIMESTAMP`);

      this.db.exec(
        "DELETE FROM niches; DELETE FROM categories; DELETE FROM product_types; DELETE FROM brands; DELETE FROM templates; DELETE FROM variants;",
      );
      for (const row of payload.catalog.niches)
        upsertNiche.run({
          id: row.id,
          name: row.name,
          name_ar: row.name_ar ?? "",
          image: row.image ?? "",
        });
      for (const row of payload.catalog.categories)
        upsertCategory.run({
          id: row.id,
          niche_id: row.niche_id ?? null,
          name: row.name,
          name_ar: row.name_ar ?? "",
          image: row.image ?? "",
        });
      for (const row of payload.catalog.productTypes)
        upsertType.run({
          id: row.id,
          category_id: row.category_id,
          name: row.name,
          name_ar: row.name_ar ?? "",
        });
      for (const row of payload.catalog.brands)
        upsertBrand.run({
          id: row.id,
          niche_id: row.niche_id ?? null,
          name: row.name,
          image: row.image ?? "",
        });
      for (const row of payload.catalog.templates) {
        upsertTemplate.run({
          id: row.id,
          category_id: row.category_id,
          product_type_id: row.product_type_id ?? null,
          brand_id: row.brand_id ?? null,
          name: row.name,
          name_ar: row.name_ar ?? "",
          description: row.description ?? "",
          image: row.images?.[0]?.url ?? null,
        });
        for (const variant of row.variants ?? [])
          upsertVariant.run({
            id: variant.id,
            template_id: row.id,
            name: variant.name ?? null,
            description: variant.description ?? null,
            sku: variant.sku ?? null,
            image: variant.images?.[0]?.url ?? row.images?.[0]?.url ?? null,
            tags_json: JSON.stringify(
              (variant.tags ?? []).map((tag: any) => tag.value),
            ),
          });
      }
      const localIdByVariant = new Map<number, string>();
      for (const request of payload.productRequests ?? []) {
        if (!request.posLocalId) continue;
        // Legacy single-product requests use the request local id directly.
        this.db
          .prepare(
            "UPDATE products SET request_server_id=?,request_status=?,rejection_reason=?,updated_at=CURRENT_TIMESTAMP WHERE local_id=?",
          )
          .run(
            request.id,
            request.status,
            request.rejectionReason ?? null,
            request.posLocalId,
          );
        for (const variant of request.variants ?? []) {
          const productLocalId = variant.localId ?? request.posLocalId;
          this.db
            .prepare(
              "UPDATE products SET request_server_id=?,request_status=?,rejection_reason=?,updated_at=CURRENT_TIMESTAMP WHERE local_id=?",
            )
            .run(request.id, request.status, request.rejectionReason ?? null, productLocalId);
          if (variant.resolvedVariantId)
            localIdByVariant.set(variant.resolvedVariantId, productLocalId);
        }
      }
      for (const row of payload.products) {
        const template = row.variant?.product;
        const existing = this.db
          .prepare(
            "SELECT local_id FROM products WHERE server_id=? OR (variant_id=? AND provisional=1) ORDER BY provisional DESC LIMIT 1",
          )
          .get(row.id, row.variantId) as { local_id: string } | undefined;
        const localId =
          existing?.local_id ??
          localIdByVariant.get(row.variantId) ??
          `server:${row.id}`;
        upsertProduct.run({
          local_id: localId,
          server_id: row.id,
          variant_id: row.variantId,
          template_id: row.variant?.productId ?? null,
          category_id: template?.category_id ?? null,
          product_type_id: template?.product_type_id ?? null,
          brand_id: template?.brand_id ?? null,
          name: row.customName ?? template?.name ?? "Product",
          variant_name: row.variant?.name ?? null,
          sku: row.vendorSku ?? row.variant?.sku ?? null,
          barcode: row.vendorBarcode ?? null,
          image:
            row.customImages?.[0] ??
            row.variant?.images?.[0]?.url ??
            template?.images?.[0]?.url ??
            null,
          price: row.price ?? 0,
          cost_price: row.costPrice ?? 0,
          discount: row.discount ?? 0,
          stock: row.stock ?? 0,
          reorder_threshold: row.reorderThreshold ?? 0,
          available: row.available ? 1 : 0,
          visible_in_pos: row.isVisibleInPos ? 1 : 0,
          active: row.isActive ? 1 : 0,
          price_on_request: row.priceOnRequest ? 1 : 0,
          inventory_policy:
            row.trackInventory === false ? "UNLIMITED" : "TRACKED",
        });
        if (localIdByVariant.get(row.variantId) === localId) {
          this.db
            .prepare(
              "UPDATE sale_items SET product_server_id=? WHERE product_local_id=?",
            )
            .run(row.id, localId);
          const blocked = this.db
            .prepare(
              "SELECT id,payload_json FROM outbox WHERE state='BLOCKED' AND operation='CREATE_SALE'",
            )
            .all() as any[];
          for (const blockedRow of blocked) {
            const blockedPayload = JSON.parse(blockedRow.payload_json);
            let changed = false;
            blockedPayload.items = blockedPayload.items.map((item: any) => {
              if (item.product_local_id !== localId) return item;
              changed = true;
              return { ...item, product_server_id: row.id };
            });
            if (changed)
              this.db
                .prepare(
                  "UPDATE outbox SET payload_json=?,state=?,next_attempt_at=NULL,updated_at=CURRENT_TIMESTAMP WHERE id=?",
                )
                .run(
                  JSON.stringify(blockedPayload),
                  blockedPayload.items.some(
                    (item: any) => !item.product_server_id,
                  )
                    ? "BLOCKED"
                    : "PENDING",
                  blockedRow.id,
                );
          }
        }
      }

      const upsertProposal = this.db
        .prepare(`INSERT INTO catalog_proposals(local_id,server_id,entity_type,status,name,name_ar,description,image,niche_id,category_id,parent_proposal_id,resolved_entity_id,rejection_reason,sync_state,updated_at)
        VALUES (@local_id,@server_id,@entity_type,@status,@name,@name_ar,@description,@image,@niche_id,@category_id,@parent_proposal_id,@resolved_entity_id,@rejection_reason,'SYNCED',CURRENT_TIMESTAMP)
        ON CONFLICT(local_id) DO UPDATE SET server_id=excluded.server_id,status=excluded.status,resolved_entity_id=excluded.resolved_entity_id,rejection_reason=excluded.rejection_reason,sync_state='SYNCED',updated_at=CURRENT_TIMESTAMP`);
      for (const row of payload.proposals)
        upsertProposal.run({
          local_id: row.localId,
          server_id: row.id,
          entity_type: row.entityType,
          status: row.status,
          name: row.name,
          name_ar: row.name_ar ?? "",
          description: row.description ?? "",
          image: row.image ?? null,
          niche_id: row.nicheId,
          category_id: row.categoryId ?? null,
          parent_proposal_id: row.parentProposalId ?? null,
          resolved_entity_id:
            row.resolvedCategoryId ?? row.resolvedProductTypeId ?? null,
          rejection_reason: row.rejectionReason ?? null,
        });

      this.db.exec("DELETE FROM orders");
      const upsertOrder = this.db.prepare(
        "INSERT INTO orders(server_id,status,delivery_status,pricing_mode,version,total,customer_name,payload_json,updated_at) VALUES (?,?,?,?,?,?,?,?,CURRENT_TIMESTAMP)",
      );
      const deliveryStatuses = [
        "PENDING",
        "ACCEPTED",
        "READY",
        "ASSIGNED",
        "PICKED",
        "DELIVERED",
        "CANCELED",
      ];
      for (const row of payload.orders) {
        const rawStatus = row.delivery?.status;
        const status =
          typeof rawStatus === "number"
            ? (deliveryStatuses[rawStatus] ?? "PENDING")
            : (rawStatus?.toString() ?? "PENDING");
        upsertOrder.run(
          row.id,
          row.status ?? "REQUESTED",
          status,
          row.pricingMode ?? "FIXED",
          row.version ?? 1,
          Math.max(0, Number(row.subtotal ?? 0) + Number(row.appTax ?? 0) + Number(row.deliveryTax ?? 0) + Number(row.storeTax ?? 0) - Number(row.discount ?? 0)),
          row.walkInCustomerName ?? null,
          JSON.stringify(row),
        );
      }

      this.db.prepare("DELETE FROM custom_orders WHERE sync_state='SYNCED'").run();
      this.db.exec("DELETE FROM gift_templates;");
      const upsertCustomOrder = this.db.prepare(
        `INSERT INTO custom_orders(id,server_id,order_number,customer_name,status,required_at,fulfillment_mode,total,version,payload_json,sync_state,created_at,updated_at,niche_id)
         VALUES (?,?,?,?,?,?,?,?,?,?,'SYNCED',?,?,?)
         ON CONFLICT(server_id) DO UPDATE SET order_number=excluded.order_number,customer_name=excluded.customer_name,status=excluded.status,required_at=excluded.required_at,fulfillment_mode=excluded.fulfillment_mode,total=excluded.total,version=excluded.version,payload_json=excluded.payload_json,niche_id=excluded.niche_id,sync_state='SYNCED',last_error=NULL,updated_at=excluded.updated_at`,
      );
      for (const row of payload.extensions?.giftStore?.orders ?? [])
        upsertCustomOrder.run(
          row.id,
          row.id,
          row.orderNumber,
          row.customerName,
          row.status,
          row.requiredAt ?? null,
          row.fulfillmentMode,
          row.total ?? 0,
          row.version ?? 1,
          JSON.stringify(row),
          row.createdAt ?? row.updatedAt ?? new Date().toISOString(),
          row.updatedAt ?? new Date().toISOString(),
          row.nicheId ?? null,
        );
      const upsertGiftTemplate = this.db.prepare(
        "INSERT INTO gift_templates(id,name,occasion,image,payload_json,updated_at) VALUES (?,?,?,?,?,?)",
      );
      for (const row of payload.extensions?.giftStore?.templates ?? [])
        upsertGiftTemplate.run(
          row.id,
          row.name,
          row.occasion ?? null,
          row.image ?? null,
          JSON.stringify(row),
          row.updatedAt ?? new Date().toISOString(),
        );

      if (payload.openCashSession) {
        const row = payload.openCashSession;
        const local = this.db
          .prepare(
            "SELECT local_id FROM cash_sessions WHERE server_id=? OR (status='OPEN' AND sync_state!='SYNCED') ORDER BY opened_at DESC LIMIT 1",
          )
          .get(row.id) as { local_id: string } | undefined;
        this.db
          .prepare(
            `INSERT INTO cash_sessions(local_id,server_id,status,opening_amount,expected_cash,counted_cash,difference,note,sync_state,opened_at,closed_at)
          VALUES (?,?,?,?,?,?,?,?, 'SYNCED',?,?)
          ON CONFLICT(local_id) DO UPDATE SET server_id=excluded.server_id,status=excluded.status,opening_amount=excluded.opening_amount,expected_cash=excluded.expected_cash,counted_cash=excluded.counted_cash,difference=excluded.difference,note=excluded.note,sync_state='SYNCED',opened_at=excluded.opened_at,closed_at=excluded.closed_at`,
          )
          .run(
            local?.local_id ?? `server:${row.id}`,
            row.id,
            row.status,
            row.openingAmount ?? 0,
            row.expectedCash ?? 0,
            row.countedCash ?? null,
            row.difference ?? null,
            row.note ?? null,
            row.openedAt,
            row.closedAt ?? null,
          );
      }

      this.setSetting("partner", JSON.stringify(payload.partner));
      this.setSetting("capabilities", JSON.stringify((payload.partner as any).capabilities ?? []));
      this.setSetting("device", JSON.stringify(payload.device));
      this.setSetting("syncCursor", cursor);
      this.setSetting("offlineUntil", offlineUntil);
      this.setSetting("lastSyncAt", new Date().toISOString());
    })();
  }

  listProducts(
    input: {
      search?: string;
      categoryId?: number;
      nicheId?: number;
      limit?: number;
      offset?: number;
    } = {},
  ) {
    const search = `%${input.search?.trim() ?? ""}%`;
    const rows = this.db
      .prepare(
        `SELECT p.*,t.name_ar FROM products p LEFT JOIN templates t ON t.id=p.template_id LEFT JOIN categories c ON c.id=p.category_id WHERE p.active=1 AND p.visible_in_pos=1
      AND (? IS NULL OR p.category_id=?) AND (? IS NULL OR c.niche_id=?) AND (p.name LIKE ? OR COALESCE(t.name_ar,'') LIKE ? OR COALESCE(p.sku,'') LIKE ? OR COALESCE(p.barcode,'') LIKE ? OR COALESCE(p.variant_name,'') LIKE ?)
      ORDER BY p.name LIMIT ? OFFSET ?`,
      )
      .all(
        input.categoryId ?? null,
        input.categoryId ?? null,
        input.nicheId ?? null,
        input.nicheId ?? null,
        search,
        search,
        search,
        search,
        search,
        Math.min(input.limit ?? 100, 250),
        input.offset ?? 0,
      );
    return (rows as any[]).map((row) => ({
      ...row,
      image: this.productImageUrl(row),
    }));
  }

  listInventory(
    input: { search?: string; limit?: number; offset?: number } = {},
  ) {
    const search = `%${input.search?.trim() ?? ""}%`;
    const rows = this.db
      .prepare(
        `SELECT p.*,t.name_ar FROM products p LEFT JOIN templates t ON t.id=p.template_id WHERE p.name LIKE ? OR COALESCE(t.name_ar,'') LIKE ? OR COALESCE(p.sku,'') LIKE ? OR COALESCE(p.barcode,'') LIKE ? OR COALESCE(p.variant_name,'') LIKE ? ORDER BY p.name LIMIT ? OFFSET ?`,
      )
      .all(
        search,
        search,
        search,
        search,
        search,
        Math.min(input.limit ?? 100, 250),
        input.offset ?? 0,
      );
    return (rows as any[]).map((row) => ({
      ...row,
      image: this.productImageUrl(row),
    }));
  }

  listMovements(
    input: {
      search?: string;
      type?: string;
      productLocalId?: string;
      limit?: number;
      offset?: number;
    } = {},
  ) {
    const search = `%${input.search?.trim() ?? ""}%`;
    return this.db
      .prepare(
        `SELECT m.*,p.name product_name,t.name_ar product_name_ar,p.variant_name,p.sku FROM stock_movements m JOIN products p ON p.local_id=m.product_local_id LEFT JOIN templates t ON t.id=p.template_id
      WHERE (? IS NULL OR m.type=?) AND (? IS NULL OR m.product_local_id=?)
      AND (p.name LIKE ? OR COALESCE(p.variant_name,'') LIKE ? OR COALESCE(p.sku,'') LIKE ? OR COALESCE(m.reason,'') LIKE ?)
      ORDER BY m.created_at DESC,m.rowid DESC LIMIT ? OFFSET ?`,
      )
      .all(
        input.type ?? null,
        input.type ?? null,
        input.productLocalId ?? null,
        input.productLocalId ?? null,
        search,
        search,
        search,
        search,
        Math.min(input.limit ?? 100, 500),
        input.offset ?? 0,
      );
  }

  listSales() {
    return this.db
      .prepare("SELECT * FROM sales ORDER BY created_at DESC LIMIT 250")
      .all();
  }

  getSaleDetails(id: string) {
    const sale = this.db.prepare("SELECT * FROM sales WHERE id=?").get(id);
    if (!sale) throw new Error("INVOICE_NOT_FOUND");
    return {
      sale,
      items: this.db.prepare("SELECT * FROM sale_items WHERE sale_id=? ORDER BY rowid").all(id),
      refunds: this.db.prepare("SELECT * FROM sale_refunds WHERE sale_id=? ORDER BY created_at DESC").all(id),
    };
  }

  listHeldCarts() {
    return (this.db.prepare("SELECT * FROM held_carts ORDER BY updated_at DESC").all() as any[])
      .map((row) => ({ ...row, payload: JSON.parse(row.payload_json) }));
  }

  holdCart(input: HeldCartInput & { operatorId?: string; operatorName?: string }) {
    if (!input.lines.length) throw new Error("Add at least one product");
    const id = input.id ?? randomUUID();
    const now = new Date().toISOString();
    const lines = input.lines.map((line) => {
      const product = this.db.prepare("SELECT local_id,name,variant_name,price,discount,stock,inventory_policy,image FROM products WHERE local_id=? AND active=1").get(line.productLocalId) as any;
      if (!product) throw new Error("Product is no longer available");
      return { product, quantity: line.quantity, unitPrice: line.unitPrice };
    });
    this.db.prepare(`INSERT INTO held_carts(id,name,customer_name,payload_json,operator_id,operator_name,created_at,updated_at)
      VALUES (?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET name=excluded.name,customer_name=excluded.customer_name,
      payload_json=excluded.payload_json,operator_id=excluded.operator_id,operator_name=excluded.operator_name,updated_at=excluded.updated_at`)
      .run(id, input.name?.trim() || null, input.customerName?.trim() || null, JSON.stringify({ lines }), input.operatorId ?? null, input.operatorName ?? null, now, now);
    return this.listHeldCarts().find((cart: any) => cart.id === id);
  }

  deleteHeldCart(id: string) {
    this.db.prepare("DELETE FROM held_carts WHERE id=?").run(id);
  }
  listOrders() {
    return this.db
      .prepare("SELECT * FROM orders ORDER BY updated_at DESC LIMIT 100")
      .all();
  }
  queueOnlineOrderCommand(id: number, operation: "TRANSITION_ONLINE_ORDER" | "CREATE_ONLINE_ORDER_QUOTATION", optimisticStatus: string, command: Record<string, unknown>) {
    const row = this.db.prepare("SELECT * FROM orders WHERE server_id=?").get(id) as any;
    if (!row) throw new Error("Order not found");
    if (Number(command.expectedVersion) !== Number(row.version)) throw new Error("ORDER_VERSION_CONFLICT");
    this.db.transaction(() => {
      this.db.prepare("UPDATE orders SET status=?,version=version+1,sync_state='PENDING',last_error=NULL,updated_at=CURRENT_TIMESTAMP WHERE server_id=?").run(optimisticStatus, id);
      this.enqueue(operation, "Order", String(id), command);
    })();
    return this.db.prepare("SELECT * FROM orders WHERE server_id=?").get(id);
  }
  markOnlineOrderSynced(order: any) {
    const current = this.db.prepare("SELECT payload_json,total FROM orders WHERE server_id=?").get(order.id) as any;
    let payload = {}; try { payload = JSON.parse(current?.payload_json ?? "{}"); } catch { /* Replace malformed cache. */ }
    this.db.prepare("UPDATE orders SET status=?,version=?,total=?,payload_json=?,sync_state='SYNCED',last_error=NULL,updated_at=CURRENT_TIMESTAMP WHERE server_id=?")
      .run(order.status, order.version, order.total ?? current?.total ?? 0, JSON.stringify({ ...payload, ...order }), order.id);
  }
  listGiftOrders() {
    return this.db.prepare(
      "SELECT * FROM custom_orders ORDER BY CASE WHEN required_at IS NULL THEN 1 ELSE 0 END,required_at,updated_at DESC",
    ).all();
  }
  createCustomOrder(input: CreateCustomOrderInput) {
    const id = randomUUID();
    const now = new Date().toISOString();
    const orderNumber = `GFT-LOCAL-${Date.now().toString(36).toUpperCase()}`;
    const lines = input.lines.map((line) => {
      const product = line.productLocalId
        ? this.db.prepare("SELECT server_id,name,cost_price FROM products WHERE local_id=? AND active=1").get(line.productLocalId) as any
        : null;
      return {
        productId: product?.server_id ?? undefined,
        name: line.name.trim() || product?.name,
        description: line.description?.trim() || undefined,
        quantity: line.quantity,
        unitPrice: line.unitPrice,
        unitCost: line.unitCost ?? product?.cost_price ?? 0,
      };
    });
    const subtotal = lines.reduce((sum, line) => sum + line.quantity * line.unitPrice, 0);
    const payload = { ...input, orderNumber, lines, targetStatus: "REQUESTED" };
    const snapshot = { ...payload, id, status: "REQUESTED", subtotal, total: Math.max(0, subtotal - (input.discount ?? 0)), version: 1, createdAt: now, updatedAt: now };
    this.db.transaction(() => {
      this.db.prepare(`INSERT INTO custom_orders(id,order_number,customer_name,status,required_at,fulfillment_mode,total,version,payload_json,sync_state,created_at,updated_at,niche_id)
        VALUES (?,?,?,?,?,?,?,?,?,'PENDING',?,?,?)`).run(id, orderNumber, input.customerName.trim(), "REQUESTED", input.requiredAt ?? null, input.fulfillmentMode, snapshot.total, 1, JSON.stringify(snapshot), now, now, input.nicheId ?? null);
      this.enqueue("CREATE_CUSTOM_ORDER", "CustomOrder", id, payload);
    })();
    return this.db.prepare("SELECT * FROM custom_orders WHERE id=?").get(id);
  }

  transitionCustomOrder(id: string, status: string) {
    const row = this.db.prepare("SELECT * FROM custom_orders WHERE id=?").get(id) as any;
    if (!row) throw new Error("Custom order not found");
    if (!row.server_id) throw new Error("Synchronize this new order before changing its workflow");
    const expectedVersion = row.version;
    this.db.transaction(() => {
      this.db.prepare("UPDATE custom_orders SET status=?,version=version+1,sync_state='PENDING',updated_at=CURRENT_TIMESTAMP WHERE id=?").run(status, id);
      this.enqueue("TRANSITION_CUSTOM_ORDER", "CustomOrder", id, { serverId: row.server_id, status, expectedVersion });
    })();
    return this.db.prepare("SELECT * FROM custom_orders WHERE id=?").get(id);
  }

  queueCustomOrderCommand(id: string, operation: "CREATE_CUSTOM_ORDER_QUOTATION" | "RESERVE_CUSTOM_ORDER_MATERIALS", optimisticStatus: string, command: Record<string, unknown> = {}) {
    const row = this.db.prepare("SELECT * FROM custom_orders WHERE id=?").get(id) as any;
    if (!row) throw new Error("Custom order not found");
    if (!row.server_id) throw new Error("Synchronize this new order before changing its workflow");
    this.db.transaction(() => {
      const versionIncrement = operation === "CREATE_CUSTOM_ORDER_QUOTATION" ? 1 : 0;
      let total = row.total;
      let payloadJson = row.payload_json;
      if (operation === "CREATE_CUSTOM_ORDER_QUOTATION" && Array.isArray(command.lines)) {
        const subtotal = command.lines.reduce((sum: number, line: any) => sum + Number(line.quantity) * Number(line.unitPrice), 0);
        total = Math.max(0, subtotal - Number(command.discount ?? 0));
        let snapshot: any = {};
        try { snapshot = JSON.parse(row.payload_json ?? "{}"); } catch { /* Replace malformed cache. */ }
        payloadJson = JSON.stringify({ ...snapshot, lines: command.lines, proposedFor: command.proposedFor ?? snapshot.proposedFor, discount: command.discount ?? 0, subtotal, total });
      }
      this.db.prepare("UPDATE custom_orders SET status=?,version=version+?,total=?,payload_json=?,sync_state='PENDING',updated_at=CURRENT_TIMESTAMP WHERE id=?").run(optimisticStatus, versionIncrement, total, payloadJson, id);
      const { id: _ignored, ...payload } = command;
      this.enqueue(operation, "CustomOrder", id, { ...payload, serverId: row.server_id });
    })();
    return this.db.prepare("SELECT * FROM custom_orders WHERE id=?").get(id);
  }

  markCustomOrderCreated(localId: string, order: any) {
    this.db.prepare("UPDATE custom_orders SET server_id=?,status=?,version=?,payload_json=?,sync_state='SYNCED',last_error=NULL,updated_at=? WHERE id=?")
      .run(order.id, order.status, order.version, JSON.stringify(order), order.updatedAt ?? new Date().toISOString(), localId);
  }

  markCustomOrderTransitioned(localId: string, order: any) {
    this.db.prepare("UPDATE custom_orders SET status=?,version=?,payload_json=?,sync_state='SYNCED',last_error=NULL,updated_at=? WHERE id=?")
      .run(order.status, order.version, JSON.stringify(order), order.updatedAt ?? new Date().toISOString(), localId);
  }

  markCustomOrderCommandSynced(localId: string) {
    this.db.prepare("UPDATE custom_orders SET sync_state='SYNCED',last_error=NULL,updated_at=CURRENT_TIMESTAMP WHERE id=?").run(localId);
  }
  listInvoices() {
    const sales = this.listSales().map((row: any) => ({
      id: row.id,
      number: row.sale_number,
      source: "POS",
      customer_name: row.customer_name,
      status: row.status,
      total: row.total,
      refunded_total: row.refunded_total,
      refunded_at: row.refunded_at,
      sync_state: row.sync_state,
      operator_name: row.operator_name,
      note: row.note,
      revision: row.revision,
      corrected_at: row.corrected_at,
      created_at: row.created_at,
    }));
    const orders = this.listOrders().map((row: any) => {
      let payload: any = {};
      try { payload = JSON.parse(row.payload_json); } catch { /* Keep the local row usable. */ }
      return {
        id: String(row.server_id),
        number: `ORD-${row.server_id}`,
        source: "DELIVERY",
        customer_name: row.customer_name ?? payload.walkInCustomerName ?? payload.client?.user?.name,
        status: row.status,
        total: row.total,
        sync_state: "SYNCED",
        created_at: payload.createdAt ?? payload.date ?? row.updated_at,
      };
    });
    return [...sales, ...orders].sort(
      (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime(),
    );
  }
  lookupInvoice(reference: string) {
    const scanned = reference.trim();
    if (!scanned) throw new Error("INVOICE_REFERENCE_REQUIRED");
    const qr = /^shea:invoice:v1:(POS|DELIVERY):(.+)$/i.exec(scanned);
    const source = qr?.[1]?.toUpperCase();
    const number = (qr?.[2] ?? scanned).trim();

    if (!source || source === "POS") {
      const sale = this.db.prepare(
        "SELECT * FROM sales WHERE UPPER(sale_number)=UPPER(?) OR id=? LIMIT 1",
      ).get(number, number) as any;
      if (sale) return {
        id: sale.id,
        number: sale.sale_number,
        source: "POS",
        customer_name: sale.customer_name,
        status: sale.status,
        total: sale.total,
        sync_state: sale.sync_state,
        operator_name: sale.operator_name,
        note: sale.note,
        revision: sale.revision,
        corrected_at: sale.corrected_at,
        created_at: sale.created_at,
      };
    }

    if (!source || source === "DELIVERY") {
      const orderNumber = number.replace(/^ORD-/i, "");
      const order = this.db.prepare("SELECT * FROM orders WHERE CAST(server_id AS TEXT)=? LIMIT 1").get(orderNumber) as any;
      if (order) {
        let payload: any = {};
        try { payload = JSON.parse(order.payload_json); } catch { /* Keep lookup available for malformed cache rows. */ }
        return {
          id: String(order.server_id),
          number: `ORD-${order.server_id}`,
          source: "DELIVERY",
          customer_name: order.customer_name ?? payload.walkInCustomerName ?? payload.client?.user?.name,
          status: order.status,
          total: order.total,
          sync_state: "SYNCED",
          created_at: payload.createdAt ?? payload.date ?? order.updated_at,
        };
      }
    }
    throw new Error("INVOICE_NOT_FOUND");
  }
  correctInvoiceDetails(input: InvoiceDetailsCorrectionInput) {
    const reason = input.reason.trim();
    if (reason.length < 3) throw new Error("INVOICE_CORRECTION_REASON_REQUIRED");
    return this.db.transaction(() => {
      const sale = this.db.prepare("SELECT * FROM sales WHERE id=?").get(input.id) as any;
      if (!sale) throw new Error("INVOICE_NOT_FOUND");
      if (sale.status !== "COMPLETED") throw new Error("INVOICE_NOT_EDITABLE");
      const customerName = input.customerName?.trim() || null;
      const note = input.note?.trim() || null;
      if (customerName === sale.customer_name && note === sale.note) throw new Error("INVOICE_CORRECTION_UNCHANGED");
      const revision = Number(sale.revision ?? 1) + 1;
      const now = new Date().toISOString();
      this.db.prepare(
        `INSERT INTO invoice_revisions(id,sale_id,revision,customer_name_before,customer_name_after,note_before,note_after,reason,operator_id,operator_name,created_at)
         VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
      ).run(randomUUID(), sale.id, revision, sale.customer_name, customerName, sale.note, note, reason, input.operatorId ?? null, input.operatorName ?? null, now);
      this.db.prepare("UPDATE sales SET customer_name=?,note=?,revision=?,corrected_at=? WHERE id=?")
        .run(customerName, note, revision, now, sale.id);
      const pending = this.db.prepare(
        "SELECT id,payload_json FROM outbox WHERE aggregate_type='Sale' AND aggregate_id=? AND operation='CREATE_SALE' AND state<>'SYNCED'",
      ).all(sale.id) as Array<{ id: string; payload_json: string }>;
      for (const row of pending) {
        let payload: Record<string, unknown> = {};
        try { payload = JSON.parse(row.payload_json); } catch { /* Keep the correction even if an old queue row is malformed. */ }
        this.db.prepare("UPDATE outbox SET payload_json=?,updated_at=? WHERE id=?")
          .run(JSON.stringify({ ...payload, customerName, note }), now, row.id);
      }
      return {
        ...(this.db.prepare("SELECT * FROM sales WHERE id=?").get(sale.id) as object),
        revisions: this.db.prepare("SELECT * FROM invoice_revisions WHERE sale_id=? ORDER BY revision DESC").all(sale.id),
      };
    })();
  }
  getOrder(serverId: string | number) {
    const row = this.db.prepare("SELECT * FROM orders WHERE server_id=?").get(serverId) as any;
    if (!row) throw new Error("Delivery invoice not found");
    return { ...row, payload: JSON.parse(row.payload_json) };
  }
  listStockEntries() {
    return this.db.prepare(
      `SELECT e.*,COUNT(i.id) item_count FROM stock_entries e
       LEFT JOIN stock_entry_items i ON i.entry_id=e.id
       GROUP BY e.id ORDER BY e.entry_date DESC,e.created_at DESC LIMIT 250`,
    ).all();
  }
  getStockEntry(id: string) {
    const entry = this.db.prepare("SELECT * FROM stock_entries WHERE id=?").get(id);
    if (!entry) throw new Error("Stock entry not found");
    return {
      entry,
      items: this.db.prepare("SELECT * FROM stock_entry_items WHERE entry_id=? ORDER BY rowid").all(id),
    };
  }
  createStockEntry(input: CreateStockEntryInput) {
    if (!input.lines.length) throw new Error("Add at least one product");
    if (new Set(input.lines.map((line) => line.productLocalId)).size !== input.lines.length)
      throw new Error("A product can only appear once in a stock entry");
    if (input.lines.some((line) => !Number.isFinite(line.quantity) || line.quantity <= 0 || !Number.isFinite(line.price) || line.price < 0))
      throw new Error("Stock entry quantities and prices are invalid");
    return this.db.transaction(() => {
      const id = randomUUID();
      const now = new Date().toISOString();
      const entryDate = input.entryDate ?? now;
      const entryNumber = `GRN-${entryDate.slice(0, 10).replaceAll("-", "")}-${id.slice(0, 4).toUpperCase()}`;
      let totalCost = 0;
      this.db.prepare(
        `INSERT INTO stock_entries(id,entry_number,status,supplier_name,supplier_invoice,entry_date,note,total_cost,created_at,operator_id,operator_name)
         VALUES (?,?,'POSTED',?,?,?,?,0,?,?,?)`,
      ).run(id, entryNumber, input.supplierName ?? null, input.supplierInvoice ?? null, entryDate, input.note ?? null, now, input.operatorId ?? null, input.operatorName ?? null);
      for (const line of input.lines) {
        const product = this.getProductByLocalId(line.productLocalId);
        if (!product) throw new Error("Product not found");
        if (product.inventory_policy !== "TRACKED") throw new Error(`${product.name} does not track stock`);
        const unitCost = line.pricingMode === "TOTAL" ? line.price / line.quantity : line.price;
        const lineTotal = unitCost * line.quantity;
        const nextStock = Number(product.stock) + line.quantity;
        const nextCost = nextStock > 0
          ? ((Number(product.stock) * Number(product.cost_price)) + lineTotal) / nextStock
          : unitCost;
        this.db.prepare(
          `INSERT INTO stock_entry_items(id,entry_id,product_local_id,product_name,variant_name,quantity,pricing_mode,entered_price,unit_cost,total_cost,stock_before,stock_after,cost_before,cost_after)
           VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        ).run(randomUUID(), id, product.local_id, product.name, product.variant_name, line.quantity, line.pricingMode, line.price, unitCost, lineTotal, product.stock, nextStock, product.cost_price, nextCost);
        this.db.prepare("UPDATE products SET stock=?,cost_price=?,updated_at=CURRENT_TIMESTAMP WHERE local_id=?")
          .run(nextStock, nextCost, product.local_id);
        this.db.prepare(
          `INSERT INTO stock_movements(id,product_local_id,stock_entry_id,type,quantity_delta,stock_before,stock_after,reason,sync_state,created_at)
           VALUES (?,?,?,'RECEIPT',?,?,?,?, 'PENDING',?)`,
        ).run(randomUUID(), product.local_id, id, line.quantity, product.stock, nextStock, entryNumber, now);
        if (product.server_id && !input.gatewayCommitted) this.enqueue("UPDATE_PRODUCT", "Product", product.local_id, {
          serverId: product.server_id,
          stock: nextStock,
          costPrice: nextCost,
        });
        totalCost += lineTotal;
      }
      this.db.prepare("UPDATE stock_entries SET total_cost=? WHERE id=?").run(totalCost, id);
      return this.getStockEntry(id);
    })();
  }
  cancelStockEntry(id: string, gatewayCommitted = false) {
    return this.db.transaction(() => {
      const record = this.getStockEntry(id) as any;
      if (record.entry.status !== "POSTED") throw new Error("Only posted entries can be cancelled");
      const now = new Date().toISOString();
      for (const item of record.items) {
        const product = this.getProductByLocalId(item.product_local_id);
        if (!product || Number(product.stock) < Number(item.quantity))
          throw new Error(`Cannot reverse ${item.product_name}: stock has already been consumed`);
        const nextStock = Number(product.stock) - Number(item.quantity);
        const remainingValue = (Number(product.stock) * Number(product.cost_price)) - Number(item.total_cost);
        const nextCost = nextStock > 0 ? Math.max(0, remainingValue / nextStock) : 0;
        this.db.prepare("UPDATE products SET stock=?,cost_price=?,updated_at=CURRENT_TIMESTAMP WHERE local_id=?")
          .run(nextStock, nextCost, product.local_id);
        this.db.prepare(
          `INSERT INTO stock_movements(id,product_local_id,stock_entry_id,type,quantity_delta,stock_before,stock_after,reason,sync_state,created_at)
           VALUES (?,?,?,'REMOVAL',?,?,?,?, 'PENDING',?)`,
        ).run(randomUUID(), product.local_id, id, -Number(item.quantity), product.stock, nextStock, `CANCEL ${record.entry.entry_number}`, now);
        if (product.server_id && !gatewayCommitted) this.enqueue("UPDATE_PRODUCT", "Product", product.local_id, {
          serverId: product.server_id,
          stock: nextStock,
          costPrice: nextCost,
        });
      }
      this.db.prepare("UPDATE stock_entries SET status='CANCELLED',cancelled_at=? WHERE id=?").run(now, id);
      return this.getStockEntry(id);
    })();
  }
  listProposals() {
    return this.db
      .prepare("SELECT * FROM catalog_proposals ORDER BY created_at DESC")
      .all();
  }
  listOutbox() {
    return this.db
      .prepare(
        "SELECT id,operation,aggregate_type,aggregate_id,state,attempts,last_error,created_at,updated_at FROM outbox WHERE state!='SYNCED' ORDER BY created_at DESC LIMIT 200",
      )
      .all();
  }
  pendingOutbox(forceRetry = false) {
    return this.db
      .prepare(
        `SELECT * FROM outbox WHERE state IN ('PENDING','ERROR')
         AND (${forceRetry ? "1=1" : "next_attempt_at IS NULL OR next_attempt_at <= CURRENT_TIMESTAMP"})
         ORDER BY created_at LIMIT 50`,
      )
      .all() as any[];
  }

  retryOutbox(id: string) {
    const row = this.db.prepare("SELECT aggregate_type,aggregate_id FROM outbox WHERE id=?").get(id) as any;
    this.db
      .prepare(
        "UPDATE outbox SET state='PENDING',next_attempt_at=NULL,last_error=NULL,updated_at=CURRENT_TIMESTAMP WHERE id=? AND state IN ('ERROR','BLOCKED')",
      )
      .run(id);
    if (row?.aggregate_type === "Order") {
      this.db.prepare("UPDATE orders SET sync_state='PENDING',last_error=NULL WHERE server_id=?").run(Number(row.aggregate_id));
    }
  }

  activateProduct(input: ActivateProductInput) {
    return this.db.transaction(() => {
      const variant = this.db
        .prepare(
          `SELECT v.*,t.name template_name,t.category_id,t.product_type_id,t.brand_id,t.image template_image
        FROM variants v JOIN templates t ON t.id=v.template_id WHERE v.id=?`,
        )
        .get(input.variantId) as any;
      if (!variant) throw new Error("Catalog variant not found");
      const existing = this.db
        .prepare(
          "SELECT local_id FROM products WHERE variant_id=? AND active=1",
        )
        .get(input.variantId);
      if (existing)
        throw new Error("This variant is already active in your store");
      const localId = randomUUID();
      this.db
        .prepare(
          `INSERT INTO products(local_id,variant_id,template_id,category_id,product_type_id,brand_id,name,variant_name,sku,image,remote_image_url,price,cost_price,stock,reorder_threshold,inventory_policy,available,visible_in_pos,active,price_on_request,provisional)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,1,?,1,?,1)`,
        )
        .run(
          localId,
          variant.id,
          variant.template_id,
          variant.category_id,
          variant.product_type_id,
          variant.brand_id,
          variant.template_name,
          variant.name,
          variant.sku,
          variant.image || variant.template_image,
          variant.image || variant.template_image,
          input.price,
          input.costPrice ?? 0,
          input.stock,
          input.reorderThreshold ?? 0,
          input.trackInventory ? "TRACKED" : "UNLIMITED",
          input.visibleInPos === false ? 0 : 1,
          input.priceOnRequest ? 1 : 0,
        );
      this.enqueue("ACTIVATE_PRODUCT", "Product", localId, {
        localId,
        ...input,
      });
      return this.db
        .prepare("SELECT * FROM products WHERE local_id=?")
        .get(localId);
    })();
  }

  createLocalProduct(input: CreateLocalProductInput) {
    const localId = randomUUID();
    const variantName = input.variantName?.trim() || "Default";
    this.db.transaction(() => {
      this.db
        .prepare(
          `INSERT INTO products(local_id,category_id,product_type_id,brand_id,name,variant_name,sku,image,remote_image_url,price,cost_price,stock,reorder_threshold,inventory_policy,available,visible_in_pos,active,price_on_request,provisional,request_status)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,1,1,1,?,1,'LOCAL_DRAFT')`,
        )
        .run(
          localId,
          input.categoryId,
          input.productTypeId ?? null,
          input.brandId ?? null,
          input.name.trim(),
          variantName,
          input.sku ?? null,
          input.image ?? null,
          input.image ?? null,
          input.price,
          input.costPrice ?? 0,
          input.stock,
          input.reorderThreshold ?? 0,
          input.trackInventory ? "TRACKED" : "UNLIMITED",
          input.priceOnRequest ? 1 : 0,
        );
      this.enqueue("SUBMIT_PRODUCT_REQUEST", "Product", localId, {
        posLocalId: localId,
        name: input.name.trim(),
        nameAr: input.nameAr?.trim() || "",
        description: input.description?.trim() || "",
        images: input.image ? [input.image] : [],
        categoryId: input.categoryId,
        productTypeId: input.productTypeId,
        brandId: input.brandId,
        variants: [
          {
            localId,
            name: variantName,
            sku: input.sku,
            image: input.image,
            price: input.priceOnRequest ? undefined : input.price,
            costPrice: input.costPrice ?? 0,
            stock: input.stock,
            reorderThreshold: input.reorderThreshold ?? 0,
            trackInventory: input.trackInventory,
          },
        ],
      });
    })();
    return this.db
      .prepare("SELECT * FROM products WHERE local_id=?")
      .get(localId);
  }

  createLocalProductBundle(input: CreateLocalProductBundleInput) {
    const requestLocalId = randomUUID();
    const localIds: string[] = [];
    this.db.transaction(() => {
      for (const variant of input.variants) {
        const localId = randomUUID();
        localIds.push(localId);
        const draftReference = variant.image ?? input.images[0];
        const draftRelativePath = draftReference.slice("draft:".length);
        this.db.prepare(
          `INSERT INTO products(local_id,category_id,product_type_id,brand_id,name,variant_name,sku,image,remote_image_url,price,cost_price,stock,reorder_threshold,inventory_policy,available,visible_in_pos,active,price_on_request,provisional,request_status)
           VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,1,1,1,?,1,'LOCAL_DRAFT')`,
        ).run(
          localId,
          input.categoryId,
          input.productTypeId ?? null,
          input.brandId ?? null,
          input.name.trim(),
          variant.name.trim(),
          variant.sku ?? null,
          `shea-asset://local/${draftRelativePath}`,
          null,
          variant.price,
          variant.costPrice ?? 0,
          variant.stock,
          variant.reorderThreshold ?? 0,
          input.trackInventory ? "TRACKED" : "UNLIMITED",
          variant.priceOnRequest ? 1 : 0,
        );
        this.db.prepare("UPDATE products SET local_image_path=?,image_sync_state='READY' WHERE local_id=?")
          .run(draftRelativePath, localId);
      }
      this.enqueue("SUBMIT_PRODUCT_REQUEST", "ProductBundle", requestLocalId, {
        posLocalId: requestLocalId,
        productLocalIds: localIds,
        name: input.name.trim(),
        nameAr: input.nameAr?.trim() || "",
        description: input.description?.trim() || "",
        images: input.images,
        categoryId: input.categoryId,
        productTypeId: input.productTypeId,
        brandId: input.brandId,
        variants: input.variants.map((variant, index) => ({
          localId: localIds[index],
          name: variant.name.trim(),
          tags: variant.tags,
          sku: variant.sku,
          image: variant.image,
          price: variant.priceOnRequest ? undefined : variant.price,
          costPrice: variant.costPrice ?? 0,
          stock: variant.stock,
          reorderThreshold: variant.reorderThreshold ?? 0,
          trackInventory: input.trackInventory,
        })),
      });
    })();
    return localIds.map((localId) => this.db.prepare("SELECT * FROM products WHERE local_id=?").get(localId));
  }

  getCashSession() {
    return (
      this.db
        .prepare(
          "SELECT * FROM cash_sessions WHERE status='OPEN' ORDER BY opened_at DESC LIMIT 1",
        )
        .get() ?? null
    );
  }
  listCashSessions() {
    return this.db
      .prepare("SELECT * FROM cash_sessions ORDER BY opened_at DESC LIMIT 100")
      .all();
  }

  openCashSession(input: { openingAmount: number; note?: string }) {
    if (this.getCashSession())
      throw new Error("A register session is already open");
    const localId = randomUUID(),
      now = new Date().toISOString();
    this.db.transaction(() => {
      this.db
        .prepare(
          "INSERT INTO cash_sessions(local_id,status,opening_amount,expected_cash,note,sync_state,opened_at) VALUES (?,'OPEN',?,?,?,'PENDING',?)",
        )
        .run(
          localId,
          input.openingAmount,
          input.openingAmount,
          input.note ?? null,
          now,
        );
      this.enqueue("OPEN_CASH_SESSION", "CashSession", localId, {
        localId,
        ...input,
      });
    })();
    return this.getCashSession();
  }

  closeCashSession(input: { countedCash: number; note?: string }) {
    const session = this.getCashSession() as any;
    if (!session) throw new Error("Open the register before closing it");
    const difference = input.countedCash - session.expected_cash;
    this.db.transaction(() => {
      this.db
        .prepare(
          "UPDATE cash_sessions SET status='CLOSED',counted_cash=?,difference=?,note=COALESCE(?,note),sync_state='PENDING',closed_at=CURRENT_TIMESTAMP WHERE local_id=?",
        )
        .run(
          input.countedCash,
          difference,
          input.note ?? null,
          session.local_id,
        );
      this.enqueue("CLOSE_CASH_SESSION", "CashSession", session.local_id, {
        localId: session.local_id,
        countedCash: input.countedCash,
        note: input.note,
      });
    })();
    return this.db
      .prepare("SELECT * FROM cash_sessions WHERE local_id=?")
      .get(session.local_id);
  }

  createProposal(input: ProposalInput) {
    const localId = input.localId ?? randomUUID();
    const now = new Date().toISOString();
    this.db.transaction(() => {
      this.db
        .prepare(
          `INSERT INTO catalog_proposals(local_id,entity_type,status,name,name_ar,description,image,niche_id,category_id,parent_proposal_id,sync_state,created_at,updated_at)
        VALUES (?,?, 'LOCAL_DRAFT',?,?,?,?,?,?,?,'PENDING',?,?)`,
        )
        .run(
          localId,
          input.entityType,
          input.name.trim(),
          input.nameAr?.trim() ?? "",
          input.description?.trim() ?? "",
          input.image ?? null,
          input.nicheId,
          input.categoryId ?? null,
          input.parentProposalId ?? null,
          now,
          now,
        );
      this.enqueue("SUBMIT_CATALOG_PROPOSAL", "CatalogProposal", localId, {
        ...input,
        localId,
      });
    })();
    return this.db
      .prepare("SELECT * FROM catalog_proposals WHERE local_id=?")
      .get(localId);
  }

  checkout(input: CheckoutInput) {
    if (!input.lines.length) throw new Error("Add at least one product");
    if (input.paymentMethod !== "CASH") throw new Error("CASH_ONLY_CHECKOUT");
    if (!this.getCashSession())
      throw new Error("Open the register before accepting cash");
    return this.db.transaction(() => {
      const saleId = input.transactionId ?? randomUUID();
      const createdAt = new Date().toISOString();
      const device = JSON.parse(this.getSetting("device") ?? "{}");
      const saleNumber = input.saleNumber ?? `POS-${device.id?.slice(0, 6) ?? "LOCAL"}-${Date.now()}`;
      const snapshots: any[] = [];
      for (const line of input.lines) {
        const product = this.db
          .prepare(
            "SELECT * FROM products WHERE local_id=? AND active=1 AND visible_in_pos=1",
          )
          .get(line.productLocalId) as any;
        if (product?.price_on_request && line.unitPrice === undefined)
          throw new Error("PRICE_CONFIRMATION_REQUIRED");
        snapshots.push(prepareLine(product, line));
      }
      const { subtotal, discountTotal, taxTotal, total } = calculateTotals(
        snapshots,
        input.discountTotal,
        input.taxTotal,
      );
      const costTotal = snapshots.reduce(
        (sum, snapshot) =>
          sum + snapshot.product.cost_price * snapshot.line.quantity,
        0,
      );
      const grossProfit = total - taxTotal - costTotal;
      const partner = JSON.parse(this.getSetting("partner") ?? "{}");
      const percentageFee =
        partner.feeType === "PERCENTAGE" || partner.feeType === "MIXED"
          ? total * ((partner.feeRate ?? 0) / 100)
          : 0;
      const fixedFee =
        partner.feeType === "FIXED" || partner.feeType === "MIXED"
          ? (partner.fixedFee ?? 0)
          : 0;
      const partnerFee = percentageFee + fixedFee;
      const netProfit = grossProfit - partnerFee;
      const tendered = input.amountTendered ?? total;
      if (!Number.isFinite(tendered) || tendered < total)
        throw new Error("INSUFFICIENT_TENDERED_CASH");
      const changeDue =
        input.paymentMethod === "CASH" ? Math.max(0, tendered - total) : 0;
      this.db
        .prepare(
          `INSERT INTO sales(id,sale_number,status,customer_name,note,subtotal,discount_total,tax_total,total,cost_total,gross_profit,partner_fee,net_profit,payment_method,amount_tendered,change_due,sync_state,created_at,operator_id,operator_name)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        )
        .run(
          saleId,
          saleNumber,
          "COMPLETED",
          input.customerName ?? null,
          input.note ?? null,
          subtotal,
          discountTotal,
          taxTotal,
          total,
          costTotal,
          grossProfit,
          partnerFee,
          netProfit,
          input.paymentMethod,
          tendered,
          changeDue,
          input.gatewayCommitted ? "SYNCED" : "PENDING",
          createdAt,
          input.operatorId ?? null,
          input.operatorName ?? null,
        );
      for (const snapshot of snapshots) {
        const itemId = randomUUID();
        const lineCost = snapshot.product.cost_price ?? 0;
        const lineProfit = snapshot.total - lineCost * snapshot.line.quantity;
        this.db
          .prepare(
            `INSERT INTO sale_items(id,sale_id,product_local_id,product_server_id,product_name,variant_name,sku,quantity,unit_price,discount,tax,total,cost_price,profit)
          VALUES (?,?,?,?,?,?,?,?,?,?,0,?,?,?)`,
          )
          .run(
            itemId,
            saleId,
            snapshot.product.local_id,
            snapshot.product.server_id,
            snapshot.product.name,
            snapshot.product.variant_name,
            snapshot.product.sku,
            snapshot.line.quantity,
            snapshot.unitPrice,
            snapshot.discount,
            snapshot.total,
            lineCost,
            lineProfit,
          );
        if (snapshot.product.inventory_policy === "TRACKED") {
          const before = snapshot.product.stock;
          const after = before - snapshot.line.quantity;
          this.db
            .prepare(
              "UPDATE products SET stock=?,updated_at=CURRENT_TIMESTAMP WHERE local_id=?",
            )
            .run(after, snapshot.product.local_id);
          this.db
            .prepare(
              `INSERT INTO stock_movements(id,product_local_id,sale_id,type,quantity_delta,stock_before,stock_after,reason,sync_state,created_at) VALUES (?,?,?,'SALE',?,?,?,?, 'PENDING',?)`,
            )
            .run(
              randomUUID(),
              snapshot.product.local_id,
              saleId,
              -snapshot.line.quantity,
              before,
              after,
              `POS sale ${saleNumber}`,
              createdAt,
            );
        }
      }
      const items = this.db
        .prepare("SELECT * FROM sale_items WHERE sale_id=?")
        .all(saleId);
      const blocked = items.some((item: any) => !item.product_server_id);
      if (!input.gatewayCommitted)
        this.enqueue(
          "CREATE_SALE",
          "Sale",
          saleId,
          {
            saleId,
            saleNumber,
            customerName: input.customerName,
            note: input.note,
            discountTotal,
            taxTotal,
            total,
            paymentMethod: input.paymentMethod,
            items,
          },
          blocked ? "BLOCKED" : "PENDING",
        );
      if (input.paymentMethod === "CASH")
        this.db
          .prepare(
            "UPDATE cash_sessions SET expected_cash=expected_cash+?,sync_state=CASE WHEN sync_state='SYNCED' THEN 'PENDING' ELSE sync_state END WHERE status='OPEN'",
          )
          .run(total);
      return {
        ...(this.db
          .prepare("SELECT * FROM sales WHERE id=?")
          .get(saleId) as object),
        items,
      };
    })();
  }

  refundSale(input: RefundSaleInput) {
    if (!input.lines.length) throw new Error("REFUND_ITEMS_REQUIRED");
    if (new Set(input.lines.map((line) => line.saleItemId)).size !== input.lines.length)
      throw new Error("DUPLICATE_REFUND_ITEM");
    const reason = input.reason.trim();
    if (reason.length < 3) throw new Error("REFUND_REASON_REQUIRED");
    const session = this.getCashSession() as any;
    if (!session) throw new Error("Open the register before refunding cash");
    return this.db.transaction(() => {
      const sale = this.db.prepare("SELECT * FROM sales WHERE id=?").get(input.saleId) as any;
      if (!sale) throw new Error("INVOICE_NOT_FOUND");
      if (!["COMPLETED", "PARTIALLY_REFUNDED"].includes(sale.status)) throw new Error("SALE_NOT_REFUNDABLE");
      const refundId = input.refundId ?? randomUUID();
      const now = new Date().toISOString();
      const prepared = input.lines.map((line) => {
        const item = this.db.prepare("SELECT * FROM sale_items WHERE id=? AND sale_id=?").get(line.saleItemId, sale.id) as any;
        if (!item) throw new Error("SALE_ITEM_NOT_FOUND");
        const remaining = Number(item.quantity) - Number(item.returned_quantity ?? 0);
        if (!Number.isFinite(line.quantity) || line.quantity <= 0 || line.quantity > remaining)
          throw new Error("INVALID_REFUND_QUANTITY");
        const amount = Number(item.total) * (line.quantity / Number(item.quantity));
        return { item, quantity: line.quantity, amount };
      });
      const amount = prepared.reduce((sum, row) => sum + row.amount, 0);
      if (Number(session.expected_cash) < amount) throw new Error("INSUFFICIENT_REGISTER_CASH");
      this.db.prepare(`INSERT INTO sale_refunds(id,sale_id,amount,reason,sync_state,operator_id,operator_name,created_at)
        VALUES (?,?,?,?,?,?,?,?)`).run(refundId, sale.id, amount, reason, input.gatewayCommitted ? "SYNCED" : "PENDING", input.operatorId ?? null, input.operatorName ?? null, now);
      for (const row of prepared) {
        this.db.prepare("UPDATE sale_items SET returned_quantity=returned_quantity+? WHERE id=?").run(row.quantity, row.item.id);
        this.db.prepare("INSERT INTO sale_refund_items(id,refund_id,sale_item_id,product_local_id,quantity,amount) VALUES (?,?,?,?,?,?)")
          .run(randomUUID(), refundId, row.item.id, row.item.product_local_id, row.quantity, row.amount);
        const product = this.db.prepare("SELECT stock,inventory_policy FROM products WHERE local_id=?").get(row.item.product_local_id) as any;
        if (product?.inventory_policy === "TRACKED") {
          const before = Number(product.stock);
          const after = before + row.quantity;
          this.db.prepare("UPDATE products SET stock=?,updated_at=CURRENT_TIMESTAMP WHERE local_id=?").run(after, row.item.product_local_id);
          this.db.prepare(`INSERT INTO stock_movements(id,product_local_id,sale_id,type,quantity_delta,stock_before,stock_after,reason,sync_state,created_at)
            VALUES (?,?,?,'RETURN',?,?,?,?,?,?)`).run(randomUUID(), row.item.product_local_id, sale.id, row.quantity, before, after, `Refund ${sale.sale_number}`, input.gatewayCommitted ? "SYNCED" : "PENDING", now);
        }
      }
      const refundedTotal = Number(sale.refunded_total ?? 0) + amount;
      const fullyRefunded = refundedTotal >= Number(sale.total) - 0.005;
      this.db.prepare("UPDATE sales SET status=?,refunded_total=?,refunded_at=? WHERE id=?")
        .run(fullyRefunded ? "REFUNDED" : "PARTIALLY_REFUNDED", refundedTotal, now, sale.id);
      this.db.prepare("UPDATE cash_sessions SET expected_cash=expected_cash-?,sync_state=CASE WHEN sync_state='SYNCED' THEN 'PENDING' ELSE sync_state END WHERE local_id=?")
        .run(amount, session.local_id);
      if (!input.gatewayCommitted)
        this.enqueue("REFUND_SALE", "SaleRefund", refundId, {
          refundId,
          saleLocalId: sale.id,
          saleServerId: sale.server_id,
          reason,
          lines: prepared.map((row) => ({ saleItemId: row.item.id, productId: row.item.product_server_id, quantity: row.quantity })),
        }, sale.server_id ? "PENDING" : "BLOCKED");
      return this.getSaleDetails(sale.id);
    })();
  }

  validateRefund(input: RefundSaleInput) {
    if (!input.lines.length) throw new Error("REFUND_ITEMS_REQUIRED");
    if (new Set(input.lines.map((line) => line.saleItemId)).size !== input.lines.length)
      throw new Error("DUPLICATE_REFUND_ITEM");
    if (input.reason.trim().length < 3) throw new Error("REFUND_REASON_REQUIRED");
    const session = this.getCashSession() as any;
    if (!session) throw new Error("Open the register before refunding cash");
    const sale = this.db.prepare("SELECT * FROM sales WHERE id=?").get(input.saleId) as any;
    if (!sale) throw new Error("INVOICE_NOT_FOUND");
    if (!["COMPLETED", "PARTIALLY_REFUNDED"].includes(sale.status)) throw new Error("SALE_NOT_REFUNDABLE");
    const amount = input.lines.reduce((sum, line) => {
      const item = this.db.prepare("SELECT * FROM sale_items WHERE id=? AND sale_id=?").get(line.saleItemId, sale.id) as any;
      if (!item) throw new Error("SALE_ITEM_NOT_FOUND");
      const remaining = Number(item.quantity) - Number(item.returned_quantity ?? 0);
      if (!Number.isFinite(line.quantity) || line.quantity <= 0 || line.quantity > remaining)
        throw new Error("INVALID_REFUND_QUANTITY");
      return sum + Number(item.total) * (line.quantity / Number(item.quantity));
    }, 0);
    if (Number(session.expected_cash) < amount) throw new Error("INSUFFICIENT_REGISTER_CASH");
    return { sale, amount };
  }

  markRefundSynced(localId: string, serverId: string) {
    this.db.prepare("UPDATE sale_refunds SET server_id=?,sync_state='SYNCED',synced_at=CURRENT_TIMESTAMP WHERE id=?").run(serverId, localId);
  }

  gatewaySaleLines(lines: CheckoutInput["lines"]) {
    return lines.map((line) => {
      const product = this.db
        .prepare("SELECT server_id,price FROM products WHERE local_id=? AND active=1")
        .get(line.productLocalId) as { server_id?: number; price: number } | undefined;
      if (!product?.server_id) throw new Error("Synchronize products before using multi-POS mode");
      return {
        productId: product.server_id,
        quantity: line.quantity,
        unitPrice: line.unitPrice ?? product.price,
        discount: line.discount ?? 0,
        tax: 0,
      };
    });
  }

  gatewayProduct(localId: string) {
    const product = this.db
      .prepare("SELECT server_id FROM products WHERE local_id=? AND active=1")
      .get(localId) as { server_id?: number } | undefined;
    if (!product?.server_id) throw new Error("Synchronize products before using multi-POS mode");
    return { serverId: product.server_id };
  }

  gatewayStockEntryLines(input: CreateStockEntryInput) {
    return input.lines.map((line) => ({
      productLocalId: line.productLocalId,
      quantity: line.quantity,
      unitCost: line.pricingMode === "TOTAL" ? line.price / line.quantity : line.price,
    }));
  }

  gatewayStockEntryCancellation(id: string) {
    const record = this.getStockEntry(id) as any;
    return {
      reference: record.entry.entry_number,
      lines: record.items.map((item: any) => ({
        productLocalId: item.product_local_id,
        quantity: Number(item.quantity),
        unitCost: Number(item.unit_cost),
      })),
    };
  }

  applyGatewayProducts(products: Array<Record<string, unknown>>) {
    const update = this.db.prepare(
      `UPDATE products SET stock=@stock,price=@price,cost_price=@costPrice,discount=@discount,
       reorder_threshold=@reorderThreshold,available=@available,visible_in_pos=@visibleInPos,price_on_request=@priceOnRequest,
       updated_at=CURRENT_TIMESTAMP WHERE server_id=@cloudId`,
    );
    this.db.transaction(() => {
      for (const product of products)
        update.run({
          cloudId: product.cloudId,
          stock: product.stock,
          price: product.price,
          costPrice: product.costPrice,
          discount: product.discount,
          reorderThreshold: product.reorderThreshold,
          available: product.available ? 1 : 0,
          visibleInPos: product.visibleInPos ? 1 : 0,
          priceOnRequest: product.priceOnRequest ? 1 : 0,
        });
    })();
  }

  adjustStock(input: {
    productLocalId: string;
    mode: "RECEIVE" | "REMOVE" | "SET";
    quantity: number;
    reason: string;
    gatewayCommitted?: boolean;
  }) {
    if (!Number.isFinite(input.quantity) || input.quantity < 0)
      throw new Error("Stock must be zero or greater");
    return this.db.transaction(() => {
      const product = this.db
        .prepare("SELECT * FROM products WHERE local_id=?")
        .get(input.productLocalId) as any;
      if (!product) throw new Error("Product not found");
      const nextStock =
        input.mode === "RECEIVE"
          ? product.stock + input.quantity
          : input.mode === "REMOVE"
            ? product.stock - input.quantity
            : input.quantity;
      if (nextStock < 0) throw new Error("Insufficient stock");
      const delta = nextStock - product.stock;
      const movementType =
        input.mode === "RECEIVE"
          ? "RECEIPT"
          : input.mode === "REMOVE"
            ? "REMOVAL"
            : delta >= 0
              ? "ADJUSTMENT_IN"
              : "ADJUSTMENT_OUT";
      this.db
        .prepare(
          "UPDATE products SET stock=?,updated_at=CURRENT_TIMESTAMP WHERE local_id=?",
        )
        .run(nextStock, input.productLocalId);
      this.db
        .prepare(
          `INSERT INTO stock_movements(id,product_local_id,type,quantity_delta,stock_before,stock_after,reason,sync_state,created_at) VALUES (?,?,?,?,?,?,?, 'PENDING',?)`,
        )
        .run(
          randomUUID(),
          input.productLocalId,
          movementType,
          delta,
          product.stock,
          nextStock,
          input.reason,
          new Date().toISOString(),
        );
      if (product.server_id && !input.gatewayCommitted)
        this.enqueue("UPDATE_STOCK", "Product", input.productLocalId, {
          serverId: product.server_id,
          stock: nextStock,
        });
      return this.db
        .prepare("SELECT * FROM products WHERE local_id=?")
        .get(input.productLocalId);
    })();
  }

  updateProduct(input: {
    productLocalId: string;
    price?: number;
    costPrice?: number;
    discount?: number;
    stock?: number;
    reorderThreshold?: number;
    trackInventory?: boolean;
    available?: boolean;
    visibleInPos?: boolean;
    active?: boolean;
    priceOnRequest?: boolean;
    gatewayCommitted?: boolean;
  }) {
    return this.db.transaction(() => {
      const product = this.db
        .prepare("SELECT * FROM products WHERE local_id=?")
        .get(input.productLocalId) as any;
      if (!product) throw new Error("Product not found");
      const next = {
        price: input.price ?? product.price,
        costPrice: input.costPrice ?? product.cost_price,
        discount: input.discount ?? product.discount,
        stock: input.stock ?? product.stock,
        reorderThreshold: input.reorderThreshold ?? product.reorder_threshold,
        inventoryPolicy:
          input.trackInventory === undefined
            ? product.inventory_policy
            : input.trackInventory
              ? "TRACKED"
              : "UNLIMITED",
        available:
          input.available === undefined
            ? product.available
            : input.available
              ? 1
              : 0,
        visible:
          input.visibleInPos === undefined
            ? product.visible_in_pos
            : input.visibleInPos
              ? 1
              : 0,
        active:
          input.active === undefined ? product.active : input.active ? 1 : 0,
        priceOnRequest:
          input.priceOnRequest === undefined
            ? product.price_on_request
            : input.priceOnRequest
              ? 1
              : 0,
      };
      this.db
        .prepare(
          "UPDATE products SET price=?,cost_price=?,discount=?,stock=?,reorder_threshold=?,inventory_policy=?,available=?,visible_in_pos=?,active=?,price_on_request=?,updated_at=CURRENT_TIMESTAMP WHERE local_id=?",
        )
        .run(
          next.price,
          next.costPrice,
          next.discount,
          next.stock,
          next.reorderThreshold,
          next.inventoryPolicy,
          next.available,
          next.visible,
          next.active,
          next.priceOnRequest,
          input.productLocalId,
        );
      if (
        input.stock !== undefined &&
        input.stock !== product.stock &&
        next.inventoryPolicy === "TRACKED"
      ) {
        this.db
          .prepare(
            `INSERT INTO stock_movements(id,product_local_id,type,quantity_delta,stock_before,stock_after,reason,sync_state,created_at) VALUES (?,?, 'ADJUSTMENT_IN',?,?,?,?, 'PENDING',?)`,
          )
          .run(
            randomUUID(),
            input.productLocalId,
            input.stock - product.stock,
            product.stock,
            input.stock,
            "Product management update",
            new Date().toISOString(),
          );
      }
      if (product.server_id && !input.gatewayCommitted)
        this.enqueue("UPDATE_PRODUCT", "Product", input.productLocalId, {
          serverId: product.server_id,
          price: next.price,
          costPrice: next.costPrice,
          discount: next.discount,
          stock: next.stock,
          reorderThreshold: next.reorderThreshold,
          trackInventory: next.inventoryPolicy === "TRACKED",
          available: Boolean(next.available),
          isVisibleInPos: Boolean(next.visible),
          isActive: Boolean(next.active),
          priceOnRequest: Boolean(next.priceOnRequest),
        });
      return this.db
        .prepare("SELECT * FROM products WHERE local_id=?")
        .get(input.productLocalId);
    })();
  }

  private enqueue(
    operation: string,
    aggregateType: string,
    aggregateId: string,
    payload: unknown,
    state = "PENDING",
  ) {
    const now = new Date().toISOString();
    this.db
      .prepare(
        "INSERT INTO outbox(id,operation,aggregate_type,aggregate_id,payload_json,state,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?)",
      )
      .run(
        randomUUID(),
        operation,
        aggregateType,
        aggregateId,
        JSON.stringify(payload),
        state,
        now,
        now,
      );
  }

  markOutboxSynced(id: string) {
    this.db
      .prepare(
        "UPDATE outbox SET state='SYNCED',last_error=NULL,updated_at=CURRENT_TIMESTAMP WHERE id=?",
      )
      .run(id);
  }
  updateOutboxPayload(id: string, payload: unknown) {
    this.db.prepare("UPDATE outbox SET payload_json=?,updated_at=CURRENT_TIMESTAMP WHERE id=?")
      .run(JSON.stringify(payload), id);
  }
  markOutboxError(id: string, error: string) {
    const row = this.db.prepare("SELECT aggregate_type,aggregate_id FROM outbox WHERE id=?").get(id) as any;
    this.db
      .prepare(
        "UPDATE outbox SET state='ERROR',attempts=attempts+1,last_error=?,next_attempt_at=datetime('now', '+' || MIN(attempts + 1, 10) || ' minutes'),updated_at=CURRENT_TIMESTAMP WHERE id=?",
      )
      .run(error, id);
    if (row?.aggregate_type === "Order") {
      this.db.prepare("UPDATE orders SET sync_state='ERROR',last_error=? WHERE server_id=?").run(error, Number(row.aggregate_id));
    }
  }
  markSaleSynced(localId: string, serverId: string) {
    this.db.transaction(() => {
      this.db
        .prepare(
          "UPDATE sales SET server_id=?,sync_state='SYNCED',synced_at=CURRENT_TIMESTAMP WHERE id=?",
        )
        .run(serverId, localId);
      const rows = this.db.prepare("SELECT id,payload_json FROM outbox WHERE operation='REFUND_SALE' AND state='BLOCKED'").all() as Array<{ id: string; payload_json: string }>;
      for (const row of rows) {
        try {
          const payload = JSON.parse(row.payload_json);
          if (payload.saleLocalId === localId)
            this.db.prepare("UPDATE outbox SET state='PENDING',next_attempt_at=NULL,last_error=NULL,updated_at=CURRENT_TIMESTAMP WHERE id=?").run(row.id);
        } catch {
          // Keep malformed queue records blocked for manual inspection.
        }
      }
    })();
  }
  markProposalSynced(localId: string, serverId: string, status: string) {
    this.db
      .prepare(
        "UPDATE catalog_proposals SET server_id=?,status=?,sync_state='SYNCED',updated_at=CURRENT_TIMESTAMP WHERE local_id=?",
      )
      .run(serverId, status, localId);
  }
  markProductRequestSubmitted(
    localId: string,
    serverId: number,
    status: string,
    productLocalIds?: string[],
  ) {
    const ids = productLocalIds?.length ? productLocalIds : [localId];
    const statement = this.db.prepare(
      "UPDATE products SET request_server_id=?,request_status=?,updated_at=CURRENT_TIMESTAMP WHERE local_id=?",
    );
    this.db.transaction(() => {
      for (const id of ids) statement.run(serverId, status, id);
    })();
  }
  markProductSynced(localId: string, serverId: number) {
    this.db.transaction(() => {
      this.db
        .prepare(
          "UPDATE products SET server_id=?,provisional=0 WHERE local_id=?",
        )
        .run(serverId, localId);
      this.db
        .prepare(
          "UPDATE sale_items SET product_server_id=? WHERE product_local_id=?",
        )
        .run(serverId, localId);
      const blocked = this.db
        .prepare(
          "SELECT id,payload_json FROM outbox WHERE state='BLOCKED' AND operation='CREATE_SALE'",
        )
        .all() as Array<{ id: string; payload_json: string }>;
      for (const row of blocked) {
        const payload = JSON.parse(row.payload_json);
        let changed = false;
        payload.items = payload.items.map((item: any) => {
          if (item.product_local_id !== localId) return item;
          changed = true;
          return { ...item, product_server_id: serverId };
        });
        if (!changed) continue;
        const stillBlocked = payload.items.some(
          (item: any) => !item.product_server_id,
        );
        this.db
          .prepare(
            "UPDATE outbox SET payload_json=?,state=?,next_attempt_at=NULL,updated_at=CURRENT_TIMESTAMP WHERE id=?",
          )
          .run(
            JSON.stringify(payload),
            stillBlocked ? "BLOCKED" : "PENDING",
            row.id,
          );
      }
    })();
  }
  markCashSessionOpened(localId: string, serverId: string) {
    this.db
      .prepare(
        "UPDATE cash_sessions SET server_id=?,sync_state='SYNCED' WHERE local_id=?",
      )
      .run(serverId, localId);
  }
  markCashSessionClosed(localId: string) {
    this.db
      .prepare("UPDATE cash_sessions SET sync_state='SYNCED' WHERE local_id=?")
      .run(localId);
  }
  getCashSessionByLocalId(localId: string) {
    return this.db
      .prepare("SELECT * FROM cash_sessions WHERE local_id=?")
      .get(localId) as any;
  }
  getSaleWithItems(id: string) {
    return {
      sale: this.db.prepare("SELECT * FROM sales WHERE id=?").get(id),
      items: this.db
        .prepare("SELECT * FROM sale_items WHERE sale_id=?")
        .all(id),
    };
  }
  getProductByLocalId(localId: string) {
    return this.db
      .prepare(
        `SELECT p.*,t.name_ar FROM products p
        LEFT JOIN templates t ON t.id=p.template_id WHERE p.local_id=?`,
      )
      .get(localId) as any;
  }
  close() {
    this.db.close();
  }
}
