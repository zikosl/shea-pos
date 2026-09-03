import { BrowserWindow, ipcMain } from "electron";
import { z } from "zod";
import type { PosDatabase } from "./database";
import { normalizeEndpoint, signIn } from "./graphql";
import { clearSession } from "./session";
import type { SyncService } from "./sync";
import type { ProductAssetService } from "./assets";
import {
  permissions,
  rolePermissions,
  type LocalAccessService,
  type LocalRole,
  type Permission,
} from "./access";
import {
  listPrinters,
  previewPriceLabel,
  previewReceipt,
  previewInvoice,
  previewStockEntry,
  printPriceLabels,
  printReceipt,
  printInvoice,
  printStockEntry,
  testPriceLabel,
  testPrinter,
} from "./printer";

const signInSchema = z.object({
  endpoint: z.string().min(1),
  email: z.string().email(),
  password: z.string().min(1),
  deviceName: z.string().trim().min(1).max(80),
});
const listSchema = z
  .object({
    search: z.string().max(120).optional(),
    categoryId: z.number().int().positive().optional(),
    nicheId: z.number().int().positive().optional(),
    limit: z.number().int().min(1).max(250).optional(),
    offset: z.number().int().min(0).optional(),
  })
  .optional();
const proposalSchema = z.object({
  localId: z.string().uuid().optional(),
  entityType: z.enum(["CATEGORY", "PRODUCT_TYPE"]),
  name: z.string().trim().min(2).max(120),
  nameAr: z.string().trim().max(120).optional(),
  description: z.string().trim().max(1000).optional(),
  image: z.string().max(500).optional(),
  nicheId: z.number().int().positive(),
  categoryId: z.number().int().positive().optional(),
  parentProposalId: z.string().uuid().optional(),
});
const checkoutSchema = z.object({
  customerName: z.string().trim().max(120).optional(),
  note: z.string().trim().max(500).optional(),
  discountTotal: z.number().min(0).optional(),
  taxTotal: z.number().min(0).optional(),
  paymentMethod: z.enum(["CASH", "CARD", "OTHER"]),
  amountTendered: z.number().min(0).optional(),
  lines: z
    .array(
      z.object({
        productLocalId: z.string().min(1),
        quantity: z.number().int().positive(),
        unitPrice: z.number().min(0).optional(),
        discount: z.number().min(0).optional(),
      }),
    )
    .min(1),
});
const stockSchema = z.object({
  productLocalId: z.string().min(1),
  mode: z.enum(["RECEIVE", "REMOVE", "SET"]),
  quantity: z.number().int().min(0),
  reason: z.string().trim().min(2).max(200),
});
const stockEntrySchema = z.object({
  supplierName: z.string().trim().max(160).optional(),
  supplierInvoice: z.string().trim().max(120).optional(),
  entryDate: z.string().datetime().optional(),
  note: z.string().trim().max(500).optional(),
  lines: z.array(z.object({
    productLocalId: z.string().min(1),
    quantity: z.number().positive(),
    pricingMode: z.enum(["UNIT", "TOTAL"]),
    price: z.number().min(0),
  })).min(1),
});
const documentSchema = z.object({
  source: z.enum(["POS", "DELIVERY"]),
  id: z.string().min(1),
  printerName: z.string().optional(),
});
const stockEntryDocumentSchema = z.object({ id: z.string().uuid(), printerName: z.string().optional() });
const productUpdateSchema = z.object({
  productLocalId: z.string().min(1),
  price: z.number().min(0).optional(),
  costPrice: z.number().min(0).optional(),
  discount: z.number().min(0).optional(),
  stock: z.number().int().min(0).optional(),
  reorderThreshold: z.number().int().min(0).optional(),
  trackInventory: z.boolean().optional(),
  available: z.boolean().optional(),
  visibleInPos: z.boolean().optional(),
  active: z.boolean().optional(),
});
const activateSchema = z.object({
  variantId: z.number().int().positive(),
  price: z.number().min(0),
  costPrice: z.number().min(0).optional(),
  stock: z.number().int().min(0),
  trackInventory: z.boolean(),
  reorderThreshold: z.number().int().min(0).optional(),
  visibleInPos: z.boolean().optional(),
});
const localProductSchema = z.object({
  name: z.string().trim().min(2).max(160),
  nameAr: z.string().trim().max(160).optional(),
  description: z.string().trim().max(2000).optional(),
  categoryId: z.number().int().positive(),
  productTypeId: z.number().int().positive().optional(),
  brandId: z.number().int().positive().optional(),
  variantName: z.string().trim().max(120).optional(),
  sku: z.string().trim().max(120).optional(),
  image: z.string().max(1000).optional(),
  price: z.number().min(0),
  costPrice: z.number().min(0).optional(),
  stock: z.number().int().min(0),
  trackInventory: z.boolean(),
  reorderThreshold: z.number().int().min(0).optional(),
});
const movementSchema = z
  .object({
    search: z.string().max(120).optional(),
    type: z.string().max(40).optional(),
    productLocalId: z.string().max(80).optional(),
    limit: z.number().int().min(1).max(500).optional(),
    offset: z.number().int().min(0).optional(),
  })
  .optional();
const reportSchema = z
  .object({
    from: z.string().datetime().optional(),
    to: z.string().datetime().optional(),
  })
  .optional();
const cashOpenSchema = z.object({
  openingAmount: z.number().min(0),
  note: z.string().trim().max(500).optional(),
});
const cashCloseSchema = z.object({
  countedCash: z.number().min(0),
  note: z.string().trim().max(500).optional(),
});
const printSchema = z.object({
  saleId: z.string().min(1),
  printerName: z.string().optional(),
});
const printPreviewSchema = z
  .object({
    saleId: z.string().min(1).optional(),
    productLocalId: z.string().min(1).optional(),
    settings: z.record(z.string(), z.string().max(3_000_000)).optional(),
  })
  .optional();
const priceLabelPrintSchema = z.object({
  items: z
    .array(
      z.object({
        productLocalId: z.string().min(1),
        copies: z.number().int().min(1).max(100),
      }),
    )
    .min(1)
    .max(250),
  printerName: z.string().optional(),
});
const secretSchema = z.string().min(4).max(128);
const localLoginSchema = z.object({ username: z.string().trim().min(2).max(80), secret: secretSchema });
const localUserBaseSchema = z.object({
  name: z.string().trim().min(2).max(120),
  username: z.string().trim().min(2).max(80).regex(/^[a-zA-Z0-9._-]+$/),
  secret: secretSchema,
  role: z.enum(["OWNER", "MANAGER", "CASHIER", "STOCK_CLERK", "CUSTOM"]),
  permissions: z.array(z.enum(permissions)).optional(),
});
const localUserSchema = localUserBaseSchema.refine((value) => value.role !== "CUSTOM" || Boolean(value.permissions?.length), {
  message: "A custom role needs at least one permission",
  path: ["permissions"],
});
const localUserUpdateSchema = localUserBaseSchema.omit({ secret: true }).extend({ id: z.string().uuid(), active: z.boolean() }).refine((value) => value.role !== "CUSTOM" || Boolean(value.permissions?.length), {
  message: "A custom role needs at least one permission",
  path: ["permissions"],
});
const resetSecretSchema = z.object({ id: z.string().uuid(), secret: secretSchema });
const customOrderSchema = z.object({
  nicheId: z.number().int().positive().optional(),
  customerName: z.string().trim().min(2).max(120),
  customerPhone: z.string().trim().max(40).optional(),
  requiredAt: z.string().datetime().optional(),
  fulfillmentMode: z.enum(["PICKUP", "DELIVERY"]),
  deliveryAddress: z.string().trim().max(500).optional(),
  note: z.string().trim().max(1000).optional(),
  occasion: z.string().trim().max(120).optional(),
  recipientName: z.string().trim().max(120).optional(),
  cardMessage: z.string().trim().max(500).optional(),
  style: z.string().trim().max(120).optional(),
  wrappingNote: z.string().trim().max(500).optional(),
  discount: z.number().min(0).optional(),
  lines: z.array(z.object({ productLocalId: z.string().optional(), name: z.string().trim().min(1).max(160), description: z.string().trim().max(500).optional(), quantity: z.number().positive(), unitPrice: z.number().min(0), unitCost: z.number().min(0).optional() })).min(1),
  tasks: z.array(z.string().trim().min(1).max(160)).max(30).optional(),
}).refine((value) => value.fulfillmentMode !== "DELIVERY" || Boolean(value.deliveryAddress), { message: "Delivery address is required", path: ["deliveryAddress"] });
const customOrderTransitionSchema = z.object({ id: z.string().min(1), status: z.enum(["REQUESTED", "QUOTED", "AWAITING_CUSTOMER_APPROVAL", "CONFIRMED", "MATERIALS_RESERVED", "IN_PREPARATION", "READY", "FULFILLED", "CANCELLED"]) });

const settingKeys = [
  "theme",
  "printerName",
  "labelPrinterName",
  "storeName",
  "receiptHeader",
  "receiptFooter",
  "receiptPaperWidth",
  "receiptShowLogo",
  "receiptShowCustomer",
  "receiptShowSku",
  "receiptShowTendered",
  "labelWidth",
  "labelHeight",
  "labelShowLogo",
  "labelShowVariant",
  "labelShowSku",
  "labelShowBarcode",
  "language",
  "primaryColor",
  "storeLogo",
  "sidebarCollapsed",
  "localSessionTimeout",
] as const;

export function registerIpc(
  database: PosDatabase,
  sync: SyncService,
  access: LocalAccessService,
  assets: ProductAssetService,
  mainWindow: BrowserWindow,
) {
  const state = () => ({ ...sync.state(), localAccess: access.state() });
  const requireCapability = (capability: string) => {
    const enabled = JSON.parse(database.getSetting("capabilities") ?? "[]") as string[];
    if (!enabled.includes(capability)) throw new Error(`CAPABILITY_REQUIRED:${capability}`);
  };
  const handle = (
    channel: string,
    listener: (...args: any[]) => unknown,
    options: { permission?: Permission | Permission[]; authenticated?: boolean; audit?: boolean } = {},
  ) => ipcMain.handle(channel, async (_event, ...args) => {
    if (options.permission || options.authenticated)
      access.require(options.permission);
    const result = await listener(...args);
    if (options.audit) access.audit(channel.replace("pos:", "").toUpperCase());
    return result;
  });
  handle("pos:get-state", state);
  handle("pos:sign-in", async (raw) => {
    const input = signInSchema.parse(raw);
    const endpoint = normalizeEndpoint(input.endpoint);
    const result = await signIn(endpoint, input.email, input.password);
    const boundPartnerUserId = database.getSetting("boundPartnerUserId");
    if (boundPartnerUserId && boundPartnerUserId !== String(result.signIn.user.id))
      throw new Error("This POS installation belongs to another partner account");
    await sync.activate({ endpoint, ...result.signIn }, input.deviceName);
    if (!boundPartnerUserId)
      database.setSetting("boundPartnerUserId", String(result.signIn.user.id));
    return state();
  });
  handle("pos:sign-out", () => {
    access.audit("PARTNER_SIGN_OUT");
    access.logout();
    clearSession(database);
    return undefined;
  }, { authenticated: true });
  handle("pos:setup-local-owner", (raw) => {
    if (!sync.state().authenticated) throw new Error("Online partner sign-in is required");
    const input = localUserBaseSchema.pick({ name: true, username: true, secret: true }).parse(raw);
    access.setupOwner(input);
    return state();
  });
  handle("pos:local-login", (raw) => {
    const input = localLoginSchema.parse(raw);
    access.login(input.username, input.secret);
    return state();
  });
  handle("pos:local-logout", () => access.logout(), { authenticated: true });
  handle("pos:local-touch", () => access.touch(), { authenticated: true });
  handle("pos:get-access-model", () => ({ permissions: [...permissions], rolePermissions }), { permission: "USERS_MANAGE" });
  handle("pos:list-local-users", () => access.listUsers(), { permission: "USERS_MANAGE" });
  handle("pos:create-local-user", (raw) => access.createUser(localUserSchema.parse(raw)), { permission: "USERS_MANAGE" });
  handle("pos:update-local-user", (raw) => access.updateUser(localUserUpdateSchema.parse(raw)), { permission: "USERS_MANAGE" });
  handle("pos:reset-local-user-secret", (raw) => {
    const input = resetSecretSchema.parse(raw);
    return access.resetSecret(input.id, input.secret);
  }, { permission: "USERS_MANAGE" });
  handle("pos:list-audit-logs", () => access.listAudit(), { permission: "USERS_MANAGE" });
  handle("pos:sync", () => sync.sync(), { permission: "SYNC_MANAGE", audit: true });
  handle("pos:list-products", (raw) =>
    database.listProducts(listSchema.parse(raw)),
  { permission: ["POS_SELL", "INVENTORY_VIEW"] });
  handle("pos:list-inventory", (raw) =>
    database.listInventory(listSchema.parse(raw)),
  { permission: "INVENTORY_VIEW" });
  handle("pos:list-movements", (raw) =>
    database.listMovements(movementSchema.parse(raw)),
  { permission: "INVENTORY_VIEW" });
  handle("pos:list-catalog", () => database.listCatalog(), { permission: ["POS_SELL", "INVENTORY_VIEW", "CATALOG_REQUEST"] });
  handle("pos:list-templates", (raw) =>
    database.listTemplates(listSchema.parse(raw)),
  { permission: ["INVENTORY_VIEW", "CATALOG_REQUEST"] });
  handle("pos:activate-product", async (raw) => {
    const product = database.activateProduct(activateSchema.parse(raw)) as { local_id: string };
    await assets.localizeProduct(product.local_id);
    return product;
  },
  { permission: "INVENTORY_MANAGE", audit: true });
  handle("pos:create-local-product", async (raw) => {
    const product = database.createLocalProduct(localProductSchema.parse(raw)) as { local_id: string };
    await assets.localizeProduct(product.local_id);
    return product;
  },
  { permission: "CATALOG_REQUEST", audit: true });
  handle("pos:get-overview", (raw) =>
    database.overview(reportSchema.parse(raw)),
  { permission: "REPORTS_VIEW" });
  handle("pos:list-sales", () => database.listSales(), { permission: "INVOICES_VIEW" });
  handle("pos:list-orders", () => database.listOrders(), { permission: "ORDERS_VIEW" });
  handle("pos:list-gift-orders", () => { requireCapability("CUSTOM_ORDERS"); return database.listGiftOrders(); }, { permission: "CUSTOM_ORDERS_VIEW" });
  handle("pos:create-custom-order", (raw) => {
    requireCapability("GIFT_BUILDER");
    sync.assertCanTransact();
    return database.createCustomOrder(customOrderSchema.parse(raw));
  }, { permission: "CUSTOM_ORDERS_MANAGE", audit: true });
  handle("pos:transition-custom-order", (raw) => {
    requireCapability("CUSTOM_ORDERS");
    sync.assertCanTransact();
    const input = customOrderTransitionSchema.parse(raw);
    return database.transitionCustomOrder(input.id, input.status);
  }, { permission: "CUSTOM_ORDERS_MANAGE", audit: true });
  handle("pos:create-custom-order-quotation", (raw) => {
    requireCapability("QUOTATIONS");
    sync.assertCanTransact();
    const { id } = z.object({ id: z.string().min(1) }).parse(raw);
    return database.queueCustomOrderCommand(id, "CREATE_CUSTOM_ORDER_QUOTATION", "QUOTED");
  }, { permission: "CUSTOM_ORDERS_MANAGE", audit: true });
  handle("pos:reserve-custom-order-materials", (raw) => {
    requireCapability("PRODUCTION");
    sync.assertCanTransact();
    const { id } = z.object({ id: z.string().min(1) }).parse(raw);
    return database.queueCustomOrderCommand(id, "RESERVE_CUSTOM_ORDER_MATERIALS", "MATERIALS_RESERVED");
  }, { permission: "CUSTOM_ORDERS_MANAGE", audit: true });
  handle("pos:list-invoices", () => database.listInvoices(), { permission: "INVOICES_VIEW" });
  handle("pos:list-stock-entries", () => database.listStockEntries(), { permission: "STOCK_RECEIVE" });
  handle("pos:create-stock-entry", (raw) => {
    const user = access.require("STOCK_RECEIVE");
    return database.createStockEntry({ ...stockEntrySchema.parse(raw), operatorId: user.id, operatorName: user.name });
  }, { permission: "STOCK_RECEIVE", audit: true });
  handle("pos:cancel-stock-entry", (id) => database.cancelStockEntry(z.string().uuid().parse(id)), { permission: "STOCK_RECEIVE", audit: true });
  handle("pos:list-proposals", () => database.listProposals(), { permission: "CATALOG_REQUEST" });
  handle("pos:list-outbox", () => database.listOutbox(), { permission: "SYNC_MANAGE" });
  handle("pos:retry-outbox", (id) =>
    database.retryOutbox(z.string().uuid().parse(id)),
  { permission: "SYNC_MANAGE", audit: true });
  handle("pos:create-proposal", (raw) =>
    database.createProposal(proposalSchema.parse(raw)),
  { permission: "CATALOG_REQUEST", audit: true });
  handle("pos:checkout", (raw) => {
    sync.assertCanTransact();
    const user = access.require("POS_SELL");
    return database.checkout({ ...checkoutSchema.parse(raw), operatorId: user.id, operatorName: user.name });
  }, { permission: "POS_SELL", audit: true });
  handle("pos:get-cash-session", () => database.getCashSession(), { permission: ["POS_SELL", "REGISTER_MANAGE"] });
  handle("pos:list-cash-sessions", () => database.listCashSessions(), { permission: "REGISTER_MANAGE" });
  handle("pos:open-cash-session", (raw) => {
    sync.assertCanTransact();
    return database.openCashSession(cashOpenSchema.parse(raw));
  }, { permission: "REGISTER_MANAGE", audit: true });
  handle("pos:close-cash-session", (raw) => {
    sync.assertCanTransact();
    return database.closeCashSession(cashCloseSchema.parse(raw));
  }, { permission: "REGISTER_MANAGE", audit: true });
  handle("pos:adjust-stock", (raw) =>
    database.adjustStock(stockSchema.parse(raw)),
  { permission: "INVENTORY_MANAGE", audit: true });
  handle("pos:update-product", (raw) =>
    database.updateProduct(productUpdateSchema.parse(raw)),
  { permission: "INVENTORY_MANAGE", audit: true });
  handle("pos:refresh-product-image", async (raw) => {
    const input = z.object({ productLocalId: z.string().min(1) }).parse(raw);
    await sync.sync();
    return assets.refreshProduct(input.productLocalId);
  }, { permission: "INVENTORY_MANAGE", audit: true });
  handle("pos:refresh-product-images", async (raw) => {
    const input = z.object({
      productLocalIds: z.array(z.string().min(1)).max(500).optional(),
    }).optional().parse(raw);
    await sync.sync();
    return assets.refreshProducts(input?.productLocalIds);
  }, { permission: "INVENTORY_MANAGE", audit: true });
  handle("pos:list-printers", () => listPrinters(mainWindow), { authenticated: true });
  handle("pos:print-receipt", (raw) => {
    const input = printSchema.parse(raw);
    return printReceipt(database, input.saleId, input.printerName);
  }, { permission: ["POS_SELL", "INVOICES_VIEW", "SETTINGS_MANAGE"] });
  handle("pos:preview-receipt", (raw) => {
    const input = printPreviewSchema.parse(raw);
    return previewReceipt(database, input?.saleId, input?.settings);
  }, { permission: ["POS_SELL", "INVOICES_VIEW", "SETTINGS_MANAGE"] });
  handle("pos:preview-invoice", (raw) => {
    const input = documentSchema.parse(raw);
    return previewInvoice(database, input.source, input.id);
  }, { permission: "INVOICES_VIEW" });
  handle("pos:print-invoice", (raw) => {
    const input = documentSchema.parse(raw);
    return printInvoice(database, input.source, input.id, input.printerName);
  }, { permission: "INVOICES_VIEW", audit: true });
  handle("pos:preview-stock-entry", (raw) => previewStockEntry(database, stockEntryDocumentSchema.parse(raw).id), { permission: "STOCK_RECEIVE" });
  handle("pos:print-stock-entry", (raw) => {
    const input = stockEntryDocumentSchema.parse(raw);
    return printStockEntry(database, input.id, input.printerName);
  }, { permission: "STOCK_RECEIVE", audit: true });
  handle("pos:preview-price-label", (raw) => {
    const input = printPreviewSchema.parse(raw);
    return previewPriceLabel(
      database,
      input?.productLocalId,
      input?.settings,
    );
  }, { permission: ["INVENTORY_VIEW", "INVENTORY_MANAGE", "SETTINGS_MANAGE"] });
  handle("pos:print-price-labels", (raw) => {
    const input = priceLabelPrintSchema.parse(raw);
    return printPriceLabels(database, input.items, input.printerName);
  }, { permission: "INVENTORY_MANAGE", audit: true });
  handle("pos:test-printer", (raw) => {
    const input = printPreviewSchema.parse(raw);
    return testPrinter(database, input?.settings?.printerName, input?.settings);
  }, { permission: "SETTINGS_MANAGE", audit: true });
  handle("pos:test-price-label", (raw) => {
    const input = printPreviewSchema.parse(raw);
    return testPriceLabel(
      database,
      input?.settings?.labelPrinterName,
      input?.settings,
    );
  }, { permission: "SETTINGS_MANAGE", audit: true });
  handle("pos:get-settings", () => {
    const values = database.getSettings();
    return Object.fromEntries(
      [...settingKeys, "endpoint"].map((key) => [key, values[key] ?? ""]),
    );
  });
  handle("pos:update-settings", (raw) => {
    const values = z.record(z.string(), z.string().max(3_000_000)).parse(raw);
    const allowed = new Set<string>(settingKeys);
    for (const [key, value] of Object.entries(values))
      if (allowed.has(key)) database.setSetting(key, value);
    return Object.fromEntries(
      [...allowed].map((key) => [key, database.getSetting(key) ?? ""]),
    );
  }, { permission: "SETTINGS_MANAGE", audit: true });
}
