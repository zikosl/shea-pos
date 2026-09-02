import { useEffect, useState } from "react";
import { Eye, FileClock, LoaderCircle, Printer, ReceiptText, X } from "lucide-react";
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

export function SalesScreen({
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
  const [previewSale, setPreviewSale] = useState<any | null>(null);
  const [previewHtml, setPreviewHtml] = useState("");
  const [previewLoading, setPreviewLoading] = useState(false);
  const [printing, setPrinting] = useState(false);
  const load = async () => {
    setLoading(true);
    setError("");
    try {
      setRows((await window.pos.listSales()) as any[]);
    } catch (value) {
      setError(localizeError(language, value));
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => {
    void load();
  }, []);
  async function openReceipt(row: any) {
    setPreviewSale(row);
    setPreviewHtml("");
    setPreviewLoading(true);
    try {
      setPreviewHtml(await window.pos.previewReceipt({ saleId: row.id }));
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
        eyebrow={t("register")}
        title={t("localSales")}
        description={t("localSalesText")}
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
            <div className="table-row five table-head">
              <span>{t("receipt")}</span>
              <span>{t("date")}</span>
              <span>{t("payment")}</span>
              <span>{t("syncState")}</span>
              <span>{t("total")}</span>
            </div>
            {rows.map((row) => (
              <div className="table-row five" key={row.id}>
                <span>
                  <strong>{row.sale_number}</strong>
                </span>
                <span>
                  {new Date(row.created_at).toLocaleString(localeFor(language))}
                </span>
                <span>{localizeValue(language, row.payment_method)}</span>
                <span>
                  <em
                    className={
                      row.sync_state === "SYNCED" ? "badge" : "badge warning"
                    }
                  >
                    {localizeValue(language, row.sync_state)}
                  </em>
                </span>
                <span className="row-action">
                  {money(row.total)}
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
            title={t("noSales")}
            text={t("noSalesText")}
          />
        )}
      </div>
      {previewSale ? (
        <div className="modal-backdrop" onMouseDown={(event) => event.target === event.currentTarget && !printing && setPreviewSale(null)}>
          <section className="modal-card receipt-preview-dialog" role="dialog" aria-modal="true">
            <div className="receipt-preview-heading"><div><p className="eyebrow">{t("receipt")}</p><h2>{previewSale.sale_number}</h2></div><button type="button" className="icon-button" aria-label={t("close")} onClick={() => setPreviewSale(null)}><X /></button></div>
            <div className="receipt-preview-canvas">{previewLoading ? <LoadingState label={t("updatingPreview")} compact /> : <iframe title={t("previewReceipt")} srcDoc={previewHtml} sandbox="" />}</div>
            <div className="dialog-actions"><button type="button" className="button secondary" disabled={printing} onClick={() => setPreviewSale(null)}>{t("close")}</button><button type="button" className="button primary" disabled={printing || previewLoading} onClick={async () => { setPrinting(true); try { await window.pos.printReceipt({ saleId: previewSale.id, printerName: settings.printerName || undefined }); onNotice(t("testReceiptSent")); } catch (value) { onNotice(localizeError(language, value)); } finally { setPrinting(false); } }}>{printing ? <LoaderCircle className="spin" /> : <Printer />}{printing ? t("printing") : t("printReceipt")}</button></div>
          </section>
        </div>
      ) : null}
    </div>
  );
}
