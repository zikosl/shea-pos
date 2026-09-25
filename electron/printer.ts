import { BrowserWindow } from "electron";
import bwipjs from "bwip-js";
import type { PosDatabase } from "./database";

type ReceiptLanguage = "en" | "ar";
type PrintSettings = Record<string, string>;

const receiptText = {
  en: { subtotal: "Subtotal", discount: "Discount", tax: "Tax", total: "Total", payment: "Payment", cash: "Cash", tendered: "Tendered", change: "Change", customer: "Customer", note: "Note", sku: "SKU", corrected: "Corrected invoice", scan: "Scan to find this invoice", thankYou: "Thank you for your purchase" },
  ar: { subtotal: "المجموع الفرعي", discount: "الخصم", tax: "الضريبة", total: "الإجمالي", payment: "الدفع", cash: "نقداً", tendered: "المبلغ المستلم", change: "الباقي", customer: "الزبون", note: "ملاحظة", sku: "الرمز", corrected: "فاتورة مصححة", scan: "امسح للعثور على الفاتورة", thankYou: "شكراً لتسوقكم معنا" },
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

function choiceSetting(settings: PrintSettings, key: string, choices: string[], fallback: string) {
  const value = settings[key];
  return value && choices.includes(value) ? value : fallback;
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

function qrSvg(value?: string | null) {
  if (!value) return "";
  try {
    return bwipjs.toSVG({ bcid: "qrcode", text: value, scale: 2, padding: 0, backgroundcolor: "FFFFFF" });
  } catch {
    return "";
  }
}

function invoiceReference(saleNumber: string) {
  const source = /^ORD-/i.test(saleNumber) ? "DELIVERY" : "POS";
  return `shea:invoice:v1:${source}:${saleNumber}`;
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
  const codeType = choiceSetting(settings, "receiptCodeType", ["none", "qr", "barcode", "both"], "qr");
  const codePosition = choiceSetting(settings, "receiptCodePosition", ["header", "beforeTotals", "footer"], "footer");
  const codeAlignment = choiceSetting(settings, "receiptCodeAlignment", ["start", "center", "end"], "center");
  const density = choiceSetting(settings, "receiptDensity", ["compact", "standard", "comfortable"], "standard");
  const textSize = choiceSetting(settings, "receiptTextSize", ["small", "standard", "large"], "standard");
  const marginSize = choiceSetting(settings, "receiptMargin", ["small", "standard", "large"], "standard");
  const logoSize = choiceSetting(settings, "receiptLogoSize", ["small", "medium", "large"], "medium");
  const invoiceBarcode = codeType === "barcode" || codeType === "both" ? barcodeSvg(sale.sale_number) : "";
  const invoiceQr = codeType === "qr" || codeType === "both" ? qrSvg(invoiceReference(String(sale.sale_number))) : "";
  const revision = Number(sale.revision ?? 1);
  const fontSize = textSize === "small" ? 9.5 : textSize === "large" ? 12.5 : 11;
  const pageMargin = marginSize === "small" ? 2.5 : marginSize === "large" ? 6 : 4;
  const itemGap = density === "compact" ? 1.3 : density === "comfortable" ? 3.4 : 2.4;
  const ruleGap = density === "compact" ? 2 : density === "comfortable" ? 4 : 3;
  const logoWidth = logoSize === "small" ? 14 : logoSize === "large" ? 30 : 22;
  const logoHeight = logoSize === "small" ? 10 : logoSize === "large" ? 22 : 16;
  const codeJustify = codeAlignment === "center"
    ? "center"
    : codeAlignment === "start"
      ? (language === "ar" ? "flex-end" : "flex-start")
      : (language === "ar" ? "flex-start" : "flex-end");
  const codeTextAlign = codeJustify === "center" ? "center" : codeJustify === "flex-end" ? "right" : "left";
  const stackCodes = width < 70 || codeType !== "both";
  const codeBlock = codeType === "none" || (!invoiceQr && !invoiceBarcode) ? "" : `<section class="invoice-codes"><div class="code-assets">${invoiceQr ? `<div class="qr">${invoiceQr}</div>` : ""}${invoiceBarcode ? `<div class="barcode">${invoiceBarcode}</div>` : ""}</div><small>${text.scan}</small></section>`;
  const lines = items.map((item) => `<div class="item"><div class="item-name"><strong>${escape(item.product_name)}</strong>${item.variant_name ? `<small>${escape(item.variant_name)}</small>` : ""}${enabled(settings, "receiptShowSku", true) && item.sku ? `<small>${text.sku}: ${escape(item.sku)}</small>` : ""}</div><div class="row"><span>${item.quantity} × ${money(item.unit_price)}</span><strong>${money(item.total)}</strong></div></div>`).join("");
  const meta = `<div class="meta"><strong>${escape(sale.sale_number)}</strong><span>${escape(new Date(sale.created_at).toLocaleString(language === "ar" ? "ar-DZ" : "en-DZ"))}</span></div>`;
  const details = `${revision > 1 ? `<div class="corrected">${text.corrected} · ${revision}</div>` : ""}${enabled(settings, "receiptShowCustomer", true) && sale.customer_name ? `<div class="customer">${text.customer}: ${escape(sale.customer_name)}</div>` : ""}${enabled(settings, "receiptShowNote", true) && sale.note ? `<div class="customer">${text.note}: ${escape(sale.note)}</div>` : ""}`;
  const totals = `<div class="totals"><div class="row"><span>${text.subtotal}</span><span>${money(sale.subtotal)}</span></div>${Number(sale.discount_total) ? `<div class="row"><span>${text.discount}</span><span>-${money(sale.discount_total)}</span></div>` : ""}${Number(sale.tax_total) ? `<div class="row"><span>${text.tax}</span><span>${money(sale.tax_total)}</span></div>` : ""}<div class="row grand"><strong>${text.total}</strong><strong>${money(sale.total)}</strong></div><div class="row"><span>${text.payment}</span><span>${escape(payment)}</span></div>${enabled(settings, "receiptShowTendered", true) ? `<div class="row"><span>${text.tendered}</span><span>${money(sale.amount_tendered)}</span></div><div class="row"><span>${text.change}</span><span>${money(sale.change_due)}</span></div>` : ""}</div>`;
  const body = `<main class="receipt"><header>${enabled(settings, "receiptShowLogo", true) && logo ? `<img src="${escape(logo)}" alt="">` : ""}<h1>${escape(settings.storeName || "Shea POS")}</h1>${settings.receiptHeader ? `<p>${escape(settings.receiptHeader)}</p>` : ""}</header>${meta}${codePosition === "header" ? codeBlock : ""}${details}<div class="rule"></div>${lines}<div class="rule"></div>${codePosition === "beforeTotals" ? codeBlock : ""}${totals}${codePosition === "footer" ? codeBlock : ""}<footer>${escape(footer)}</footer></main>`;
  return documentHtml(body, language, `@page{size:${width}mm auto;margin:0}.receipt{width:${width}mm;min-height:90mm;padding:${pageMargin}mm;font-size:${fontSize}px}.receipt header{text-align:center;margin-bottom:${ruleGap}mm}.receipt header img{display:block;max-width:${logoWidth}mm;max-height:${logoHeight}mm;object-fit:contain;margin:0 auto 2mm}.receipt h1{font-size:${fontSize + 7}px;margin:0}.receipt header p,.meta span{margin:1mm 0;color:#444;font-size:${Math.max(8, fontSize - 2)}px;white-space:pre-line}.meta{display:flex;justify-content:space-between;gap:3mm;font-size:${Math.max(8, fontSize - 2)}px;direction:${language === "ar" ? "rtl" : "ltr"}}.customer{margin-top:2mm}.corrected{margin:2mm 0;padding:1.5mm;border:1px solid #111;text-align:center;font-size:${Math.max(8, fontSize - 2)}px;font-weight:700}.rule{border-top:1px dashed #111;margin:${ruleGap}mm 0}.item{margin:${itemGap}mm 0}.item-name{display:flex;flex-direction:column}.item small{font-size:${Math.max(7, fontSize - 3)}px;color:#444}.row{display:flex;justify-content:space-between;align-items:flex-start;gap:3mm}.totals .row{margin:${density === "compact" ? 0.8 : density === "comfortable" ? 1.6 : 1.2}mm 0}.grand{padding-top:2mm;margin-top:2mm!important;border-top:1px solid #111;font-size:${fontSize + 4}px}.invoice-codes{margin-top:${ruleGap}mm;padding-top:${Math.max(1.5, ruleGap - 0.5)}mm;border-top:1px dashed #111;text-align:${codeTextAlign};direction:ltr}.code-assets{display:flex;flex-direction:${stackCodes ? "column" : "row"};align-items:${codeJustify};justify-content:${codeJustify};gap:2mm}.invoice-codes .qr svg{display:block;width:18mm;height:18mm}.invoice-codes .barcode{width:${Math.max(28, width - (pageMargin * 2) - 5)}mm;max-width:100%}.invoice-codes .barcode svg{display:block;width:100%;max-height:17mm}.invoice-codes small{display:block;margin-top:1.5mm;color:#444;font-size:${Math.max(7, fontSize - 3)}px}.receipt footer{text-align:center;white-space:pre-line;margin-top:${ruleGap + 1}mm;font-size:${Math.max(8, fontSize - 2)}px}`);
}

function deliveryReceipt(database: PosDatabase, id: string) {
  const order = database.getOrder(id) as any;
  const payload = order.payload ?? {};
  const rawItems = payload.items ?? payload.orderItems ?? [];
  const items = rawItems.map((item: any) => {
    const product = item.product ?? {};
    const template = product.variant?.product ?? product.productTemplate ?? {};
    const unitPrice = Number(item.price ?? item.unitPrice ?? product.price ?? 0);
    const quantity = Number(item.quantity ?? 1);
    return {
      product_name: product.customName ?? template.name ?? item.name ?? "Product",
      variant_name: product.variant?.name ?? item.variantName ?? null,
      sku: product.vendorSku ?? product.variant?.sku ?? item.sku ?? null,
      quantity,
      unit_price: unitPrice,
      total: Number(item.total ?? unitPrice * quantity),
    };
  });
  const subtotal = Number(payload.subtotal ?? order.total ?? items.reduce((sum: number, item: any) => sum + item.total, 0));
  return {
    sale: {
      sale_number: `ORD-${order.server_id}`,
      created_at: payload.createdAt ?? payload.date ?? order.updated_at,
      customer_name: order.customer_name ?? payload.walkInCustomerName ?? payload.client?.user?.name,
      subtotal,
      discount_total: Number(payload.discount ?? 0),
      tax_total: Number(payload.appTax ?? 0) + Number(payload.storeTax ?? 0) + Number(payload.deliveryTax ?? 0),
      total: Number(payload.total ?? subtotal),
      payment_method: payload.paymentMethod ?? "CASH",
      amount_tendered: Number(payload.total ?? subtotal),
      change_due: 0,
    },
    items,
  };
}

export function previewInvoice(database: PosDatabase, source: "POS" | "DELIVERY", id: string, draft: PrintSettings = {}) {
  if (source === "POS") return previewReceipt(database, id, draft);
  const { sale, items } = deliveryReceipt(database, id);
  return receiptHtml(sale, items, { ...database.getSettings(), ...draft });
}

export async function printInvoice(database: PosDatabase, source: "POS" | "DELIVERY", id: string, printerName?: string) {
  await printHtml(previewInvoice(database, source, id), printerName);
}

export function previewStockEntry(database: PosDatabase, id: string) {
  const { entry, items } = database.getStockEntry(id) as any;
  const settings = database.getSettings();
  const language = languageOf(settings);
  const width = numberSetting(settings, "receiptPaperWidth", 80, 48, 100);
  const title = language === "ar" ? "إيصال استلام مخزون" : "Stock receiving note";
  const supplier = language === "ar" ? "المورد" : "Supplier";
  const reference = language === "ar" ? "مرجع المورد" : "Supplier reference";
  const quantity = language === "ar" ? "الكمية" : "Qty";
  const unitCost = language === "ar" ? "تكلفة الوحدة" : "Unit cost";
  const total = language === "ar" ? "الإجمالي" : "Total";
  const lines = items.map((item: any) => `<div class="entry-line"><strong>${escape(item.product_name)}</strong>${item.variant_name ? `<small>${escape(item.variant_name)}</small>` : ""}<div class="row"><span>${quantity}: ${item.quantity} · ${unitCost}: ${money(item.unit_cost)}</span><strong>${money(item.total_cost)}</strong></div></div>`).join("");
  const body = `<main class="receipt"><header><h1>${escape(settings.storeName || "Shea POS")}</h1><p>${title}</p></header><div class="meta"><strong>${escape(entry.entry_number)}</strong><span>${escape(new Date(entry.entry_date).toLocaleString(language === "ar" ? "ar-DZ" : "en-DZ"))}</span></div>${entry.supplier_name ? `<p>${supplier}: ${escape(entry.supplier_name)}</p>` : ""}${entry.supplier_invoice ? `<p>${reference}: ${escape(entry.supplier_invoice)}</p>` : ""}<div class="rule"></div>${lines}<div class="rule"></div><div class="row grand"><strong>${total}</strong><strong>${money(entry.total_cost)}</strong></div>${entry.note ? `<footer>${escape(entry.note)}</footer>` : ""}</main>`;
  return documentHtml(body, language, `@page{size:${width}mm auto;margin:0}.receipt{width:${width}mm;min-height:90mm;padding:4mm;font-size:10px}.receipt header{text-align:center;margin-bottom:3mm}.receipt h1{font-size:18px;margin:0}.receipt header p,.receipt>p,.meta span{margin:1mm 0;color:#444;font-size:9px}.meta{display:flex;justify-content:space-between;gap:3mm}.rule{border-top:1px dashed #111;margin:3mm 0}.entry-line{display:flex;flex-direction:column;margin:2.5mm 0}.entry-line small{color:#555}.row{display:flex;justify-content:space-between;gap:3mm}.grand{padding-top:2mm;font-size:14px}.receipt footer{text-align:center;margin-top:5mm;font-size:9px}`);
}

export async function printStockEntry(database: PosDatabase, id: string, printerName?: string) {
  await printHtml(previewStockEntry(database, id), printerName);
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
