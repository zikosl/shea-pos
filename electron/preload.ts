import { contextBridge, ipcRenderer } from "electron";
import type { PosApi } from "./contracts";

const api: PosApi = {
  updateStatus: () => ipcRenderer.invoke("pos:update-status"),
  checkForUpdate: () => ipcRenderer.invoke("pos:check-for-update"),
  downloadUpdate: () => ipcRenderer.invoke("pos:download-update"),
  installUpdate: () => ipcRenderer.invoke("pos:install-update"),
  onUpdateStatus: (listener) => {
    const handler = (_event: Electron.IpcRendererEvent, status: import("./updater").UpdateStatus) => listener(status);
    ipcRenderer.on("pos:update-status", handler);
    return () => ipcRenderer.removeListener("pos:update-status", handler);
  },
  getState: () => ipcRenderer.invoke("pos:get-state"),
  copyText: (value) => ipcRenderer.invoke("pos:copy-text", value),
  getGatewayStatus: () => ipcRenderer.invoke("pos:get-gateway-status"),
  configureDeployment: (input) => ipcRenderer.invoke("pos:configure-deployment", input),
  getStoreNetwork: () => ipcRenderer.invoke("pos:get-store-network"),
  provisionStoreGateway: (input) => ipcRenderer.invoke("pos:provision-store-gateway", input),
  pairGateway: (input) => ipcRenderer.invoke("pos:pair-gateway", input),
  disconnectGateway: () => ipcRenderer.invoke("pos:disconnect-gateway"),
  signIn: (input) => ipcRenderer.invoke("pos:sign-in", input),
  signOut: () => ipcRenderer.invoke("pos:sign-out"),
  setupLocalOwner: (input) => ipcRenderer.invoke("pos:setup-local-owner", input),
  localLogin: (input) => ipcRenderer.invoke("pos:local-login", input),
  localLogout: () => ipcRenderer.invoke("pos:local-logout"),
  localTouch: () => ipcRenderer.invoke("pos:local-touch"),
  getAccessModel: () => ipcRenderer.invoke("pos:get-access-model"),
  listLocalUsers: () => ipcRenderer.invoke("pos:list-local-users"),
  createLocalUser: (input) => ipcRenderer.invoke("pos:create-local-user", input),
  updateLocalUser: (input) => ipcRenderer.invoke("pos:update-local-user", input),
  resetLocalUserSecret: (input) => ipcRenderer.invoke("pos:reset-local-user-secret", input),
  listAuditLogs: () => ipcRenderer.invoke("pos:list-audit-logs"),
  sync: (options) => ipcRenderer.invoke("pos:sync", options),
  listProducts: (input) => ipcRenderer.invoke("pos:list-products", input),
  listInventory: (input) => ipcRenderer.invoke("pos:list-inventory", input),
  listMovements: (input) => ipcRenderer.invoke("pos:list-movements", input),
  listCatalog: () => ipcRenderer.invoke("pos:list-catalog"),
  listTemplates: (input) => ipcRenderer.invoke("pos:list-templates", input),
  activateProduct: (input) => ipcRenderer.invoke("pos:activate-product", input),
  createLocalProduct: (input) =>
    ipcRenderer.invoke("pos:create-local-product", input),
  getOverview: (input) => ipcRenderer.invoke("pos:get-overview", input),
  listSales: () => ipcRenderer.invoke("pos:list-sales"),
  listOrders: () => ipcRenderer.invoke("pos:list-orders"),
  listGiftOrders: () => ipcRenderer.invoke("pos:list-gift-orders"),
  createCustomOrder: (input) => ipcRenderer.invoke("pos:create-custom-order", input),
  transitionCustomOrder: (input) => ipcRenderer.invoke("pos:transition-custom-order", input),
  createCustomOrderQuotation: (input) => ipcRenderer.invoke("pos:create-custom-order-quotation", input),
  reserveCustomOrderMaterials: (input) => ipcRenderer.invoke("pos:reserve-custom-order-materials", input),
  listInvoices: () => ipcRenderer.invoke("pos:list-invoices"),
  listStockEntries: () => ipcRenderer.invoke("pos:list-stock-entries"),
  createStockEntry: (input) => ipcRenderer.invoke("pos:create-stock-entry", input),
  cancelStockEntry: (id) => ipcRenderer.invoke("pos:cancel-stock-entry", id),
  listProposals: () => ipcRenderer.invoke("pos:list-proposals"),
  listOutbox: () => ipcRenderer.invoke("pos:list-outbox"),
  retryOutbox: (id) => ipcRenderer.invoke("pos:retry-outbox", id),
  createProposal: (input) => ipcRenderer.invoke("pos:create-proposal", input),
  checkout: (input) => ipcRenderer.invoke("pos:checkout", input),
  getCashSession: () => ipcRenderer.invoke("pos:get-cash-session"),
  listCashSessions: () => ipcRenderer.invoke("pos:list-cash-sessions"),
  openCashSession: (input) =>
    ipcRenderer.invoke("pos:open-cash-session", input),
  closeCashSession: (input) =>
    ipcRenderer.invoke("pos:close-cash-session", input),
  adjustStock: (input) => ipcRenderer.invoke("pos:adjust-stock", input),
  updateProduct: (input) => ipcRenderer.invoke("pos:update-product", input),
  refreshProductImage: (input) => ipcRenderer.invoke("pos:refresh-product-image", input),
  refreshProductImages: (input) => ipcRenderer.invoke("pos:refresh-product-images", input),
  listPrinters: () => ipcRenderer.invoke("pos:list-printers"),
  printReceipt: (input) => ipcRenderer.invoke("pos:print-receipt", input),
  previewReceipt: (input) => ipcRenderer.invoke("pos:preview-receipt", input),
  previewInvoice: (input) => ipcRenderer.invoke("pos:preview-invoice", input),
  printInvoice: (input) => ipcRenderer.invoke("pos:print-invoice", input),
  previewStockEntry: (input) => ipcRenderer.invoke("pos:preview-stock-entry", input),
  printStockEntry: (input) => ipcRenderer.invoke("pos:print-stock-entry", input),
  previewPriceLabel: (input) =>
    ipcRenderer.invoke("pos:preview-price-label", input),
  printPriceLabels: (input) =>
    ipcRenderer.invoke("pos:print-price-labels", input),
  testPrinter: (input) => ipcRenderer.invoke("pos:test-printer", input),
  testPriceLabel: (input) =>
    ipcRenderer.invoke("pos:test-price-label", input),
  getSettings: () => ipcRenderer.invoke("pos:get-settings"),
  updateSettings: (input) => ipcRenderer.invoke("pos:update-settings", input),
};

contextBridge.exposeInMainWorld("pos", api);
