import { contextBridge, ipcRenderer } from "electron";
import type { PosApi } from "./contracts";

const api: PosApi = {
  getState: () => ipcRenderer.invoke("pos:get-state"),
  signIn: (input) => ipcRenderer.invoke("pos:sign-in", input),
  signOut: () => ipcRenderer.invoke("pos:sign-out"),
  sync: () => ipcRenderer.invoke("pos:sync"),
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
  listPrinters: () => ipcRenderer.invoke("pos:list-printers"),
  printReceipt: (input) => ipcRenderer.invoke("pos:print-receipt", input),
  previewReceipt: (input) => ipcRenderer.invoke("pos:preview-receipt", input),
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
