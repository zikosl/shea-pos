import { useEffect, useMemo, useState } from "react";
import { Eye, FileClock, LoaderCircle, Printer, ReceiptText, Search, X } from "lucide-react";
import { EmptyState } from "../../components/EmptyState";
import { ErrorState, LoadingState } from "../../components/AsyncState";
import { PageHeader } from "../../components/PageHeader";
import { money } from "../../shared/format";
import { localeFor, localizeError, localizeValue, useI18n } from "../../i18n";

export function OrdersScreen() {
  const { t, language } = useI18n();
  const [rows, setRows] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const load = async () => {
    setLoading(true);
    setError("");
    try {
      setRows((await window.pos.listOrders()) as any[]);
    } catch (value) {
      setError(localizeError(language, value));
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => {
    void load();
  }, []);
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
            {rows.map((row) => (
              <div className="table-row" key={row.server_id}>
                <span>
                  <strong>#{row.server_id}</strong>
                </span>
                <span>{row.customer_name || t("customer")}</span>
                <span>
                  <em className="badge">
                    {localizeValue(language, row.status)}
                  </em>
                </span>
                <span>{money(row.total)}</span>
              </div>
            ))}
          </div>
        ) : (
          <EmptyState
            icon={FileClock}
            title={t("noOrders")}
            text={t("noOrdersText")}
          />
        )}
      </div>
    </div>
  );
}

export function InvoicesScreen({
  onNotice,
  settings,
}: {
  onNotice: (message: string) => void;
  settings: Record<string, string>;
}) {
  const { t, language } = useI18n();
  const [rows, setRows] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [source, setSource] = useState<"ALL" | "POS" | "DELIVERY">("ALL");
  const [query, setQuery] = useState("");
  const [previewSale, setPreviewSale] = useState<any | null>(null);
  const [previewHtml, setPreviewHtml] = useState("");
  const [previewLoading, setPreviewLoading] = useState(false);
  const [printing, setPrinting] = useState(false);
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
  async function openReceipt(row: any) {
    setPreviewSale(row);
    setPreviewHtml("");
    setPreviewLoading(true);
    try {
      setPreviewHtml(await window.pos.previewInvoice({ source: row.source, id: String(row.id) }));
    } catch (value) {
      onNotice(localizeError(language, value));
      setPreviewSale(null);
    } finally {
      setPreviewLoading(false);
    }
  }
  return (
    <div className="page-stack">
      <PageHeader
        eyebrow={t("history")}
        title={t("invoices")}
        description={t("invoicesText")}
      />
      <div className="history-toolbar">
        <div className="search"><Search /><input data-keyboard-search value={query} onChange={(event) => setQuery(event.target.value)} placeholder={t("searchInvoices")} /></div>
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
            {filtered.map((row) => (
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
            <div className="receipt-preview-heading"><div><p className="eyebrow">{previewSale.source === "POS" ? t("posInvoice") : t("deliveryInvoice")}</p><h2>{previewSale.number}</h2></div><button type="button" className="icon-button" aria-label={t("close")} onClick={() => setPreviewSale(null)}><X /></button></div>
            <div className="receipt-preview-canvas">{previewLoading ? <LoadingState label={t("updatingPreview")} compact /> : <iframe title={t("previewReceipt")} srcDoc={previewHtml} sandbox="" />}</div>
            <div className="dialog-actions"><button type="button" className="button secondary" disabled={printing} onClick={() => setPreviewSale(null)}>{t("close")}</button><button type="button" className="button primary" disabled={printing || previewLoading} onClick={async () => { setPrinting(true); try { await window.pos.printInvoice({ source: previewSale.source, id: String(previewSale.id), printerName: settings.printerName || undefined }); onNotice(t("documentSentToPrinter")); } catch (value) { onNotice(localizeError(language, value)); } finally { setPrinting(false); } }}>{printing ? <LoaderCircle className="spin" /> : <Printer />}{printing ? t("printing") : t("print")}</button></div>
          </section>
        </div>
      ) : null}
    </div>
  );
}
