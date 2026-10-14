import { useEffect, useState } from "react";
import { Eye, ReceiptText, X } from "lucide-react";
import { ErrorState, LoadingState } from "../../components/AsyncState";
import { EmptyState } from "../../components/EmptyState";
import { money } from "../../shared/format";
import { localeFor, localizeError, localizeValue, useI18n } from "../../i18n";

type Activity = {
  sales: Array<{ operator_id: string | null; operator_name: string | null; sale_count: number; sales_total: number }>;
  refunds: Array<{ operator_id: string | null; operator_name: string | null; refund_count: number; refunds_total: number }>;
  orders: Array<{ operator_id: string; operator_name: string; action_count: number; created_count: number }>;
  entries: Array<{ id: string; reference: string; action: "SALE" | "REFUND"; amount: number; operator_id: string | null; operator_name: string | null; created_at: string }>;
  orderEntries: Array<{ id: string; order_type: "ONLINE" | "GIFT"; reference: string; action: string; to_status: string | null; operator_name: string; created_at: string; sync_state: string }>;
};

function dateInputValue(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

export function WorkerActivity({ users, canViewInvoices }: { users: Array<{ id: string; name: string }>; canViewInvoices: boolean }) {
  const { t, language } = useI18n();
  const [worker, setWorker] = useState("");
  const [from, setFrom] = useState(() => { const date = new Date(); date.setDate(date.getDate() - 29); return dateInputValue(date); });
  const [to, setTo] = useState(() => dateInputValue(new Date()));
  const [activity, setActivity] = useState<Activity | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [preview, setPreview] = useState<{ number: string; html: string } | null>(null);
  const [reload, setReload] = useState(0);

  useEffect(() => {
    if (from && to && from > to) { setActivity(null); setLoading(false); return; }
    let active = true;
    setLoading(true); setError("");
    void window.pos.workerActivity({
      operatorId: worker || undefined,
      from: from ? new Date(`${from}T00:00:00`).toISOString() : undefined,
      to: to ? new Date(`${to}T23:59:59.999`).toISOString() : undefined,
    }).then((result) => { if (active) setActivity(result as Activity); })
      .catch((value) => { if (active) setError(localizeError(language, value)); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [worker, from, to, language, reload]);

  async function openInvoice(reference: string) {
    try {
      const row = await window.pos.lookupInvoice({ reference }) as { id: string; source: "POS" | "DELIVERY"; number: string };
      const settings = await window.pos.getSettings();
      const html = await window.pos.previewInvoice({ source: row.source, id: String(row.id), settings });
      setPreview({ number: row.number, html });
    } catch (value) { setError(localizeError(language, value)); }
  }

  const saleCount = activity?.sales.reduce((sum, row) => sum + row.sale_count, 0) ?? 0;
  const salesTotal = activity?.sales.reduce((sum, row) => sum + row.sales_total, 0) ?? 0;
  const refundCount = activity?.refunds.reduce((sum, row) => sum + row.refund_count, 0) ?? 0;
  const refundsTotal = activity?.refunds.reduce((sum, row) => sum + row.refunds_total, 0) ?? 0;
  const orderActions = activity?.orders.reduce((sum, row) => sum + row.action_count, 0) ?? 0;
  return <div className="worker-activity">
    <p className="worker-activity-note">{t("localWorkerActivity")}</p>
    <div className="worker-activity-filters panel">
      <label>{t("worker")}<select value={worker} onChange={(event) => setWorker(event.target.value)}><option value="">{t("allWorkers")}</option>{users.map((user) => <option key={user.id} value={user.id}>{user.name}</option>)}</select></label>
      <label>{t("from")}<input type="date" value={from} max={to || undefined} onChange={(event) => setFrom(event.target.value)} /></label>
      <label>{t("to")}<input type="date" value={to} min={from || undefined} onChange={(event) => setTo(event.target.value)} /></label>
    </div>
    {loading ? <LoadingState label={t("loadingData")} /> : error ? <ErrorState title={t("unableToLoad")} text={error} retryLabel={t("retry")} onRetry={() => setReload((value) => value + 1)} /> : activity ? <>
      <div className="worker-activity-summary">
        <span><small>{t("completedSales")}</small><strong>{saleCount}</strong><b>{money(salesTotal)}</b></span>
        <span><small>{t("refunds")}</small><strong>{refundCount}</strong><b>{money(refundsTotal)}</b></span>
        <span><small>{t("netSales")}</small><strong>{money(salesTotal - refundsTotal)}</strong></span>
        <span><small>{t("orderActions")}</small><strong>{orderActions}</strong></span>
      </div>
      {activity.entries.length ? <div className="panel worker-activity-list"><h3>{t("salesAndRefunds")}</h3>{activity.entries.map((entry) => <div className="worker-activity-row" key={`${entry.action}-${entry.id}`}>
        <div><strong>{entry.reference}</strong><small>{entry.operator_name || t("unknownWorker")} · {new Date(entry.created_at).toLocaleString(localeFor(language))}</small></div>
        <em className="badge">{entry.action === "SALE" ? t("sale") : t("refund")}</em>
        <b>{entry.action === "REFUND" ? "−" : ""}{money(entry.amount)}</b>
        {canViewInvoices ? <button className="icon-button" aria-label={t("previewReceipt")} onClick={() => void openInvoice(entry.reference)}><Eye /></button> : null}
      </div>)}</div> : !activity.orderEntries.length ? <EmptyState icon={ReceiptText} title={t("noWorkerActivity")} text={t("noWorkerActivityText")} /> : null}
      {activity.entries.length === 500 ? <small className="worker-activity-limit">{t("activityLimit")}</small> : null}
      {activity.orderEntries.length ? <section className="panel worker-activity-orders"><h3>{t("orderActions")}</h3>{activity.orderEntries.map((entry) => <div className="worker-activity-row" key={entry.id}>
        <div><strong>{entry.reference} · {entry.to_status ? localizeValue(language, entry.to_status) : localizeValue(language, entry.action)}</strong><small>{entry.operator_name} · {new Date(entry.created_at).toLocaleString(localeFor(language))}</small></div>
        <em className="badge">{entry.order_type === "GIFT" ? t("customOrders") : t("orders")}</em>
        <small>{localizeValue(language, entry.sync_state)}</small>
      </div>)}</section> : null}
    </> : null}
    {preview ? <div className="modal-backdrop" onMouseDown={(event) => event.target === event.currentTarget && setPreview(null)}><section className="modal-card receipt-preview-dialog" role="dialog" aria-modal="true"><div className="receipt-preview-heading"><h2>{preview.number}</h2><button className="icon-button" aria-label={t("close")} onClick={() => setPreview(null)}><X /></button></div><div className="receipt-preview-canvas"><iframe title={t("previewReceipt")} srcDoc={preview.html} sandbox="" /></div></section></div> : null}
  </div>;
}
