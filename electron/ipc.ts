import { app, BrowserWindow, clipboard, dialog, ipcMain } from "electron";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { PosDatabase } from "./database";
import { listAccountSessions, logoutAccountSession, normalizeEndpoint, refreshSession, revokeAccountSession, revokeOtherAccountSessions, signIn } from "./graphql";
import { clearSession, readSession, writeSession } from "./session";
import type { SyncService } from "./sync";
import type { ProductAssetService } from "./assets";
import type { PosUpdater } from "./updater";
import type { GatewayService } from "./gateway";
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
const recoverLocalOwnerSchema = z.object({
  username: z.string().trim().min(1).max(80),
  partnerPassword: z.string().min(1).max(500),
  secret: z.string().min(4).max(128),
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
  paymentMethod: z.literal("CASH"),
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
  settings: z.record(z.string(), z.string().max(3_000_000)).optional(),
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
  priceOnRequest: z.boolean().optional(),
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
  priceOnRequest: z.boolean().optional(),
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
  priceOnRequest: z.boolean().optional(),
});
const localProductBundleSchema = localProductSchema
  .omit({ variantName: true, sku: true, image: true, price: true, costPrice: true, stock: true, reorderThreshold: true, priceOnRequest: true })
  .extend({
    images: z.array(z.string().startsWith("draft:catalog-drafts/").max(1000)).min(1).max(12),
    variants: z.array(z.object({
      name: z.string().trim().min(1).max(120),
      tags: z.array(z.string().trim().min(1).max(80)).min(1).max(20),
      sku: z.string().trim().min(1).max(120),
      image: z.string().startsWith("draft:catalog-drafts/").max(1000).optional(),
      price: z.number().min(0),
      costPrice: z.number().min(0).optional(),
      stock: z.number().int().min(0),
      reorderThreshold: z.number().int().min(0).optional(),
      priceOnRequest: z.boolean().optional(),
    })).min(1).max(100),
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
const invoiceLookupSchema = z.object({ reference: z.string().trim().min(1).max(300) });
const invoiceCorrectionSchema = z.object({
  id: z.string().uuid(),
  customerName: z.string().trim().max(120).optional(),
  note: z.string().trim().max(1000).optional(),
  reason: z.string().trim().min(3).max(500),
});
const refundSaleSchema = z.object({
  saleId: z.string().uuid(),
  reason: z.string().trim().min(3).max(500),
  lines: z.array(z.object({ saleItemId: z.string().uuid(), quantity: z.number().positive() })).min(1).max(250),
});
const heldCartSchema = z.object({
  id: z.string().uuid().optional(),
  name: z.string().trim().max(120).optional(),
  customerName: z.string().trim().max(120).optional(),
  lines: z.array(z.object({
    productLocalId: z.string().min(1),
    quantity: z.number().int().positive(),
    unitPrice: z.number().min(0).optional(),
  })).min(1).max(500),
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
const customOrderTransitionSchema = z.object({ id: z.string().min(1), status: z.enum(["REQUESTED", "QUOTED", "AWAITING_CUSTOMER_APPROVAL", "CONFIRMED", "SCHEDULED", "PREPARATION_DUE", "MATERIALS_RESERVED", "IN_PREPARATION", "READY", "FULFILLED", "CANCELLED"]) });
const customOrderQuotationSchema = z.object({
  id: z.string().min(1),
  proposedFor: z.string().datetime().optional(),
  validUntil: z.string().datetime().optional(),
  preparationStartsAt: z.string().datetime().optional(),
  discount: z.number().finite().min(0).optional(),
  note: z.string().trim().max(1000).optional(),
  lines: z.array(z.object({
    productId: z.number().int().positive().optional(),
    name: z.string().trim().min(1).max(240),
    description: z.string().trim().max(1000).optional(),
    quantity: z.number().finite().positive(),
    unitPrice: z.number().finite().min(0),
  })).min(1).max(100),
});
const onlineOrderTransitionSchema = z.object({
  id: z.number().int().positive(),
  status: z.enum(["PARTNER_ACCEPTED", "PREPARING", "READY"]),
  expectedVersion: z.number().int().positive(),
});
const onlineOrderQuotationSchema = z.object({
  id: z.number().int().positive(),
  expectedVersion: z.number().int().positive(),
  note: z.string().trim().max(1000).optional(),
  lines: z.array(z.object({ orderItemId: z.number().int().positive(), unitPrice: z.number().finite().min(0) })).min(1).max(100),
});

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
  "receiptShowNote",
  "receiptPreset",
  "receiptDensity",
  "receiptTextSize",
  "receiptMargin",
  "receiptLogoSize",
  "receiptCodeType",
  "receiptCodePosition",
  "receiptCodeAlignment",
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
  "deploymentMode",
  "deploymentConfigured",
  "gatewayUrl",
] as const;

export function registerIpc(
  database: PosDatabase,
  sync: SyncService,
  access: LocalAccessService,
  assets: ProductAssetService,
  mainWindow: BrowserWindow,
  updater: PosUpdater,
  gateway: GatewayService,
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
  handle("pos:copy-text", (raw) => clipboard.writeText(z.string().max(10_000).parse(raw)), { authenticated: true });
  handle("pos:get-gateway-status", () => gateway.status(), { authenticated: true });
  handle("pos:get-store-network", () => sync.storeNetwork(), { permission: "SETTINGS_MANAGE" });
  handle("pos:provision-store-gateway", (raw) => {
    const { storeId } = z.object({ storeId: z.string().uuid() }).parse(raw);
    return sync.provisionGateway(storeId);
  }, { permission: "SETTINGS_MANAGE", audit: true });
  handle("pos:pair-gateway", (raw) => {
    const input = z.object({
      url: z.string().url(),
      pairingCode: z.string().min(4).max(160),
      name: z.string().trim().min(1).max(120),
    }).parse(raw);
    return gateway.pair(input);
  }, { permission: "SETTINGS_MANAGE", audit: true });
  handle("pos:disconnect-gateway", () => gateway.disconnect(), { permission: "SETTINGS_MANAGE", audit: true });
  handle("pos:update-status", () => updater.status());
  handle("pos:check-for-update", () => updater.check());
  handle("pos:download-update", () => updater.download());
  handle("pos:install-update", () => updater.install());
  handle("pos:sign-in", async (raw) => {
    const input = signInSchema.parse(raw);
    const endpoint = normalizeEndpoint(input.endpoint);
    let deviceKey = database.getSetting("deviceKey");
    if (!deviceKey) {
      deviceKey = randomUUID();
      database.setSetting("deviceKey", deviceKey);
    }
    const result = await signIn(endpoint, input.email, input.password, {
      deviceKey,
      deviceName: input.deviceName,
      platform: `desktop-${process.platform}`,
      appVersion: app.getVersion(),
    });
    const boundPartnerUserId = database.getSetting("boundPartnerUserId");
    if (boundPartnerUserId && boundPartnerUserId !== String(result.signIn.user.id))
      throw new Error("This POS installation belongs to another partner account");
    await sync.activate({ endpoint, ...result.signIn }, input.deviceName);
    if (!boundPartnerUserId)
      database.setSetting("boundPartnerUserId", String(result.signIn.user.id));
    return state();
  });
  handle("pos:sign-out", async () => {
    access.audit("PARTNER_SIGN_OUT");
    let session = readSession(database);
    if (session && !session.tokenId) {
      const existingSession = session;
      session = await refreshSession(existingSession).catch(() => existingSession);
      if (session.tokenId) writeSession(database, session);
    }
    if (session?.tokenId) await logoutAccountSession(session).catch(() => undefined);
    access.logout();
    clearSession(database);
    return undefined;
  }, { authenticated: true });
  handle("pos:list-account-sessions", async () => {
    let session = readSession(database);
    if (!session) throw new Error("Sign in is required");
    if (!session.tokenId) {
      session = await refreshSession(session);
      writeSession(database, session);
    }
    const result = await listAccountSessions(session);
    return { sessions: result.mySessions, currentTokenId: session.tokenId || "" };
  }, { permission: "SETTINGS_MANAGE" });
  handle("pos:revoke-account-session", async (raw) => {
    const { tokenId } = z.object({ tokenId: z.string().uuid() }).parse(raw);
    const session = readSession(database);
    if (!session) throw new Error("Sign in is required");
    await revokeAccountSession(session, tokenId);
    if (tokenId === session.tokenId) {
      access.logout();
      clearSession(database);
    }
  }, { permission: "SETTINGS_MANAGE", audit: true });
  handle("pos:revoke-other-account-sessions", async () => {
    const session = readSession(database);
    if (!session) throw new Error("Sign in is required");
    await revokeOtherAccountSessions(session);
  }, { permission: "SETTINGS_MANAGE", audit: true });
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
  handle("pos:recover-local-owner", async (raw) => {
    const input = recoverLocalOwnerSchema.parse(raw);
    const session = readSession(database);
    if (!session?.user.email) throw new Error("Online partner verification is unavailable");
    const result = await signIn(session.endpoint, session.user.email, input.partnerPassword, {
      deviceKey: `${database.getSetting("deviceKey") || randomUUID()}-recovery`,
      deviceName: "Shea POS recovery verification",
      platform: `desktop-${process.platform}`,
      appVersion: app.getVersion(),
    });
    await logoutAccountSession({ endpoint: session.endpoint, ...result.signIn }).catch(() => undefined);
    if (String(result.signIn.user.id) !== String(session.user.id))
      throw new Error("Partner account does not match this POS installation");
    access.recoverOwnerSecret(input.username, input.secret);
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
  handle("pos:sync", (raw) =>
    sync.sync(z.object({ forceRetry: z.boolean().optional() }).optional().parse(raw)?.forceRetry ?? false),
  { permission: "SYNC_MANAGE", audit: true });
  handle("pos:list-products", async (raw) => {
    if (gateway.enabled()) await gateway.refreshProducts();
    return database.listProducts(listSchema.parse(raw));
  },
  { permission: ["POS_SELL", "INVENTORY_VIEW"] });
  handle("pos:list-inventory", async (raw) => {
    if (gateway.enabled()) await gateway.refreshProducts();
    return database.listInventory(listSchema.parse(raw));
  },
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
  handle("pos:create-local-product-bundle", async (raw) => {
    const products = database.createLocalProductBundle(localProductBundleSchema.parse(raw)) as Array<{ local_id: string }>;
    await Promise.all(products.map((product) => assets.localizeProduct(product.local_id)));
    return products;
  }, { permission: "CATALOG_REQUEST", audit: true });
  handle("pos:select-catalog-image", async () => {
    const result = await dialog.showOpenDialog(mainWindow, {
      title: "Choose product image",
      properties: ["openFile"],
      filters: [{ name: "Images", extensions: ["jpg", "jpeg", "png", "webp"] }],
    });
    if (result.canceled || !result.filePaths[0]) return null;
    return assets.importCatalogDraft(result.filePaths[0]);
  }, { permission: "CATALOG_REQUEST" });
  handle("pos:get-overview", (raw) =>
    database.overview(reportSchema.parse(raw)),
  { permission: "REPORTS_VIEW" });
  handle("pos:list-sales", () => database.listSales(), { permission: "INVOICES_VIEW" });
  handle("pos:list-orders", () => database.listOrders(), { permission: "ORDERS_VIEW" });
  handle("pos:transition-online-order", (raw) => {
    sync.assertCanTransact();
    const input = onlineOrderTransitionSchema.parse(raw);
    return database.queueOnlineOrderCommand(input.id, "TRANSITION_ONLINE_ORDER", input.status, input);
  }, { permission: "ORDERS_VIEW", audit: true });
  handle("pos:create-online-order-quotation", (raw) => {
    sync.assertCanTransact();
    const input = onlineOrderQuotationSchema.parse(raw);
    return database.queueOnlineOrderCommand(input.id, "CREATE_ONLINE_ORDER_QUOTATION", "AWAITING_CLIENT_APPROVAL", input);
  }, { permission: "ORDERS_VIEW", audit: true });
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
    const input = customOrderQuotationSchema.parse(raw);
    return database.queueCustomOrderCommand(input.id, "CREATE_CUSTOM_ORDER_QUOTATION", "AWAITING_CUSTOMER_APPROVAL", input);
  }, { permission: "CUSTOM_ORDERS_MANAGE", audit: true });
  handle("pos:reserve-custom-order-materials", (raw) => {
    requireCapability("PRODUCTION");
    sync.assertCanTransact();
    const { id } = z.object({ id: z.string().min(1) }).parse(raw);
    return database.queueCustomOrderCommand(id, "RESERVE_CUSTOM_ORDER_MATERIALS", "MATERIALS_RESERVED");
  }, { permission: "CUSTOM_ORDERS_MANAGE", audit: true });
  handle("pos:list-invoices", () => database.listInvoices(), { permission: "INVOICES_VIEW" });
  handle("pos:lookup-invoice", (raw) => database.lookupInvoice(invoiceLookupSchema.parse(raw).reference), { permission: "INVOICES_VIEW" });
  handle("pos:correct-invoice-details", (raw) => {
    if (gateway.enabled()) throw new Error("INVOICE_CORRECTION_REQUIRES_SOLO_MODE");
    const user = access.require("REGISTER_MANAGE");
    const result = database.correctInvoiceDetails({ ...invoiceCorrectionSchema.parse(raw), operatorId: user.id, operatorName: user.name });
    access.audit("INVOICE_DETAILS_CORRECTED", "Sale", (result as any).id, { revision: (result as any).revision });
    return result;
  }, { permission: "REGISTER_MANAGE" });
  handle("pos:get-sale-details", (raw) => database.getSaleDetails(z.string().uuid().parse(raw)), { permission: "INVOICES_VIEW" });
  handle("pos:refund-sale", (raw) => {
    sync.assertCanTransact();
    const user = access.require("SALES_REFUND");
    const input = refundSaleSchema.parse(raw);
    const refundId = randomUUID();
    database.validateRefund(input);
    const complete = () => {
      const result = database.refundSale({ ...input, refundId, operatorId: user.id, operatorName: user.name, gatewayCommitted: gateway.enabled() });
      access.audit("SALE_REFUNDED", "Sale", input.saleId, { reason: input.reason, refundId });
      return result;
    };
    if (!gateway.enabled()) return complete();
    return gateway.refundSale({ ...input, refundId, cashierId: user.id, cashierName: user.name })
      .then(async () => {
        const result = complete();
        await gateway.refreshProducts();
        return result;
      });
  }, { permission: "SALES_REFUND" });
  handle("pos:list-held-carts", () => database.listHeldCarts(), { permission: "POS_SELL" });
  handle("pos:hold-cart", (raw) => {
    const user = access.require("POS_SELL");
    return database.holdCart({ ...heldCartSchema.parse(raw), operatorId: user.id, operatorName: user.name });
  }, { permission: "POS_SELL", audit: true });
  handle("pos:delete-held-cart", (raw) => database.deleteHeldCart(z.string().uuid().parse(raw)), { permission: "POS_SELL", audit: true });
  handle("pos:list-stock-entries", () => database.listStockEntries(), { permission: "STOCK_RECEIVE" });
  handle("pos:create-stock-entry", (raw) => {
    const user = access.require("STOCK_RECEIVE");
    const input = { ...stockEntrySchema.parse(raw), operatorId: user.id, operatorName: user.name };
    if (!gateway.enabled()) return database.createStockEntry(input);
    return gateway.applyStockBatch({
      id: randomUUID(),
      operation: "RECEIPT",
      reference: input.supplierInvoice,
      lines: database.gatewayStockEntryLines(input),
    }).then(async () => {
      const result = database.createStockEntry({ ...input, gatewayCommitted: true });
      await gateway.refreshProducts();
      return result;
    });
  }, { permission: "STOCK_RECEIVE", audit: true });
  handle("pos:cancel-stock-entry", async (rawId) => {
    const id = z.string().uuid().parse(rawId);
    if (!gateway.enabled()) return database.cancelStockEntry(id);
    const cancellation = database.gatewayStockEntryCancellation(id);
    await gateway.applyStockBatch({ id: randomUUID(), operation: "REVERSE", ...cancellation });
    const result = database.cancelStockEntry(id, true);
    await gateway.refreshProducts();
    return result;
  }, { permission: "STOCK_RECEIVE", audit: true });
  handle("pos:list-proposals", () => database.listProposals(), { permission: "CATALOG_REQUEST" });
  handle("pos:list-outbox", () => database.listOutbox(), { permission: "SYNC_MANAGE" });
  handle("pos:retry-outbox", (id) =>
    database.retryOutbox(z.string().uuid().parse(id)),
  { permission: "SYNC_MANAGE", audit: true });
  handle("pos:create-proposal", (raw) =>
    database.createProposal(proposalSchema.parse(raw)),
  { permission: "CATALOG_REQUEST", audit: true });
  handle("pos:checkout", async (raw) => {
    sync.assertCanTransact();
    const user = access.require("POS_SELL");
    const input = { ...checkoutSchema.parse(raw), operatorId: user.id, operatorName: user.name };
    if (!gateway.enabled()) return database.checkout(input);
    const transactionId = randomUUID();
    const device = JSON.parse(database.getSetting("device") ?? "{}") as { id?: string };
    const saleNumber = `POS-${device.id?.slice(0, 6) ?? "LOCAL"}-${Date.now()}`;
    await gateway.createSale(input, transactionId, saleNumber);
    const sale = database.checkout({ ...input, transactionId, saleNumber, gatewayCommitted: true });
    await gateway.refreshProducts();
    return sale;
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
  handle("pos:create-backup", async () => {
    const selection = await dialog.showOpenDialog(mainWindow, { title: "Choose backup location", properties: ["openDirectory", "createDirectory"] });
    if (selection.canceled || !selection.filePaths[0]) return null;
    return { path: await database.createBackup(selection.filePaths[0]) };
  }, { permission: "SETTINGS_MANAGE", audit: true });
  handle("pos:restore-backup", async () => {
    const selection = await dialog.showOpenDialog(mainWindow, { title: "Choose a Shea POS backup folder", properties: ["openDirectory"] });
    if (selection.canceled || !selection.filePaths[0]) return { restored: false };
    database.stageRestore(selection.filePaths[0]);
    setTimeout(() => { app.relaunch(); app.exit(0); }, 250);
    return { restored: true };
  }, { permission: "SETTINGS_MANAGE", audit: true });
  handle("pos:adjust-stock", async (raw) => {
    const input = stockSchema.parse(raw);
    if (gateway.enabled()) await gateway.adjustStock(input);
    const result = database.adjustStock({ ...input, gatewayCommitted: gateway.enabled() });
    if (gateway.enabled()) await gateway.refreshProducts();
    return result;
  },
  { permission: "INVENTORY_MANAGE", audit: true });
  handle("pos:update-product", async (raw) => {
    const input = productUpdateSchema.parse(raw);
    if (gateway.enabled()) await gateway.updateProduct(input);
    const result = database.updateProduct({ ...input, gatewayCommitted: gateway.enabled() });
    if (gateway.enabled()) await gateway.refreshProducts();
    return result;
  },
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
    return previewInvoice(database, input.source, input.id, input.settings);
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
  handle("pos:configure-deployment", (raw) => {
    if (database.getSetting("deploymentConfigured") === "true")
      throw new Error("DEPLOYMENT_ALREADY_CONFIGURED");
    const input = z.object({
      mode: z.enum(["solo", "multi"]),
      gatewayUrl: z.string().url().optional(),
    }).parse(raw);
    if (input.mode === "multi" && !input.gatewayUrl) throw new Error("GATEWAY_URL_REQUIRED");
    database.setSetting("deploymentMode", input.mode);
    if (input.gatewayUrl) database.setSetting("gatewayUrl", input.gatewayUrl.replace(/\/$/, ""));
    database.setSetting("deploymentConfigured", "true");
    return database.getSettings();
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
