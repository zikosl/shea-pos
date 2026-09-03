import { useEffect, useMemo, useState } from "react";
import {
  Eye,
  LoaderCircle,
  PackageCheck,
  Plus,
  Printer,
  RotateCcw,
  Search,
  Trash2,
  X,
} from "lucide-react";
import { ErrorState, LoadingState } from "../../components/AsyncState";
import { EmptyState } from "../../components/EmptyState";
import { PageHeader } from "../../components/PageHeader";
import { DateTimePicker } from "../../components/DateTimePicker";
import { localeFor, localizeError, localizeValue, useI18n } from "../../i18n";
import { money } from "../../shared/format";

type EntryLine = {
  product: any;
  quantity: number;
  pricingMode: "UNIT" | "TOTAL";
  price: number;
};

const currentLocalDateTime = () =>
  new Date(Date.now() - new Date().getTimezoneOffset() * 60_000)
    .toISOString()
    .slice(0, 16);

export function StockEntriesScreen({
  onNotice,
  settings,
}: {
  onNotice: (message: string) => void;
  settings: Record<string, string>;
}) {
  const { t, language } = useI18n();
  const [entries, setEntries] = useState<any[]>([]);
  const [products, setProducts] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [query, setQuery] = useState("");
  const [showCreate, setShowCreate] = useState(false);
  const [lines, setLines] = useState<EntryLine[]>([]);
  const [saving, setSaving] = useState(false);
  const [preview, setPreview] = useState<any | null>(null);
  const [previewHtml, setPreviewHtml] = useState("");
  const [printing, setPrinting] = useState(false);
  const [entryDate, setEntryDate] = useState(currentLocalDateTime);

  const load = async () => {
    setLoading(true);
    setError("");
    try {
      const [entryRows, productRows] = await Promise.all([
        window.pos.listStockEntries(),
        window.pos.listInventory({ limit: 250 }),
      ]);
      setEntries(entryRows as any[]);
      setProducts(
        (productRows as any[]).filter(
          (row) => row.inventory_policy === "TRACKED",
        ),
      );
    } catch (value) {
      setError(localizeError(language, value));
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => {
    void load();
  }, []);

  const suggestions = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return products
      .filter(
        (row) =>
          !lines.some((line) => line.product.local_id === row.local_id) &&
          (!needle ||
            [row.name, row.name_ar, row.variant_name, row.sku, row.barcode].some(
              (value) =>
                String(value ?? "")
                  .toLowerCase()
                  .includes(needle),
            )),
      )
      .slice(0, 8);
  }, [products, lines, query]);
  const total = lines.reduce(
    (sum, line) =>
      sum +
      (line.pricingMode === "TOTAL"
        ? line.price
        : line.price * line.quantity),
    0,
  );
  const localizedName = (row: any) =>
    language === "ar" && row.name_ar ? row.name_ar : row.name;

  function addProduct(product: any) {
    setLines((current) => [
      ...current,
      {
        product,
        quantity: 1,
        pricingMode: "UNIT",
        price: Number(product.cost_price ?? 0),
      },
    ]);
    setQuery("");
  }

  function updateLine(index: number, changes: Partial<EntryLine>) {
    setLines((current) =>
      current.map((line, lineIndex) =>
        lineIndex === index ? { ...line, ...changes } : line,
      ),
    );
  }

  async function createEntry(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!lines.length) return;
    const data = new FormData(event.currentTarget);
    setSaving(true);
    try {
      await window.pos.createStockEntry({
        supplierName: String(data.get("supplierName") || "") || undefined,
        supplierInvoice:
          String(data.get("supplierInvoice") || "") || undefined,
        entryDate: new Date(String(data.get("entryDate"))).toISOString(),
        note: String(data.get("note") || "") || undefined,
        lines: lines.map((line) => ({
          productLocalId: line.product.local_id,
          quantity: line.quantity,
          pricingMode: line.pricingMode,
          price: line.price,
        })),
      });
      setShowCreate(false);
      setLines([]);
      setEntryDate(currentLocalDateTime());
      onNotice(t("stockEntryPosted"));
      await load();
    } catch (value) {
      onNotice(localizeError(language, value));
    } finally {
      setSaving(false);
    }
  }

  async function openPreview(entry: any) {
    setPreview(entry);
    setPreviewHtml("");
    try {
      setPreviewHtml(await window.pos.previewStockEntry({ id: entry.id }));
    } catch (value) {
      setPreview(null);
      onNotice(localizeError(language, value));
    }
  }

  async function cancelEntry(entry: any) {
    if (!window.confirm(t("cancelStockEntryConfirm"))) return;
    setSaving(true);
    try {
      await window.pos.cancelStockEntry(entry.id);
      onNotice(t("stockEntryCancelled"));
      await load();
    } catch (value) {
      onNotice(localizeError(language, value));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="page-stack stock-entries-page">
      <PageHeader
        eyebrow={t("inventory")}
        title={t("stockEntries")}
        description={t("stockEntriesText")}
        actions={
          <button
            className="button primary"
            type="button"
            onClick={() => {
              setEntryDate(currentLocalDateTime());
              setShowCreate(true);
            }}
          >
            <Plus /> {t("newStockEntry")}
          </button>
        }
      />
      <div className="panel data-panel">
        {loading ? (
          <LoadingState label={t("loadingData")} />
        ) : error ? (
          <ErrorState
            title={t("unableToLoad")}
            text={error}
            retryLabel={t("retry")}
            onRetry={() => void load()}
          />
        ) : entries.length ? (
          <div className="table">
            <div className="table-row stock-entry-row table-head">
              <span>{t("reference")}</span>
              <span>{t("supplier")}</span>
              <span>{t("date")}</span>
              <span>{t("items")}</span>
              <span>{t("status")}</span>
              <span>{t("totalCost")}</span>
              <span />
            </div>
            {entries.map((entry) => (
              <div className="table-row stock-entry-row" key={entry.id}>
                <span><strong>{entry.entry_number}</strong><small>{entry.supplier_invoice || entry.operator_name}</small></span>
                <span>{entry.supplier_name || "-"}</span>
                <span>{new Date(entry.entry_date).toLocaleDateString(localeFor(language))}</span>
                <span>{entry.item_count}</span>
                <span><em className={entry.status === "POSTED" ? "badge" : "badge warning"}>{localizeValue(language, entry.status)}</em></span>
                <span><strong>{money(entry.total_cost)}</strong></span>
                <span className="row-action">
                  <button className="icon-button" title={t("preview")} onClick={() => void openPreview(entry)}><Eye /></button>
                  {entry.status === "POSTED" ? <button className="icon-button danger" title={t("cancelEntry")} disabled={saving} onClick={() => void cancelEntry(entry)}><RotateCcw /></button> : null}
                </span>
              </div>
            ))}
          </div>
        ) : (
          <EmptyState icon={PackageCheck} title={t("noStockEntries")} text={t("noStockEntriesText")} />
        )}
      </div>

      {showCreate ? (
        <div className="modal-backdrop" onMouseDown={(event) => event.target === event.currentTarget && !saving && setShowCreate(false)}>
          <form className="modal-card stock-entry-dialog" onSubmit={createEntry}>
            <div className="receipt-preview-heading">
              <div><p className="eyebrow">{t("inventory")}</p><h2>{t("newStockEntry")}</h2></div>
              <button className="icon-button" type="button" onClick={() => setShowCreate(false)}><X /></button>
            </div>
            <div className="stock-entry-meta">
              <label>{t("supplier")}<input name="supplierName" autoFocus /></label>
              <label>{t("supplierInvoice")}<input name="supplierInvoice" /></label>
              <label>{t("entryDate")}<DateTimePicker name="entryDate" value={entryDate} onChange={setEntryDate} /></label>
            </div>
            <div className="stock-product-picker">
              <div className="search"><Search /><input data-keyboard-search value={query} onChange={(event) => setQuery(event.target.value)} placeholder={t("searchProductsToReceive")} /></div>
              <div className="stock-product-suggestions">
                {suggestions.map((product) => (
                  <button type="button" key={product.local_id} onClick={() => addProduct(product)}>
                    <span><strong>{localizedName(product)}</strong><small>{product.variant_name || product.sku || t("standard")}</small></span>
                    <span><small>{t("currentStock")}</small><strong>{product.stock}</strong></span>
                    <Plus />
                  </button>
                ))}
              </div>
            </div>
            <div className="stock-entry-lines">
              {lines.map((line, index) => {
                const lineTotal = line.pricingMode === "TOTAL" ? line.price : line.price * line.quantity;
                const unitCost = line.quantity ? lineTotal / line.quantity : 0;
                return (
                  <div className="stock-entry-line" key={line.product.local_id}>
                    <div><strong>{localizedName(line.product)}</strong><small>{line.product.variant_name || line.product.sku || t("standard")}</small></div>
                    <label>{t("quantity")}<input type="number" min="0.01" step="0.01" value={line.quantity} onChange={(event) => updateLine(index, { quantity: Number(event.target.value) })} /></label>
                    <label>{t("pricingMode")}<select value={line.pricingMode} onChange={(event) => updateLine(index, { pricingMode: event.target.value as EntryLine["pricingMode"] })}><option value="UNIT">{t("perItem")}</option><option value="TOTAL">{t("wholeQuantity")}</option></select></label>
                    <label>{line.pricingMode === "UNIT" ? t("unitCost") : t("totalCost")}<input type="number" min="0" step="0.01" value={line.price} onChange={(event) => updateLine(index, { price: Number(event.target.value) })} /></label>
                    <span className="stock-line-total"><small>{money(unitCost)} / {t("item")}</small><strong>{money(lineTotal)}</strong></span>
                    <button type="button" className="icon-button danger" onClick={() => setLines((current) => current.filter((_, lineIndex) => lineIndex !== index))}><Trash2 /></button>
                  </div>
                );
              })}
              {!lines.length ? <div className="stock-lines-empty"><PackageCheck /><span>{t("addProductsToEntry")}</span></div> : null}
            </div>
            <label className="stock-entry-note">{t("note")}<textarea name="note" /></label>
            <div className="stock-entry-summary"><span>{lines.length} {t("items")}</span><strong>{t("totalCost")}: {money(total)}</strong></div>
            <div className="dialog-actions">
              <button type="button" className="button secondary" disabled={saving} onClick={() => setShowCreate(false)}>{t("cancel")}</button>
              <button className="button primary" disabled={saving || !lines.length || lines.some((line) => line.quantity <= 0)}>{saving ? <LoaderCircle className="spin" /> : <PackageCheck />}{saving ? t("saving") : t("postStockEntry")}</button>
            </div>
          </form>
        </div>
      ) : null}

      {preview ? (
        <div className="modal-backdrop" onMouseDown={(event) => event.target === event.currentTarget && !printing && setPreview(null)}>
          <section className="modal-card receipt-preview-dialog">
            <div className="receipt-preview-heading"><div><p className="eyebrow">{t("stockEntry")}</p><h2>{preview.entry_number}</h2></div><button className="icon-button" onClick={() => setPreview(null)}><X /></button></div>
            <div className="receipt-preview-canvas">{previewHtml ? <iframe title={t("stockEntry")} srcDoc={previewHtml} sandbox="" /> : <LoadingState label={t("updatingPreview")} compact />}</div>
            <div className="dialog-actions"><button className="button secondary" onClick={() => setPreview(null)}>{t("close")}</button><button className="button primary" disabled={printing || !previewHtml} onClick={async () => { setPrinting(true); try { await window.pos.printStockEntry({ id: preview.id, printerName: settings.printerName || undefined }); onNotice(t("documentSentToPrinter")); } catch (value) { onNotice(localizeError(language, value)); } finally { setPrinting(false); } }}>{printing ? <LoaderCircle className="spin" /> : <Printer />}{printing ? t("printing") : t("print")}</button></div>
          </section>
        </div>
      ) : null}
    </div>
  );
}
