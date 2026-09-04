import { useEffect, useMemo, useState } from "react";
import { CalendarDays, ChevronRight, Clock3, Gift, LayoutList, LoaderCircle, Plus, Search, X } from "lucide-react";
import { ErrorState, LoadingState } from "../../components/AsyncState";
import { EmptyState } from "../../components/EmptyState";
import { DateTimePicker } from "../../components/DateTimePicker";
import { PageHeader } from "../../components/PageHeader";
import { localeFor, localizeError, localizeValue, useI18n } from "../../i18n";
import { money } from "../../shared/format";
import type { CapabilityCode } from "../../../electron/contracts";

type ViewMode = "AGENDA" | "WEEK" | "MONTH";
type Order = { id: string; order_number: string; customer_name: string; status: string; required_at?: string; fulfillment_mode: string; total: number; sync_state: string; payload_json: string; niche_id?: number | null };
type CatalogProduct = { local_id: string; name: string; variant_name?: string | null; price: number; stock: number; available: number | boolean; image?: string | null };
type GiftLine = { id: string; productLocalId?: string; name: string; description?: string; quantity: number; unitPrice: number };
type Niche = { id: number; name: string; name_ar?: string };
const nextStatus: Record<string, string | undefined> = { QUOTED: "AWAITING_CUSTOMER_APPROVAL", AWAITING_CUSTOMER_APPROVAL: "CONFIRMED", MATERIALS_RESERVED: "IN_PREPARATION", IN_PREPARATION: "READY", READY: "FULFILLED" };
const dayStart = (date: Date) => { const value = new Date(date); value.setHours(0, 0, 0, 0); return value; };
const addDays = (date: Date, days: number) => { const value = new Date(date); value.setDate(value.getDate() + days); return value; };
const dateKey = (value?: string) => value ? new Date(value).toISOString().slice(0, 10) : "unscheduled";
const orderNicheId = (order: Order) => {
  if (order.niche_id) return Number(order.niche_id);
  try { return Number(JSON.parse(order.payload_json).nicheId) || undefined; } catch { return undefined; }
};

export function GiftStoreScreen({ capabilities, canManage, syncVersion }: { capabilities: CapabilityCode[]; canManage: boolean; syncVersion?: string | null }) {
  const { t, language } = useI18n();
  const [rows, setRows] = useState<Order[]>([]), [query, setQuery] = useState(""), [loading, setLoading] = useState(true), [error, setError] = useState("");
  const [view, setView] = useState<ViewMode>("MONTH"), [cursor, setCursor] = useState(dayStart(new Date()));
  const [niches, setNiches] = useState<Niche[]>([]), [nicheFilter, setNicheFilter] = useState("");
  const [creating, setCreating] = useState(false), [selected, setSelected] = useState<Order | null>(null), [busy, setBusy] = useState(false);
  const load = async () => { setLoading(true); setError(""); try { setRows((await window.pos.listGiftOrders()) as Order[]); } catch (value) { setError(localizeError(language, value)); } finally { setLoading(false); } };
  useEffect(() => { void load(); }, [syncVersion]);
  useEffect(() => {
    if (!selected) return;
    const refreshed = rows.find((row) => row.id === selected.id);
    if (refreshed) setSelected(refreshed);
  }, [rows, selected?.id]);
  useEffect(() => {
    window.pos.listCatalog().then((value: any) => setNiches(value.niches ?? [])).catch(() => setNiches([]));
  }, []);
  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return rows.filter((row) => (!nicheFilter || String(orderNicheId(row) ?? "") === nicheFilter)
      && (!needle || [row.order_number, row.customer_name, row.status].some((value) => String(value ?? "").toLowerCase().includes(needle))));
  }, [nicheFilter, query, rows]);
  const planned = filtered.filter((row) => Boolean(row.required_at)).length;
  const unscheduled = filtered.length - planned;
  async function transition(order: Order, status: string) { setBusy(true); try { await window.pos.transitionCustomOrder({ id: order.id, status }); setSelected(null); await load(); } catch (value) { setError(localizeError(language, value)); } finally { setBusy(false); } }
  async function command(order: Order, type: "QUOTE" | "RESERVE") { setBusy(true); try { if (type === "QUOTE") await window.pos.createCustomOrderQuotation({ id: order.id }); else await window.pos.reserveCustomOrderMaterials({ id: order.id }); setSelected(null); await load(); } catch (value) { setError(localizeError(language, value)); } finally { setBusy(false); } }
  return <div className="page-stack gift-workspace">
    <PageHeader eyebrow={t("giftStore")} title={t("customOrders")} description={t("customOrdersText")} actions={canManage && capabilities.includes("GIFT_BUILDER") ? <button className="button primary" onClick={() => setCreating(true)}><Plus />{t("newCustomOrder")}</button> : null} />
    <section className="planner-controls panel">
      <div className="planner-toolbar"><div className="search"><Search /><input data-keyboard-search value={query} onChange={(event) => setQuery(event.target.value)} placeholder={t("searchCustomOrders")} /></div><select className="planner-niche-filter" aria-label={t("niche")} value={nicheFilter} onChange={(event) => setNicheFilter(event.target.value)}><option value="">{t("allNiches")}</option>{niches.map((niche) => <option key={niche.id} value={niche.id}>{language === "ar" && niche.name_ar ? niche.name_ar : niche.name}</option>)}</select><div className="segmented">{(["AGENDA", "WEEK", "MONTH"] as const).map((mode) => <button key={mode} className={view === mode ? "active" : ""} onClick={() => setView(mode)}>{mode === "AGENDA" ? <LayoutList /> : <CalendarDays />}{t(mode === "AGENDA" ? "agenda" : mode === "WEEK" ? "weekView" : "monthView")}</button>)}</div></div>
      <div className="planner-summary"><span><b>{planned}</b>{t("plannedOrders")}</span><span><b>{unscheduled}</b>{t("unscheduledOrders")}</span><span><b>{filtered.length}</b>{t("totalOrders")}</span></div>
    </section>
    {loading ? <div className="panel"><LoadingState label={t("loadingData")} /></div> : error ? <div className="panel"><ErrorState title={t("unableToLoad")} text={error} retryLabel={t("retry")} onRetry={() => void load()} /></div> : !filtered.length ? <div className="panel"><EmptyState icon={Gift} title={t("noCustomOrders")} text={t("noCustomOrdersText")} /></div> : <Planner rows={filtered} view={view} cursor={cursor} setCursor={setCursor} onSelect={setSelected} />}
    {creating ? <OrderWizard onClose={() => setCreating(false)} onCreated={async () => { setCreating(false); await load(); }} /> : null}
    {selected ? <OrderDrawer order={selected} busy={busy} capabilities={capabilities} canManage={canManage} onClose={() => setSelected(null)} onTransition={(status) => void transition(selected, status)} onCommand={(type) => void command(selected, type)} /> : null}
  </div>;
}

function OrderCard({ order, onClick }: { order: Order; onClick: () => void }) {
  const { language } = useI18n(); const overdue = order.required_at && new Date(order.required_at).getTime() < Date.now() && !["READY", "FULFILLED", "CANCELLED"].includes(order.status);
  return <button className={`planned-order ${overdue ? "overdue" : ""}`} onClick={onClick}><span className="order-time"><Clock3 />{order.required_at ? new Date(order.required_at).toLocaleTimeString(localeFor(language), { hour: "2-digit", minute: "2-digit" }) : "--:--"}</span><span><strong>{order.customer_name}</strong><small>{order.order_number}</small></span><em className="badge">{localizeValue(language, order.status)}</em><b>{money(order.total)}</b><ChevronRight /></button>;
}

function Planner({ rows, view, cursor, setCursor, onSelect }: { rows: Order[]; view: ViewMode; cursor: Date; setCursor: (date: Date) => void; onSelect: (order: Order) => void }) {
  const { language, t } = useI18n();
  if (view === "AGENDA") { const groups = rows.reduce((result, row) => { const key = dateKey(row.required_at); const group = result.get(key) ?? []; group.push(row); result.set(key, group); return result; }, new Map<string, Order[]>()); return <div className="agenda">{[...groups.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([day, orders]) => <section className="agenda-day" key={day}><div className="agenda-date"><strong>{day === "unscheduled" ? "—" : new Date(`${day}T12:00:00`).toLocaleDateString(localeFor(language), { weekday: "short", day: "numeric" })}</strong><span>{day === "unscheduled" ? t("unscheduledOrders") : new Date(`${day}T12:00:00`).toLocaleDateString(localeFor(language), { month: "long", year: "numeric" })}</span></div><div className="agenda-orders">{orders.map((order) => <OrderCard key={order.id} order={order} onClick={() => onSelect(order)} />)}</div></section>)}</div>; }
  const month = view === "MONTH", first = month ? new Date(cursor.getFullYear(), cursor.getMonth(), 1) : addDays(cursor, -((cursor.getDay() + 6) % 7)), start = addDays(first, -((first.getDay() + 6) % 7)), count = month ? 42 : 7;
  return <div className="calendar-panel panel"><div className="calendar-nav"><button className="icon-button" aria-label={t("previous")} onClick={() => setCursor(addDays(cursor, month ? -31 : -7))}>‹</button><strong>{cursor.toLocaleDateString(localeFor(language), { month: "long", year: "numeric" })}</strong><button className="button secondary calendar-today" onClick={() => setCursor(dayStart(new Date()))}>{t("today")}</button><button className="icon-button" aria-label={t("next")} onClick={() => setCursor(addDays(cursor, month ? 31 : 7))}>›</button></div><div className={month ? "month-grid" : "week-grid"}>{Array.from({ length: count }, (_, index) => { const day = addDays(start, index), key = dateKey(day.toISOString()), orders = rows.filter((row) => dateKey(row.required_at) === key); return <section className={month && day.getMonth() !== cursor.getMonth() ? "muted" : ""} key={key}><header><span>{day.toLocaleDateString(localeFor(language), { weekday: "short" })}</span><strong>{day.getDate()}</strong></header><div>{orders.slice(0, month ? 3 : 20).map((order) => <button key={order.id} onClick={() => onSelect(order)}><strong>{order.customer_name}</strong><small>{order.required_at ? new Date(order.required_at).toLocaleTimeString(localeFor(language), { hour: "2-digit", minute: "2-digit" }) : ""}</small></button>)}{month && orders.length > 3 ? <small>+{orders.length - 3}</small> : null}</div></section>; })}</div></div>;
}

function OrderWizard({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const { t, language } = useI18n();
  const [step, setStep] = useState(1);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [catalog, setCatalog] = useState<CatalogProduct[]>([]);
  const [niches, setNiches] = useState<Niche[]>([]);
  const [nicheId, setNicheId] = useState("");
  const [catalogQuery, setCatalogQuery] = useState("");
  const [lines, setLines] = useState<GiftLine[]>([]);
  const [customLine, setCustomLine] = useState({ name: "", quantity: "1", unitPrice: "0" });
  const [data, setData] = useState({ customerName: "", customerPhone: "", requiredAt: "", fulfillmentMode: "PICKUP", deliveryAddress: "" });
  const field = (key: keyof typeof data) => ({
    value: data[key],
    onChange: (event: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) =>
      setData((current) => ({ ...current, [key]: event.target.value })),
  });
  const valid = step === 1
    ? data.customerName.trim().length > 1 && Boolean(nicheId)
    : step === 2
      ? lines.length > 0
      : Boolean(data.requiredAt) && (data.fulfillmentMode !== "DELIVERY" || Boolean(data.deliveryAddress.trim()));

  useEffect(() => {
    const timer = window.setTimeout(() => {
      window.pos.listProducts({ search: catalogQuery, nicheId: nicheId ? Number(nicheId) : undefined, limit: 12, offset: 0 })
        .then((value) => setCatalog(value as CatalogProduct[]))
        .catch((value) => setError(localizeError(language, value)));
    }, 180);
    return () => window.clearTimeout(timer);
  }, [catalogQuery, language, nicheId]);
  useEffect(() => {
    window.pos.listCatalog().then((value: any) => setNiches(value.niches ?? [])).catch((value) => setError(localizeError(language, value)));
  }, [language]);

  function addCatalogLine(product: CatalogProduct) {
    setLines((current) => {
      const found = current.find((line) => line.productLocalId === product.local_id);
      return found
        ? current.map((line) => line.productLocalId === product.local_id ? { ...line, quantity: line.quantity + 1 } : line)
        : [...current, { id: product.local_id, productLocalId: product.local_id, name: product.variant_name ? `${product.name} - ${product.variant_name}` : product.name, quantity: 1, unitPrice: Number(product.price) }];
    });
  }

  function addCustomLine() {
    if (!customLine.name.trim() || Number(customLine.quantity) <= 0 || Number(customLine.unitPrice) < 0) return;
    setLines((current) => [...current, { id: `custom-${Date.now()}`, name: customLine.name.trim(), quantity: Number(customLine.quantity), unitPrice: Number(customLine.unitPrice) }]);
    setCustomLine({ name: "", quantity: "1", unitPrice: "0" });
  }

  async function save() {
    setBusy(true);
    setError("");
    try {
      await window.pos.createCustomOrder({
        nicheId: Number(nicheId),
        customerName: data.customerName,
        customerPhone: data.customerPhone || undefined,
        requiredAt: new Date(data.requiredAt).toISOString(),
        fulfillmentMode: data.fulfillmentMode as "PICKUP" | "DELIVERY",
        deliveryAddress: data.deliveryAddress || undefined,
        lines,
      });
      onCreated();
    } catch (value) {
      setError(localizeError(language, value));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="modal-backdrop" onMouseDown={(event) => event.target === event.currentTarget && !busy && onClose()}>
      <section className="modal-card gift-wizard" role="dialog" aria-modal="true">
        <div className="dialog-heading">
          <div><p className="eyebrow">{t("giftBuilder")}</p><h2>{t("newCustomOrder")}</h2></div>
          <button className="icon-button" type="button" onClick={onClose}><X /></button>
        </div>
        <div className="wizard-steps">{[1, 2, 3].map((value) => <span className={step >= value ? "active" : ""} key={value}>{value}</span>)}</div>
        {step === 1 ? (
          <div className="form-grid">
            <label className="wide">{t("niche")}<select value={nicheId} onChange={(event) => { setNicheId(event.target.value); setLines([]); }}><option value="">{t("chooseNiche")}</option>{niches.map((niche) => <option key={niche.id} value={niche.id}>{language === "ar" && niche.name_ar ? niche.name_ar : niche.name}</option>)}</select></label>
            <label>{t("customerName")}<input autoFocus {...field("customerName")} /></label>
            <label>{t("phone")}<input {...field("customerPhone")} /></label>
          </div>
        ) : step === 2 ? (
          <div className="gift-line-builder">
            <div className="catalog-picker">
              <div><strong>{t("addFromCatalog")}</strong><small>{t("addFromCatalogText")}</small></div>
              <div className="search"><Search /><input autoFocus value={catalogQuery} onChange={(event) => setCatalogQuery(event.target.value)} placeholder={t("searchProducts")} /></div>
              <div className="catalog-options">{catalog.map((product) => <button type="button" key={product.local_id} disabled={!product.available} onClick={() => addCatalogLine(product)}><span><strong>{product.name}</strong>{product.variant_name ? <small>{product.variant_name}</small> : null}</span><b>{money(product.price)}</b><Plus /></button>)}{!catalog.length ? <small>{t("noNicheProducts")}</small> : null}</div>
            </div>
            <div className="custom-line-form form-grid">
              <div className="wide"><strong>{t("addCustomLine")}</strong><small>{t("addCustomLineText")}</small></div>
              <label className="wide">{t("giftDescription")}<input value={customLine.name} onChange={(event) => setCustomLine((current) => ({ ...current, name: event.target.value }))} /></label>
              <label>{t("quantity")}<input type="number" min="1" value={customLine.quantity} onChange={(event) => setCustomLine((current) => ({ ...current, quantity: event.target.value }))} /></label>
              <label>{t("price")}<input type="number" min="0" step="0.01" value={customLine.unitPrice} onChange={(event) => setCustomLine((current) => ({ ...current, unitPrice: event.target.value }))} /></label>
              <button type="button" className="button secondary" onClick={addCustomLine} disabled={!customLine.name.trim()}><Plus />{t("addCustomLine")}</button>
            </div>
            <div className="gift-lines">{lines.map((line) => <div key={line.id} className="drawer-line"><span><strong>{line.name}</strong><small>{line.productLocalId ? t("catalogItem") : t("customItem")} · {line.quantity} × {money(line.unitPrice)}</small></span><button type="button" className="icon-button" onClick={() => setLines((current) => current.filter((item) => item.id !== line.id))}><X /></button></div>)}</div>
          </div>
        ) : (
          <div className="form-grid schedule-grid">
            <label className="wide">
              {t("requiredAt")}
              <DateTimePicker
                value={data.requiredAt}
                onChange={(requiredAt) => setData((current) => ({ ...current, requiredAt }))}
                min={new Date().toISOString().slice(0, 10)}
              />
            </label>
            <label>{t("fulfillment")}<select {...field("fulfillmentMode")}><option value="PICKUP">{t("pickup")}</option><option value="DELIVERY">{t("delivery")}</option></select></label>
            {data.fulfillmentMode === "DELIVERY" ? <label className="wide">{t("deliveryAddress")}<input autoFocus {...field("deliveryAddress")} /></label> : null}
          </div>
        )}
        {error ? <p className="form-error">{error}</p> : null}
        <div className="dialog-actions">
          {step > 1 ? <button type="button" className="button secondary" onClick={() => setStep(step - 1)}>{t("back")}</button> : <button type="button" className="button secondary" onClick={onClose}>{t("cancel")}</button>}
          <button type="button" className="button primary" disabled={!valid || busy} onClick={() => step < 3 ? setStep(step + 1) : void save()}>{busy ? <LoaderCircle className="spin" /> : null}{step < 3 ? t("continue") : t("createOrder")}</button>
        </div>
      </section>
    </div>
  );
}

function OrderDrawer({ order, busy, capabilities, canManage, onClose, onTransition, onCommand }: { order: Order; busy: boolean; capabilities: CapabilityCode[]; canManage: boolean; onClose: () => void; onTransition: (status: string) => void; onCommand: (type: "QUOTE" | "RESERVE") => void }) {
  const { t, language } = useI18n(); let payload: any = {}; try { payload = JSON.parse(order.payload_json); } catch { /* Retain summary. */ } const next = nextStatus[order.status];
  return <div className="drawer-backdrop" onMouseDown={(event) => event.target === event.currentTarget && onClose()}><aside className="order-drawer"><div className="dialog-heading"><div><p className="eyebrow">{order.order_number}</p><h2>{order.customer_name}</h2></div><button className="icon-button" onClick={onClose}><X /></button></div><div className="order-summary"><span><small>{t("status")}</small><em className="badge">{localizeValue(language, order.status)}</em></span><span><small>{t("requiredAt")}</small><strong>{order.required_at ? new Date(order.required_at).toLocaleString(localeFor(language)) : "-"}</strong></span><span><small>{t("fulfillment")}</small><strong>{localizeValue(language, order.fulfillment_mode)}</strong></span><span><small>{t("total")}</small><strong>{money(order.total)}</strong></span></div><section><h3>{t("giftDetails")}</h3><p>{payload.gift?.occasion || payload.occasion || "-"}</p><p>{payload.gift?.cardMessage || payload.cardMessage || ""}</p></section><section><h3>{t("items")}</h3>{(payload.lines ?? []).map((line: any, index: number) => <div className="drawer-line" key={line.id ?? index}><span>{line.name}<small>{line.quantity} × {money(line.unitPrice)}</small></span><strong>{money(line.total ?? line.quantity * line.unitPrice)}</strong></div>)}</section>{canManage ? <div className="drawer-actions">{order.status === "REQUESTED" && capabilities.includes("QUOTATIONS") ? <button className="button primary" disabled={busy || order.sync_state !== "SYNCED"} onClick={() => onCommand("QUOTE")}>{busy ? <LoaderCircle className="spin" /> : null}{t("createQuotation")}</button> : null}{order.status === "CONFIRMED" && capabilities.includes("PRODUCTION") ? <button className="button primary" disabled={busy || order.sync_state !== "SYNCED"} onClick={() => onCommand("RESERVE")}>{busy ? <LoaderCircle className="spin" /> : null}{t("reserveMaterials")}</button> : null}{next ? <button className="button primary" disabled={busy || order.sync_state !== "SYNCED"} onClick={() => onTransition(next)}>{busy ? <LoaderCircle className="spin" /> : null}{t("moveToNextStage")}</button> : null}{!["FULFILLED", "CANCELLED"].includes(order.status) ? <button className="button danger" disabled={busy || order.sync_state !== "SYNCED"} onClick={() => onTransition("CANCELLED")}>{t("cancelOrder")}</button> : null}{order.sync_state !== "SYNCED" ? <small>{t("syncBeforeWorkflow")}</small> : null}</div> : null}</aside></div>;
}
