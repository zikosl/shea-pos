import { BrowserWindow } from "electron";
import bwipjs from "bwip-js";
import type { PosDatabase } from "./database";

type ReceiptLanguage = "en" | "ar";
type PrintSettings = Record<string, string>;

const receiptText = {
  en: { subtotal: "Subtotal", discount: "Discount", tax: "Tax", total: "Total", payment: "Payment", cash: "Cash", tendered: "Tendered", change: "Change", customer: "Customer", sku: "SKU", thankYou: "Thank you for your purchase" },
  ar: { subtotal: "المجموع الفرعي", discount: "الخصم", tax: "الضريبة", total: "الإجمالي", payment: "الدفع", cash: "نقداً", tendered: "المبلغ المستلم", change: "الباقي", customer: "الزبون", sku: "الرمز", thankYou: "شكراً لتسوقكم معنا" },
};

function escape(value: unknown) {
  return String(value ?? "").replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character]!);
}

function enabled(settings: PrintSettings, key: string, fallback = true) {
  const value = settings[key];
  return value === undefined || value === "" ? fallback : value === "true";
}

function numberSetting(settings: PrintSettings, key: string, fallback: number, min: number, max: number) {
  const value = Number(settings[key]);
  return Number.isFinite(value) ? Math.min(max, Math.max(min, value)) : fallback;
}

function languageOf(settings: PrintSettings): ReceiptLanguage {
  return settings.language === "ar" ? "ar" : "en";
}

function money(value: unknown) {
  return `${Number(value ?? 0).toFixed(2)} DZD`;
}

function barcodeSvg(value?: string | null) {
  if (!value) return "";
  try {
    return bwipjs.toSVG({ bcid: "code128", text: value, scale: 1, height: 8, includetext: true, textsize: 7, backgroundcolor: "FFFFFF" });
  } catch {
    return "";
  }
}

function documentHtml(body: string, language: ReceiptLanguage, pageCss: string) {
  return `<!doctype html><html lang="${language}" dir="${language === "ar" ? "rtl" : "ltr"}"><head><meta charset="utf-8"><meta name="color-scheme" content="light"><style>*{box-sizing:border-box}html,body{margin:0;padding:0;background:#fff;color:#111}body{font-family:"Segoe UI",Tahoma,Arial,sans-serif;-webkit-print-color-adjust:exact;print-color-adjust:exact}${pageCss}</style></head><body>${body}</body></html>`;
}

export function receiptHtml(sale: any, items: any[], settings: PrintSettings) {
  const language = languageOf(settings);
  const text = receiptText[language];
  const width = numberSetting(settings, "receiptPaperWidth", 80, 48, 100);
  const footer = settings.receiptFooter || text.thankYou;
  const logo = settings.storeLogo;
  const payment = sale.payment_method === "CASH" ? text.cash : sale.payment_method;
  const lines = items.map((item) => `<div class="item"><div class="item-name"><strong>${escape(item.product_name)}</strong>${item.variant_name ? `<small>${escape(item.variant_name)}</small>` : ""}${enabled(settings, "receiptShowSku", true) && item.sku ? `<small>${text.sku}: ${escape(item.sku)}</small>` : ""}</div><div class="row"><span>${item.quantity} × ${money(item.unit_price)}</span><strong>${money(item.total)}</strong></div></div>`).join("");
  const body = `<main class="receipt"><header>${enabled(settings, "receiptShowLogo", true) && logo ? `<img src="${escape(logo)}" alt="">` : ""}<h1>${escape(settings.storeName || "Shea POS")}</h1>${settings.receiptHeader ? `<p>${escape(settings.receiptHeader)}</p>` : ""}</header><div class="meta"><strong>${escape(sale.sale_number)}</strong><span>${escape(new Date(sale.created_at).toLocaleString(language === "ar" ? "ar-DZ" : "en-DZ"))}</span></div>${enabled(settings, "receiptShowCustomer", true) && sale.customer_name ? `<div class="customer">${text.customer}: ${escape(sale.customer_name)}</div>` : ""}<div class="rule"></div>${lines}<div class="rule"></div><div class="totals"><div class="row"><span>${text.subtotal}</span><span>${money(sale.subtotal)}</span></div>${Number(sale.discount_total) ? `<div class="row"><span>${text.discount}</span><span>-${money(sale.discount_total)}</span></div>` : ""}${Number(sale.tax_total) ? `<div class="row"><span>${text.tax}</span><span>${money(sale.tax_total)}</span></div>` : ""}<div class="row grand"><strong>${text.total}</strong><strong>${money(sale.total)}</strong></div><div class="row"><span>${text.payment}</span><span>${escape(payment)}</span></div>${enabled(settings, "receiptShowTendered", true) ? `<div class="row"><span>${text.tendered}</span><span>${money(sale.amount_tendered)}</span></div><div class="row"><span>${text.change}</span><span>${money(sale.change_due)}</span></div>` : ""}</div><footer>${escape(footer)}</footer></main>`;
  return documentHtml(body, language, `@page{size:${width}mm auto;margin:0}.receipt{width:${width}mm;min-height:90mm;padding:4mm;font-size:11px}.receipt header{text-align:center;margin-bottom:3mm}.receipt header img{display:block;max-width:22mm;max-height:16mm;object-fit:contain;margin:0 auto 2mm}.receipt h1{font-size:18px;margin:0}.receipt header p,.meta span{margin:1mm 0;color:#444;font-size:9px;white-space:pre-line}.meta{display:flex;justify-content:space-between;gap:3mm;font-size:9px}.customer{margin-top:2mm}.rule{border-top:1px dashed #111;margin:3mm 0}.item{margin:2.4mm 0}.item-name{display:flex;flex-direction:column}.item small{font-size:8px;color:#444}.row{display:flex;justify-content:space-between;align-items:flex-start;gap:3mm}.totals .row{margin:1.2mm 0}.grand{padding-top:2mm;margin-top:2mm!important;border-top:1px solid #111;font-size:15px}.receipt footer{text-align:center;white-space:pre-line;margin-top:5mm;font-size:9px}`);
}

export function priceLabelHtml(products: Array<{ product: any; copies: number }>, settings: PrintSettings) {
  const language = languageOf(settings);
  const width = numberSetting(settings, "labelWidth", 50, 25, 100);
  const height = numberSetting(settings, "labelHeight", 30, 15, 100);
  const labels = products.flatMap(({ product, copies }) => Array.from({ length: Math.min(100, Math.max(1, copies)) }, () => {
    const code = product.barcode || product.sku;
    const barcode = enabled(settings, "labelShowBarcode", true) ? barcodeSvg(code) : "";
    return `<article class="label">${enabled(settings, "labelShowLogo", false) && settings.storeLogo ? `<img class="logo" src="${escape(settings.storeLogo)}" alt="">` : ""}<div class="copy"><strong>${escape(language === "ar" && product.name_ar ? product.name_ar : product.name)}</strong>${enabled(settings, "labelShowVariant", true) && product.variant_name ? `<small>${escape(product.variant_name)}</small>` : ""}</div><div class="price">${money(product.price)}</div>${barcode ? `<div class="barcode">${barcode}</div>` : enabled(settings, "labelShowSku", true) && code ? `<div class="code">${escape(code)}</div>` : ""}</article>`;
  }));
  return documentHtml(labels.join(""), language, `@page{size:${width}mm ${height}mm;margin:0}.label{position:relative;width:${width}mm;height:${height}mm;padding:2.2mm;overflow:hidden;display:grid;grid-template-columns:1fr auto;grid-template-rows:auto 1fr auto;column-gap:2mm;page-break-after:always;border:.2mm solid #ddd}.label:last-child{page-break-after:auto}.logo{position:absolute;top:2mm;inset-inline-end:2mm;width:8mm;height:6mm;object-fit:contain}.copy{display:flex;min-width:0;flex-direction:column;grid-column:1/-1;padding-inline-end:${enabled(settings, "labelShowLogo", false) ? "9mm" : "0"}}.copy strong{overflow:hidden;font-size:10px;line-height:1.1;text-overflow:ellipsis;white-space:nowrap}.copy small,.code{font-size:7px;color:#333}.price{align-self:center;font-size:${height >= 35 ? "22px" : "18px"};font-weight:800;white-space:nowrap}.barcode{align-self:end;justify-self:end;width:${Math.min(30, width * 0.55)}mm;direction:ltr}.barcode svg{display:block;width:100%;height:auto;max-height:${Math.max(8, height * 0.36)}mm}.code{grid-column:1/-1;text-align:center;direction:ltr}`);
}

const sampleSale = () => ({ sale_number: "POS-PREVIEW-001", created_at: new Date().toISOString(), customer_name: "Customer", subtotal: 3200, discount_total: 200, tax_total: 0, total: 3000, payment_method: "CASH", amount_tendered: 5000, change_due: 2000 });
const sampleItems = () => [
  { product_name: "Beauty serum", variant_name: "30 ml", sku: "SER-30", quantity: 1, unit_price: 1800, total: 1800 },
  { product_name: "Body cream", variant_name: "Rose", sku: "CRM-RS", quantity: 2, unit_price: 700, total: 1400 },
];
const sampleProduct = () => ({ name: "Beauty serum", name_ar: "سيروم العناية", variant_name: "30 ml", sku: "SER-30", barcode: "6130000123456", price: 1800 });

export async function listPrinters(window: BrowserWindow) {
  return window.webContents.getPrintersAsync();
}

async function printHtml(html: string, printerName?: string, pageSize?: { width: number; height: number }) {
  const printWindow = new BrowserWindow({ show: false, webPreferences: { sandbox: true } });
  try {
    await printWindow.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`);
    await new Promise<void>((resolve, reject) => printWindow.webContents.print({ silent: true, printBackground: true, deviceName: printerName || undefined, margins: { marginType: "none" }, ...(pageSize ? { pageSize } : {}) }, (success, reason) => success ? resolve() : reject(new Error(reason || "Printing failed"))));
  } finally {
    printWindow.destroy();
  }
}

export function previewReceipt(database: PosDatabase, saleId?: string, draft: PrintSettings = {}) {
  const settings = { ...database.getSettings(), ...draft };
  if (saleId) {
    const { sale, items } = database.getSaleWithItems(saleId) as any;
    if (!sale) throw new Error("Sale not found");
    return receiptHtml(sale, items, settings);
  }
  return receiptHtml(sampleSale(), sampleItems(), settings);
}

export function previewPriceLabel(database: PosDatabase, productLocalId?: string, draft: PrintSettings = {}) {
  const settings = { ...database.getSettings(), ...draft };
  const product = productLocalId ? database.getProductByLocalId(productLocalId) : sampleProduct();
  if (!product) throw new Error("Product not found");
  return priceLabelHtml([{ product, copies: 1 }], settings);
}

export async function printReceipt(database: PosDatabase, saleId: string, printerName?: string) {
  await printHtml(previewReceipt(database, saleId), printerName);
}

export async function printPriceLabels(database: PosDatabase, items: Array<{ productLocalId: string; copies: number }>, printerName?: string) {
  const settings = database.getSettings();
  const products = items.map((item) => {
    const product = database.getProductByLocalId(item.productLocalId);
    if (!product) throw new Error("Product not found");
    return { product, copies: item.copies };
  });
  const width = numberSetting(settings, "labelWidth", 50, 25, 100);
  const height = numberSetting(settings, "labelHeight", 30, 15, 100);
  await printHtml(priceLabelHtml(products, settings), printerName || settings.labelPrinterName || undefined, { width: Math.round(width * 1000), height: Math.round(height * 1000) });
}

export async function testPrinter(database: PosDatabase, printerName?: string, draft: PrintSettings = {}) {
  await printHtml(previewReceipt(database, undefined, draft), printerName);
}

export async function testPriceLabel(database: PosDatabase, printerName?: string, draft: PrintSettings = {}) {
  const settings = { ...database.getSettings(), ...draft };
  const width = numberSetting(settings, "labelWidth", 50, 25, 100);
  const height = numberSetting(settings, "labelHeight", 30, 15, 100);
  await printHtml(priceLabelHtml([{ product: sampleProduct(), copies: 1 }], settings), printerName, {
    width: Math.round(width * 1000),
    height: Math.round(height * 1000),
  });
}
