export type PaymentMethod = "CASH" | "CARD" | "OTHER";
export type LocalRole = "OWNER" | "MANAGER" | "CASHIER" | "STOCK_CLERK" | "CUSTOM";
export type { UpdateStatus } from "./updater";
export type Permission =
  | "POS_SELL" | "REGISTER_MANAGE" | "ORDERS_VIEW" | "INVOICES_VIEW"
  | "INVENTORY_VIEW" | "INVENTORY_MANAGE" | "STOCK_RECEIVE"
  | "CATALOG_REQUEST" | "REPORTS_VIEW" | "SETTINGS_MANAGE"
  | "SYNC_MANAGE" | "USERS_MANAGE" | "CUSTOM_ORDERS_VIEW" | "CUSTOM_ORDERS_MANAGE";

export type CapabilityCode =
  | "CUSTOM_ORDERS" | "QUOTATIONS" | "GIFT_BUILDER" | "GIFT_TEMPLATES"
  | "PRODUCTION" | "PRODUCTION_TASKS" | "DELIVERY_PICKUP" | "GIFT_GALLERY" | "GIFT_REPORTS";

export type CheckoutInput = {
  operatorId?: string;
  operatorName?: string;
  customerName?: string;
  note?: string;
  discountTotal?: number;
  taxTotal?: number;
  paymentMethod: PaymentMethod;
  amountTendered?: number;
  lines: Array<{
    productLocalId: string;
    quantity: number;
    unitPrice?: number;
    discount?: number;
  }>;
};

export type ProposalInput = {
  localId?: string;
  entityType: "CATEGORY" | "PRODUCT_TYPE";
  name: string;
  nameAr?: string;
  description?: string;
  image?: string;
  nicheId: number;
  categoryId?: number;
  parentProposalId?: string;
};

export type ActivateProductInput = {
  variantId: number;
  price: number;
  costPrice?: number;
  stock: number;
  trackInventory: boolean;
  reorderThreshold?: number;
  visibleInPos?: boolean;
};

export type CreateLocalProductInput = {
  name: string;
  nameAr?: string;
  description?: string;
  categoryId: number;
  productTypeId?: number;
  brandId?: number;
  variantName?: string;
  sku?: string;
  image?: string;
  price: number;
  costPrice?: number;
  stock: number;
  trackInventory: boolean;
  reorderThreshold?: number;
};

export type CreateStockEntryInput = {
  operatorId?: string;
  operatorName?: string;
  supplierName?: string;
  supplierInvoice?: string;
  entryDate?: string;
  note?: string;
  lines: Array<{
    productLocalId: string;
    quantity: number;
    pricingMode: "UNIT" | "TOTAL";
    price: number;
  }>;
};

export type CreateCustomOrderInput = {
  nicheId?: number;
  customerName: string;
  customerPhone?: string;
  requiredAt?: string;
  fulfillmentMode: "PICKUP" | "DELIVERY";
  deliveryAddress?: string;
  note?: string;
  occasion?: string;
  recipientName?: string;
  cardMessage?: string;
  style?: string;
  wrappingNote?: string;
  discount?: number;
  lines: Array<{ productLocalId?: string; name: string; description?: string; quantity: number; unitPrice: number; unitCost?: number }>;
  tasks?: string[];
};

export type PosApi = {
  updateStatus(): Promise<import("./updater").UpdateStatus>;
  checkForUpdate(): Promise<import("./updater").UpdateStatus>;
  downloadUpdate(): Promise<import("./updater").UpdateStatus>;
  installUpdate(): Promise<void>;
  onUpdateStatus(listener: (status: import("./updater").UpdateStatus) => void): () => void;
  getState(): Promise<unknown>;
  signIn(input: {
    endpoint: string;
    email: string;
    password: string;
    deviceName: string;
  }): Promise<unknown>;
  signOut(): Promise<void>;
  setupLocalOwner(input: { name: string; username: string; secret: string }): Promise<unknown>;
  localLogin(input: { username: string; secret: string }): Promise<unknown>;
  localLogout(): Promise<void>;
  localTouch(): Promise<void>;
  getAccessModel(): Promise<{ permissions: Permission[]; rolePermissions: Record<LocalRole, Permission[]> }>;
  listLocalUsers(): Promise<unknown[]>;
  createLocalUser(input: { name: string; username: string; secret: string; role: LocalRole; permissions?: Permission[] }): Promise<unknown>;
  updateLocalUser(input: { id: string; name: string; username: string; role: LocalRole; permissions?: Permission[]; active: boolean }): Promise<unknown>;
  resetLocalUserSecret(input: { id: string; secret: string }): Promise<void>;
  listAuditLogs(): Promise<unknown[]>;
  sync(options?: { forceRetry?: boolean }): Promise<unknown>;
  listProducts(input?: {
    search?: string;
    categoryId?: number;
    nicheId?: number;
    limit?: number;
    offset?: number;
  }): Promise<unknown[]>;
  listInventory(input?: {
    search?: string;
    limit?: number;
    offset?: number;
  }): Promise<unknown[]>;
  listMovements(input?: {
    search?: string;
    type?: string;
    productLocalId?: string;
    limit?: number;
    offset?: number;
  }): Promise<unknown[]>;
  listCatalog(): Promise<unknown>;
  listTemplates(input?: {
    search?: string;
    categoryId?: number;
    limit?: number;
    offset?: number;
  }): Promise<unknown[]>;
  activateProduct(input: ActivateProductInput): Promise<unknown>;
  createLocalProduct(input: CreateLocalProductInput): Promise<unknown>;
  getOverview(input?: { from?: string; to?: string }): Promise<unknown>;
  listSales(): Promise<unknown[]>;
  listOrders(): Promise<unknown[]>;
  listGiftOrders(): Promise<unknown[]>;
  createCustomOrder(input: CreateCustomOrderInput): Promise<unknown>;
  transitionCustomOrder(input: { id: string; status: string }): Promise<unknown>;
  createCustomOrderQuotation(input: { id: string }): Promise<unknown>;
  reserveCustomOrderMaterials(input: { id: string }): Promise<unknown>;
  listInvoices(): Promise<unknown[]>;
  listStockEntries(): Promise<unknown[]>;
  createStockEntry(input: CreateStockEntryInput): Promise<unknown>;
  cancelStockEntry(id: string): Promise<unknown>;
  listProposals(): Promise<unknown[]>;
  listOutbox(): Promise<unknown[]>;
  retryOutbox(id: string): Promise<void>;
  createProposal(input: ProposalInput): Promise<unknown>;
  checkout(input: CheckoutInput): Promise<unknown>;
  getCashSession(): Promise<unknown>;
  listCashSessions(): Promise<unknown[]>;
  openCashSession(input: {
    openingAmount: number;
    note?: string;
  }): Promise<unknown>;
  closeCashSession(input: {
    countedCash: number;
    note?: string;
  }): Promise<unknown>;
  adjustStock(input: {
    productLocalId: string;
    mode: "RECEIVE" | "REMOVE" | "SET";
    quantity: number;
    reason: string;
  }): Promise<unknown>;
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
  }): Promise<unknown>;
  refreshProductImage(input: { productLocalId: string }): Promise<unknown>;
  refreshProductImages(input?: { productLocalIds?: string[] }): Promise<unknown>;
  listPrinters(): Promise<unknown[]>;
  printReceipt(input: { saleId: string; printerName?: string }): Promise<void>;
  previewReceipt(input?: {
    saleId?: string;
    settings?: Record<string, string>;
  }): Promise<string>;
  previewInvoice(input: {
    source: "POS" | "DELIVERY";
    id: string;
  }): Promise<string>;
  printInvoice(input: {
    source: "POS" | "DELIVERY";
    id: string;
    printerName?: string;
  }): Promise<void>;
  previewStockEntry(input: { id: string }): Promise<string>;
  printStockEntry(input: { id: string; printerName?: string }): Promise<void>;
  previewPriceLabel(input?: {
    productLocalId?: string;
    settings?: Record<string, string>;
  }): Promise<string>;
  printPriceLabels(input: {
    items: Array<{ productLocalId: string; copies: number }>;
    printerName?: string;
  }): Promise<void>;
  testPrinter(input: {
    printerName?: string;
    settings?: Record<string, string>;
  }): Promise<void>;
  testPriceLabel(input: {
    printerName?: string;
    settings?: Record<string, string>;
  }): Promise<void>;
  getSettings(): Promise<Record<string, string>>;
  updateSettings(
    input: Record<string, string>,
  ): Promise<Record<string, string>>;
};
