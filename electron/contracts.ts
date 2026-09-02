export type PaymentMethod = "CASH" | "CARD" | "OTHER";

export type CheckoutInput = {
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

export type PosApi = {
  getState(): Promise<unknown>;
  signIn(input: {
    endpoint: string;
    email: string;
    password: string;
    deviceName: string;
  }): Promise<unknown>;
  signOut(): Promise<void>;
  sync(): Promise<unknown>;
  listProducts(input?: {
    search?: string;
    categoryId?: number;
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
  listPrinters(): Promise<unknown[]>;
  printReceipt(input: { saleId: string; printerName?: string }): Promise<void>;
  previewReceipt(input?: {
    saleId?: string;
    settings?: Record<string, string>;
  }): Promise<string>;
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
