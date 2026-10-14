import { useCallback, useEffect, useMemo, useState } from "react";
import { Eye, FileClock, LoaderCircle, Minus, Pencil, Plus, Printer, ReceiptText, RotateCcw, ScanLine, Search, X } from "lucide-react";
import { EmptyState } from "../../components/EmptyState";
import { ErrorState, LoadingState } from "../../components/AsyncState";
import { Pagination } from "../../components/Pagination";
import { PageHeader } from "../../components/PageHeader";
import { TextAreaField } from "../../components/TextAreaField";
import { money } from "../../shared/format";
import { localeFor, localizeError, localizeValue, useI18n } from "../../i18n";
import { OrderActivity } from "./OrderActivity";

export function OrdersScreen({ openOrderId, onOpenedOrder, onUnreadOrdersChanged }: { openOrderId?: number | null; onOpenedOrder?: () => void; onUnreadOrdersChanged?: (count: number) => void }) {
  const { t, language } = useI18n();
  const [rows, setRows] = useState<any[]>([]);
  const [page, setPage] = useState(0);
  const pageSize = 25;
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [selected, setSelected] = useState<any | null>(null);
  const [quoting, setQuoting] = useState<any | null>(null);
  const [rejecting, setRejecting] = useState<any | null>(null);
  const [rejectReason, setRejectReason] = useState("");
  const [busy, setBusy] = useState(false);
  const load = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    setError("");
    try {
      const nextRows = (await window.pos.listOrders()) as any[];
      setRows(nextRows);
      try {
        const unreadIds = await window.pos.markOnlineOrdersSeen(nextRows.map((row) => Number(row.server_id)).filter(Number.isSafeInteger));
        onUnreadOrdersChanged?.(unreadIds.length);
      } catch {
        // Showing the inbox must still work if local read-state cannot be saved.
      }
      if (silent) {
        setPage((current) => Math.min(current, Math.max(0, Math.ceil(nextRows.length / pageSize) - 1)));
        setSelected((current: any | null) => current ? nextRows.find((row) => row.server_id === current.server_id) ?? current : null);
      } else {
        setPage(0);
      }
    } catch (value) {
      setError(localizeError(language, value));
    } finally {
      setLoading(false);
    }
  }, [language, onUnreadOrdersChanged]);
  useEffect(() => {
    void load();
    const unsubscribeSync = window.pos.onDataSyncComplete(() => void load(true));
    const unsubscribeRealtimeOrders = window.pos.onRealtimeOrder(() => void load(true));
    return () => {
      unsubscribeSync();
      unsubscribeRealtimeOrders();
    };
  }, [load]);
  useEffect(() => {
    if (!openOrderId || loading) return;
    const row = rows.find((item) => Number(item.server_id) === openOrderId);
    if (row) setSelected(row);
    onOpenedOrder?.();
  }, [openOrderId, loading, rows, onOpenedOrder]);
  const currentRows = rows.slice(page * pageSize, (page + 1) * pageSize);
  async function transition(order: any, status: "PARTNER_ACCEPTED" | "PARTNER_REJECTED" | "PREPARING" | "READY", reason?: string) {
    setBusy(true); setError("");
    try {
      await window.pos.transitionOnlineOrder({ id: order.server_id, status, expectedVersion: order.version, reason });
      setRejecting(null); setRejectReason(""); setSelected(null);
      await load(true);
    } catch (value) { setError(localizeError(language, value)); } finally { setBusy(false); }
  }
  return (
    <div className="page-stack">
      <PageHeader
        eyebrow={t("orders")}
        title={t("onlineInbox")}
        description={t("onlineInboxText")}
      />
      <div className="panel data-panel">
        {loading ? (
          <LoadingState label={t("loadingData")} />
        ) : error ? (
          <ErrorState
            title={t("unableToLoad")}
            text={error || t("tryAgainText")}
            retryLabel={t("retry")}
            onRetry={() => void load()}
          />
        ) : rows.length ? (
          <div className="table">
            <div className="table-row table-head">
              <span>#</span>
              <span>{t("customer")}</span>
              <span>{t("status")}</span>
              <span>{t("total")}</span>
            </div>
            {currentRows.map((row) => (
              <button type="button" className="table-row table-row-button" key={row.server_id} onClick={() => setSelected(row)}>
                <span>
                  <strong>#{row.server_id}</strong>
                </span>
                <span>{row.customer_name || t("customer")}</span>
                <span>
                  <em className="badge">
                    {localizeValue(language, row.status)}
                  </em>
                  {row.delivery_status ? <small>{t("deliveryStatus")}: {localizeValue(language, row.delivery_status)}</small> : null}
                  {row.sync_state && row.sync_state !== "SYNCED" ? <small>{localizeValue(language, row.sync_state)}</small> : null}
                </span>
                <span>{money(row.total)}</span>
              </button>
            ))}
            <Pagination page={page} pageSize={pageSize} total={rows.length} onPageChange={setPage} />
          </div>
        ) : (
          <EmptyState
            icon={FileClock}
            title={t("noOrders")}
            text={t("noOrdersText")}
          />
        )}
      </div>
      {selected ? <OnlineOrderDrawer order={selected} busy={busy} onClose={() => setSelected(null)} onQuote={() => setQuoting(selected)} onReject={() => { setRejectReason(""); setRejecting(selected); }} onTransition={(status) => void transition(selected, status)} /> : null}
      {quoting ? <OnlineOrderQuotationDialog order={quoting} onClose={() => setQuoting(null)} onSubmitted={async () => { setQuoting(null); setSelected(null); await load(); }} /> : null}
      {rejecting ? <div className="modal-backdrop" onMouseDown={(event) => event.target === event.currentTarget && !busy && setRejecting(null)}><section className="modal-card order-reject-dialog" role="dialog" aria-modal="true" aria-labelledby="reject-order-title"><div className="dialog-heading"><div><p className="eyebrow">#{rejecting.server_id}</p><h2 id="reject-order-title">{t("declineOrderTitle")}</h2></div><button type="button" className="icon-button" disabled={busy} onClick={() => setRejecting(null)}><X /></button></div><p className="muted-text">{t("declineOrderHelp")}</p><TextAreaField label={t("declineReason")} value={rejectReason} onChange={(event) => setRejectReason(event.target.value)} maxLength={1000} autoFocus /><div className="dialog-actions"><button type="button" className="button secondary" disabled={busy} onClick={() => setRejecting(null)}>{t("cancel")}</button><button type="button" className="button danger" disabled={busy || !rejectReason.trim()} onClick={() => void transition(rejecting, "PARTNER_REJECTED", rejectReason.trim())}>{busy ? <LoaderCircle className="spin" /> : null}{t("declineOrder")}</button></div></section></div> : null}
    </div>
  );
}

function parseOrderPayload(order: any) {
  try { return JSON.parse(order.payload_json ?? "{}"); } catch { return {}; }
}

function OnlineOrderDrawer({ order, busy, onClose, onQuote, onReject, onTransition }: { order: any; busy: boolean; onClose: () => void; onQuote: () => void; onReject: () => void; onTransition: (status: "PARTNER_ACCEPTED" | "PREPARING" | "READY") => void }) {
  const { t, language } = useI18n();
  const payload = parseOrderPayload(order);
  const next = order.status === "REQUESTED" && order.pricing_mode !== "QUOTE_REQUIRED" ? "PARTNER_ACCEPTED"
    : ["PARTNER_ACCEPTED", "CONFIRMED"].includes(order.status) ? "PREPARING"
      : order.status === "PREPARING" ? "READY" : null;
  return <div className="drawer-backdrop" onMouseDown={(event) => event.target === event.currentTarget && onClose()}><aside className="order-drawer"><div className="dialog-heading"><div><p className="eyebrow">#{order.server_id}</p><h2>{order.customer_name || t("customer")}</h2></div><button type="button" className="icon-button" onClick={onClose}><X /></button></div><div className="order-drawer-content"><div className="order-summary"><span><small>{t("status")}</small><em className="badge">{localizeValue(language, order.status)}</em></span><span><small>{t("deliveryStatus")}</small><strong>{localizeValue(language, order.delivery_status || "PENDING")}</strong></span><span><small>{t("total")}</small><strong>{money(order.total)}</strong></span></div><section><h3>{t("items")}</h3>{(payload.items ?? []).map((item: any) => <div className="drawer-line" key={item.id}><span><strong>{item.nameSnapshot || "#" + item.productId}</strong><small>{item.quantity} × {money(item.price)}</small></span><b>{money(Number(item.quantity) * Number(item.price))}</b></div>)}</section><OrderActivity orderType="ONLINE" orderId={String(order.server_id)} /></div><div className="drawer-actions">{order.status === "REQUESTED" && order.pricing_mode === "QUOTE_REQUIRED" ? <button type="button" className="button primary" disabled={busy || order.sync_state !== "SYNCED"} onClick={onQuote}>{t("createQuotation")}</button> : null}{next ? <button type="button" className="button primary" disabled={busy || order.sync_state !== "SYNCED"} onClick={() => onTransition(next)}>{busy ? <LoaderCircle className="spin" /> : null}{order.status === "REQUESTED" ? t("acceptOrder") : t("moveToNextStage")}</button> : null}{order.status === "REQUESTED" ? <button type="button" className="button danger" disabled={busy || order.sync_state !== "SYNCED"} onClick={onReject}>{t("declineOrder")}</button> : null}{order.sync_state !== "SYNCED" ? <small>{order.last_error || t("syncBeforeWorkflow")}</small> : null}</div></aside></div>;
}

function OnlineOrderQuotationDialog({ order, onClose, onSubmitted }: { order: any; onClose: () => void; onSubmitted: () => void }) {
  const { t, language } = useI18n();
  const payload = parseOrderPayload(order);
  const [lines, setLines] = useState<Array<{ orderItemId: number; name: string; quantity: number; unitPrice: number }>>((payload.items ?? []).map((item: any) => ({ orderItemId: item.id, name: item.nameSnapshot || "#" + item.productId, quantity: Number(item.quantity), unitPrice: Number(item.price ?? 0) })));
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false), [error, setError] = useState("");
  const total = lines.reduce((sum, line) => sum + line.quantity * line.unitPrice, 0);
  async function submit() {
    setBusy(true); setError("");
    try {
      await window.pos.createOnlineOrderQuotation({ id: order.server_id, expectedVersion: order.version, note: note.trim() || undefined, lines: lines.map(({ orderItemId, unitPrice }) => ({ orderItemId, unitPrice })) });
      onSubmitted();
    } catch (value) { setError(localizeError(language, value)); } finally { setBusy(false); }
  }
  return <div className="modal-backdrop" onMouseDown={(event) => event.target === event.currentTarget && !busy && onClose()}><section className="modal-card quotation-dialog" role="dialog" aria-modal="true"><div className="dialog-heading"><div><p className="eyebrow">#{order.server_id}</p><h2>{t("createQuotation")}</h2></div><button type="button" className="icon-button" onClick={onClose}><X /></button></div><div className="quotation-lines">{lines.map((line, index) => <div className="quotation-line" key={line.orderItemId}><span><strong>{line.name}</strong><small>{line.quantity} ×</small></span><label>{t("price")}<input type="number" min="0" step="0.01" value={line.unitPrice} onChange={(event) => setLines((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, unitPrice: Number(event.target.value) } : item))} /></label><b>{money(line.quantity * line.unitPrice)}</b></div>)}</div><div className="form-grid"><label className="wide">{t("note")}<textarea value={note} onChange={(event) => setNote(event.target.value)} /></label></div><div className="quotation-total"><span>{t("total")}</span><strong>{money(total)}</strong></div>{error ? <p className="form-error">{error}</p> : null}<div className="dialog-actions"><button type="button" className="button secondary" disabled={busy} onClick={onClose}>{t("cancel")}</button><button type="button" className="button primary" disabled={busy || !lines.length} onClick={() => void submit()}>{busy ? <LoaderCircle className="spin" /> : null}{t("createQuotation")}</button></div></section></div>;
}

export function InvoicesScreen({
  onNotice,
  settings,
  canCorrect,
  canRefund,
  onGoToPos,
}: {
  onNotice: (message: string) => void;
  settings: Record<string, string>;
  canCorrect: boolean;
  canRefund: boolean;
  onGoToPos: () => void;
}) {
  const { t, language } = useI18n();
  const [rows, setRows] = useState<any[]>([]);
  const [page, setPage] = useState(0);
  const pageSize = 25;
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [source, setSource] = useState<"ALL" | "POS" | "DELIVERY">("ALL");
  const [query, setQuery] = useState("");
  const [previewSale, setPreviewSale] = useState<any | null>(null);
  const [previewHtml, setPreviewHtml] = useState("");
  const [previewRevision, setPreviewRevision] = useState(0);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [printing, setPrinting] = useState(false);
  const [lookingUp, setLookingUp] = useState(false);
  const [correcting, setCorrecting] = useState<any | null>(null);
  const [refunding, setRefunding] = useState<any | null>(null);
  const load = async () => {
    setLoading(true);
    setError("");
    try {
      setRows((await window.pos.listInvoices()) as any[]);
    } catch (value) {
      setError(localizeError(language, value));
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => {
    void load();
  }, []);
  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return rows.filter((row) =>
      (source === "ALL" || row.source === source) &&
      (!needle || [row.number, row.customer_name, row.status].some((value) => String(value ?? "").toLowerCase().includes(needle))),
    );
  }, [rows, source, query]);
  useEffect(() => setPage(0), [source, query]);
  const currentRows = filtered.slice(page * pageSize, (page + 1) * pageSize);
  async function openReceipt(row: any) {
    setPreviewSale(row);
    setPreviewHtml("");
    setPreviewLoading(true);
    try {
      setPreviewHtml(await window.pos.previewInvoice({ source: row.source, id: String(row.id), settings }));
      setPreviewRevision((revision) => revision + 1);
    } catch (value) {
      onNotice(localizeError(language, value));
      setPreviewSale(null);
    } finally {
      setPreviewLoading(false);
    }
  }
  async function lookupInvoice() {
    if (!query.trim() || lookingUp) return;
    setLookingUp(true);
    try {
      const row = await window.pos.lookupInvoice({ reference: query.trim() }) as any;
      setSource(row.source);
      await openReceipt(row);
    } catch (value) {
      onNotice(localizeError(language, value));
    } finally {
      setLookingUp(false);
    }
  }
  async function corrected(sale: any) {
    const row = {
      ...previewSale,
      id: sale.id,
      number: sale.sale_number,
      customer_name: sale.customer_name,
      note: sale.note,
      revision: sale.revision,
      corrected_at: sale.corrected_at,
    };
    setCorrecting(null);
    await load();
    await openReceipt(row);
    onNotice(t("invoiceDetailsUpdated"));
  }
  return (
    <div className="page-stack">
      <PageHeader
        eyebrow={t("history")}
        title={t("invoices")}
        description={t("invoicesText")}
      />
      <div className="history-toolbar">
        <div className="search invoice-search"><Search /><input data-keyboard-search value={query} onChange={(event) => setQuery(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); void lookupInvoice(); } }} placeholder={t("searchInvoices")} /><button type="button" className="search-scan" disabled={lookingUp || !query.trim()} title={t("findScannedInvoice")} onClick={() => void lookupInvoice()}>{lookingUp ? <LoaderCircle className="spin" /> : <ScanLine />}</button></div>
        <div className="segmented">
          {(["ALL", "POS", "DELIVERY"] as const).map((value) => <button key={value} type="button" className={source === value ? "active" : ""} onClick={() => setSource(value)}>{value === "ALL" ? t("allInvoices") : value === "POS" ? t("posInvoices") : t("deliveryInvoices")}</button>)}
        </div>
      </div>
      <div className="panel data-panel">
        {loading ? (
          <LoadingState label={t("loadingData")} />
        ) : error ? (
          <ErrorState
            title={t("unableToLoad")}
            text={error || t("tryAgainText")}
            retryLabel={t("retry")}
            onRetry={() => void load()}
          />
        ) : filtered.length ? (
          <div className="table">
            <div className="table-row invoice-row table-head">
              <span>{t("invoice")}</span>
              <span>{t("source")}</span>
              <span>{t("date")}</span>
              <span>{t("customer")}</span>
              <span>{t("status")}</span>
              <span>{t("total")}</span>
              <span />
            </div>
            {currentRows.map((row) => (
              <div className="table-row invoice-row" key={`${row.source}-${row.id}`}>
                <span>
                  <strong>{row.number}</strong>
                  <small>{row.operator_name || ""}</small>
                </span>
                <span><em className={`invoice-source invoice-source--${String(row.source).toLowerCase()}`}>{row.source === "POS" ? t("posInvoice") : t("deliveryInvoice")}</em></span>
                <span>
                  {new Date(row.created_at).toLocaleString(localeFor(language))}
                </span>
                <span>{row.customer_name || "-"}</span>
                <span><em className="badge">{localizeValue(language, row.status)}</em></span>
                <span>{money(row.total)}</span>
                <span className="row-action">
                  <button
                    className="icon-button"
                    title={t("previewReceipt")}
                    onClick={() => void openReceipt(row)}
                  >
                    <Eye />
                  </button>
                </span>
              </div>
            ))}
            <Pagination page={page} pageSize={pageSize} total={filtered.length} onPageChange={setPage} />
          </div>
        ) : (
          <EmptyState
            icon={ReceiptText}
            title={t("noInvoices")}
            text={t("noInvoicesText")}
          />
        )}
      </div>
      {previewSale ? (
        <div className="modal-backdrop" onMouseDown={(event) => event.target === event.currentTarget && !printing && setPreviewSale(null)}>
          <section className="modal-card receipt-preview-dialog" role="dialog" aria-modal="true">
            <div className="receipt-preview-heading"><div><p className="eyebrow">{previewSale.source === "POS" ? t("posInvoice") : t("deliveryInvoice")}</p><h2>{previewSale.number}</h2>{Number(previewSale.revision ?? 1) > 1 ? <small>{t("revision")} {previewSale.revision}</small> : null}</div><button type="button" className="icon-button" aria-label={t("close")} onClick={() => setPreviewSale(null)}><X /></button></div>
            <div className="receipt-preview-canvas">{previewLoading ? <LoadingState label={t("updatingPreview")} compact /> : <iframe key={`${previewSale.source}-${previewSale.id}-${previewRevision}`} title={t("previewReceipt")} srcDoc={previewHtml} sandbox="" />}</div>
            <div className="dialog-actions">{canRefund && previewSale.source === "POS" && !["REFUNDED", "VOIDED"].includes(previewSale.status) ? <button type="button" className="button secondary danger" disabled={printing || previewLoading} onClick={() => setRefunding(previewSale)}><RotateCcw />{t("refundSale")}</button> : null}{canCorrect && previewSale.source === "POS" ? <button type="button" className="button secondary" disabled={printing || previewLoading} onClick={() => setCorrecting(previewSale)}><Pencil />{t("editInvoiceDetails")}</button> : null}<button type="button" className="button secondary" disabled={printing} onClick={() => setPreviewSale(null)}>{t("close")}</button><button type="button" className="button primary" disabled={printing || previewLoading} onClick={async () => { setPrinting(true); try { await window.pos.printInvoice({ source: previewSale.source, id: String(previewSale.id), printerName: settings.printerName || undefined }); onNotice(t("documentSentToPrinter")); } catch (value) { onNotice(localizeError(language, value)); } finally { setPrinting(false); } }}>{printing ? <LoaderCircle className="spin" /> : <Printer />}{printing ? t("printing") : t("print")}</button></div>
          </section>
        </div>
      ) : null}
      {correcting ? <InvoiceCorrectionDialog invoice={correcting} onClose={() => setCorrecting(null)} onSaved={(sale) => void corrected(sale)} /> : null}
      {refunding ? <RefundSaleDialog invoice={refunding} onClose={() => setRefunding(null)} onGoToPos={() => { setRefunding(null); setPreviewSale(null); onGoToPos(); }} onRefunded={async () => { setRefunding(null); setPreviewSale(null); await load(); onNotice(t("saleRefunded")); }} /> : null}
    </div>
  );
}

function RefundSaleDialog({ invoice, onClose, onGoToPos, onRefunded }: { invoice: any; onClose: () => void; onGoToPos: () => void; onRefunded: () => void }) {
  const { t, language } = useI18n();
  const [details, setDetails] = useState<any | null>(null);
  const [quantities, setQuantities] = useState<Record<string, number>>({});
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    window.pos.getSaleDetails(invoice.id).then((result) => {
      const saleDetails = result as { items?: any[] };
      setDetails(saleDetails);
      setQuantities(Object.fromEntries((saleDetails.items ?? []).map((item: any) => {
        const remaining = Math.max(0, Number(item.quantity) - Number(item.returned_quantity ?? 0));
        return [item.id, remaining > 0 ? 1 : 0];
      })));
    }).catch((value) => setError(localizeError(language, value)));
  }, [invoice.id, language]);
  const selected = (details?.items ?? []).filter((item: any) => Number(quantities[item.id] ?? 0) > 0);
  const amount = selected.reduce((sum: number, item: any) => sum + Number(item.total) * (Number(quantities[item.id]) / Number(item.quantity)), 0);
  async function submit(event: React.FormEvent) {
    event.preventDefault(); setBusy(true); setError("");
    try {
      await window.pos.refundSale({ saleId: invoice.id, reason: reason.trim(), lines: selected.map((item: any) => ({ saleItemId: item.id, quantity: Number(quantities[item.id]) })) });
      onRefunded();
    } catch (value) { setError(localizeError(language, value)); } finally { setBusy(false); }
  }
  return <div className="modal-backdrop elevated-modal" onMouseDown={(event) => event.target === event.currentTarget && !busy && onClose()}><form className="modal-card refund-dialog" onSubmit={submit}><div className="dialog-heading"><div><p className="eyebrow">{invoice.number}</p><h2>{t("refundSale")}</h2><p>{t("refundSaleHelp")}</p></div><button type="button" className="icon-button" disabled={busy} onClick={onClose}><X /></button></div>{details ? <div className="refund-lines">{details.items.map((item: any) => { const remaining = Math.max(0, Number(item.quantity) - Number(item.returned_quantity ?? 0)); const quantity = Number(quantities[item.id] ?? 0); return <div className="refund-line" key={item.id}><span><strong>{item.product_name}</strong><small>{remaining} {t("returnable")}</small></span><div className="quantity-stepper" aria-label={`${item.product_name} ${t("quantity")}`}><button type="button" aria-label={t("decreaseQuantity")} disabled={busy || quantity <= 0} onClick={() => setQuantities((current) => ({ ...current, [item.id]: Math.max(0, quantity - 1) }))}><Minus /></button><input aria-label={t("quantity")} type="number" min="0" max={remaining} step="1" value={quantity} onChange={(event) => { const next = Number(event.target.value); setQuantities((current) => ({ ...current, [item.id]: Number.isFinite(next) ? Math.max(0, Math.min(remaining, next)) : 0 })); }} /><button type="button" aria-label={t("increaseQuantity")} disabled={busy || quantity >= remaining} onClick={() => setQuantities((current) => ({ ...current, [item.id]: Math.min(remaining, quantity + 1) }))}><Plus /></button></div></div>; })}</div> : !error ? <LoadingState label={t("loadingData")} compact /> : null}<TextAreaField label={t("refundReason")} hint={t("refundReasonHint")} maxLength={500} value={reason} onChange={(event) => setReason(event.target.value)} /><div className="quotation-total"><span>{t("cashRefund")}</span><strong>{money(amount)}</strong></div>{error ? <p className="form-error">{error}</p> : null}<div className="dialog-actions"><button type="button" className="button ghost" disabled={busy} onClick={onGoToPos}>{t("returnToPos")}</button><button type="button" className="button secondary" disabled={busy} onClick={onClose}>{t("cancel")}</button><button type="submit" className="button primary danger" disabled={busy || !selected.length}>{busy ? <LoaderCircle className="spin" /> : <RotateCcw />}{t("confirmRefund")}</button></div></form></div>;
}

function InvoiceCorrectionDialog({ invoice, onClose, onSaved }: { invoice: any; onClose: () => void; onSaved: (sale: any) => void }) {
  const { t, language } = useI18n();
  const [customerName, setCustomerName] = useState(invoice.customer_name ?? "");
  const [note, setNote] = useState(invoice.note ?? "");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      const sale = await window.pos.correctInvoiceDetails({ id: invoice.id, customerName, note, reason });
      onSaved(sale);
    } catch (value) {
      setError(localizeError(language, value));
    } finally {
      setBusy(false);
    }
  }
  return <div className="modal-backdrop elevated-modal" onMouseDown={(event) => event.target === event.currentTarget && !busy && onClose()}><form className="modal-card invoice-correction-dialog" onSubmit={submit}><div className="dialog-heading"><div><p className="eyebrow">{invoice.number}</p><h2>{t("editInvoiceDetails")}</h2><p>{t("editInvoiceDetailsHelp")}</p></div><button type="button" className="icon-button" disabled={busy} onClick={onClose}><X /></button></div><div className="form-grid"><label>{t("customerName")}<input value={customerName} maxLength={120} onChange={(event) => setCustomerName(event.target.value)} /></label><TextAreaField wrapperClassName="wide" label={t("note")} maxLength={1000} value={note} onChange={(event) => setNote(event.target.value)} /><TextAreaField wrapperClassName="wide" label={t("correctionReason")} required minLength={3} maxLength={500} value={reason} onChange={(event) => setReason(event.target.value)} placeholder={t("correctionReasonPlaceholder")} /></div>{error ? <p className="form-error">{error}</p> : null}<div className="dialog-actions"><button type="button" className="button secondary" disabled={busy} onClick={onClose}>{t("cancel")}</button><button type="submit" className="button primary" disabled={busy || reason.trim().length < 3}>{busy ? <LoaderCircle className="spin" /> : null}{t("saveCorrection")}</button></div></form></div>;
}
