import Database from "better-sqlite3";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import type {
  ActivateProductInput,
  CheckoutInput,
  CreateLocalProductInput,
  CreateStockEntryInput,
  CreateCustomOrderInput,
  ProposalInput,
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
  orders: any[];
  openCashSession?: any;
  extensions?: { giftStore?: { orders?: any[]; templates?: any[] } | null };
};

export class PosDatabase {
  readonly db: Database.Database;
  private readonly assetRoot: string;
  private readonly imageDataUrlCache = new Map<string, string>();

  constructor(userDataPath: string) {
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
        `SELECT COUNT(*) sale_count,COALESCE(SUM(s.total),0) revenue,COALESCE(SUM(s.cost_total),0) cost,
      COALESCE(SUM(s.gross_profit),0) gross_profit,COALESCE(SUM(s.partner_fee),0) partner_fee,COALESCE(SUM(s.net_profit),0) net_profit,
      COALESCE(AVG(s.total),0) average_sale FROM sales s WHERE s.status='COMPLETED' AND s.created_at BETWEEN ? AND ?`,
      )
      .get(from, to);
    const stock = this.db
      .prepare(
        "SELECT COUNT(*) total, SUM(CASE WHEN inventory_policy='TRACKED' AND stock<=reorder_threshold THEN 1 ELSE 0 END) low FROM products WHERE active=1",
      )
      .get();
    const payments = this.db
      .prepare(
        `SELECT s.payment_method method,COUNT(*) count,COALESCE(SUM(s.total),0) total
        FROM sales s WHERE s.status='COMPLETED' AND s.created_at BETWEEN ? AND ?
        GROUP BY s.payment_method ORDER BY total DESC`,
      )
      .all(from, to);
    const topProducts = this.db
      .prepare(
        `SELECT si.product_name,si.variant_name,SUM(si.quantity) quantity,
        COALESCE(SUM(si.total),0) revenue,COALESCE(SUM(si.profit),0) profit
        FROM sale_items si JOIN sales s ON s.id=si.sale_id
        WHERE s.status='COMPLETED' AND s.created_at BETWEEN ? AND ?
        GROUP BY si.product_name,si.variant_name ORDER BY revenue DESC LIMIT 8`,
      )
      .all(from, to);
    const trend = this.db
      .prepare(
        `SELECT date(s.created_at,'localtime') day,COUNT(*) count,
        COALESCE(SUM(s.total),0) revenue,COALESCE(SUM(s.net_profit),0) net_profit
        FROM sales s WHERE s.status='COMPLETED' AND s.created_at BETWEEN ? AND ?
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
        .prepare(`INSERT INTO products(local_id,server_id,variant_id,template_id,category_id,product_type_id,brand_id,name,variant_name,sku,barcode,image,remote_image_url,price,cost_price,discount,stock,reorder_threshold,inventory_policy,available,visible_in_pos,active,provisional,updated_at)
        VALUES (@local_id,@server_id,@variant_id,@template_id,@category_id,@product_type_id,@brand_id,@name,@variant_name,@sku,@barcode,@image,@image,@price,@cost_price,@discount,@stock,@reorder_threshold,@inventory_policy,@available,@visible_in_pos,@active,0,CURRENT_TIMESTAMP)
        ON CONFLICT(local_id) DO UPDATE SET server_id=excluded.server_id,variant_id=excluded.variant_id,template_id=excluded.template_id,category_id=excluded.category_id,product_type_id=excluded.product_type_id,brand_id=excluded.brand_id,name=excluded.name,variant_name=excluded.variant_name,sku=excluded.sku,barcode=excluded.barcode,image=excluded.image,remote_image_url=excluded.remote_image_url,image_sync_state=CASE WHEN COALESCE(products.remote_image_url,'')<>COALESCE(excluded.remote_image_url,'') THEN 'PENDING' ELSE products.image_sync_state END,price=excluded.price,cost_price=excluded.cost_price,discount=excluded.discount,stock=excluded.stock,reorder_threshold=excluded.reorder_threshold,inventory_policy=excluded.inventory_policy,available=excluded.available,visible_in_pos=excluded.visible_in_pos,active=excluded.active,provisional=0,updated_at=CURRENT_TIMESTAMP`);

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
        for (const variant of request.variants ?? [])
          if (variant.resolvedVariantId)
            localIdByVariant.set(variant.resolvedVariantId, request.posLocalId);
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
        "INSERT INTO orders(server_id,status,total,customer_name,payload_json,updated_at) VALUES (?,?,?,?,?,CURRENT_TIMESTAMP)",
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
          status,
          row.subtotal ?? 0,
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
  listOrders() {
    return this.db
      .prepare("SELECT * FROM orders ORDER BY updated_at DESC LIMIT 100")
      .all();
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

  queueCustomOrderCommand(id: string, operation: "CREATE_CUSTOM_ORDER_QUOTATION" | "RESERVE_CUSTOM_ORDER_MATERIALS", optimisticStatus: string) {
    const row = this.db.prepare("SELECT * FROM custom_orders WHERE id=?").get(id) as any;
    if (!row) throw new Error("Custom order not found");
    if (!row.server_id) throw new Error("Synchronize this new order before changing its workflow");
    this.db.transaction(() => {
      this.db.prepare("UPDATE custom_orders SET status=?,sync_state='PENDING',updated_at=CURRENT_TIMESTAMP WHERE id=?").run(optimisticStatus, id);
      this.enqueue(operation, "CustomOrder", id, { serverId: row.server_id });
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
      sync_state: row.sync_state,
      operator_name: row.operator_name,
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
    this.db
      .prepare(
        "UPDATE outbox SET state='PENDING',next_attempt_at=NULL,last_error=NULL,updated_at=CURRENT_TIMESTAMP WHERE id=? AND state IN ('ERROR','BLOCKED')",
      )
      .run(id);
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
          `INSERT INTO products(local_id,variant_id,template_id,category_id,product_type_id,brand_id,name,variant_name,sku,image,remote_image_url,price,cost_price,stock,reorder_threshold,inventory_policy,available,visible_in_pos,active,provisional)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,1,?,1,1)`,
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
          `INSERT INTO products(local_id,category_id,product_type_id,brand_id,name,variant_name,sku,image,remote_image_url,price,cost_price,stock,reorder_threshold,inventory_policy,available,visible_in_pos,active,provisional,request_status)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,1,1,1,1,'LOCAL_DRAFT')`,
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
            price: input.price,
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
    if (input.paymentMethod === "CASH" && !this.getCashSession())
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
       reorder_threshold=@reorderThreshold,available=@available,visible_in_pos=@visibleInPos,
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
      };
      this.db
        .prepare(
          "UPDATE products SET price=?,cost_price=?,discount=?,stock=?,reorder_threshold=?,inventory_policy=?,available=?,visible_in_pos=?,active=?,updated_at=CURRENT_TIMESTAMP WHERE local_id=?",
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
  markOutboxError(id: string, error: string) {
    this.db
      .prepare(
        "UPDATE outbox SET state='ERROR',attempts=attempts+1,last_error=?,next_attempt_at=datetime('now', '+' || MIN(attempts + 1, 10) || ' minutes'),updated_at=CURRENT_TIMESTAMP WHERE id=?",
      )
      .run(error, id);
  }
  markSaleSynced(localId: string, serverId: string) {
    this.db
      .prepare(
        "UPDATE sales SET server_id=?,sync_state='SYNCED',synced_at=CURRENT_TIMESTAMP WHERE id=?",
      )
      .run(serverId, localId);
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
  ) {
    this.db
      .prepare(
        "UPDATE products SET request_server_id=?,request_status=?,updated_at=CURRENT_TIMESTAMP WHERE local_id=?",
      )
      .run(serverId, status, localId);
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
