import { useEffect, useRef, useState } from "react";
import { Check, Search, ScanLine, WandSparkles } from "lucide-react";
import { localizeError, useI18n } from "../../i18n";
import type { Product } from "../../types";

type Step = "scan" | "search" | "variant" | "confirm" | "saved";

export function BarcodeManagerScreen({ onNotice, onChanged, gatewayMode }: {
  onNotice: (message: string) => void;
  onChanged: () => Promise<void>;
  gatewayMode: boolean;
}) {
  const { t, language } = useI18n();
  const scanRef = useRef<HTMLInputElement>(null);
  const [step, setStep] = useState<Step>("scan");
  const [input, setInput] = useState("");
  const [code, setCode] = useState("");
  const [existing, setExisting] = useState<Product | null>(null);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<Product[]>([]);
  const [group, setGroup] = useState<Product[]>([]);
  const [selected, setSelected] = useState<Product | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => { scanRef.current?.focus(); }, []);
  useEffect(() => {
    if (step !== "search") return;
    if (query.trim().length < 2) { setResults([]); return; }
    let cancelled = false;
    const timer = window.setTimeout(() => {
      void window.pos.listInventory({ search: query, limit: 250 }).then((rows) => {
        if (!cancelled) setResults(rows as Product[]);
      }).catch((value) => { if (!cancelled) setError(localizeError(language, value)); });
    }, 180);
    return () => { cancelled = true; window.clearTimeout(timer); };
  }, [query, step, language]);

  const nameOf = (product: Product) => language === "ar" && product.name_ar ? product.name_ar : product.name;
  const variantOf = (product: Product) => product.variant_name || product.sku || (language === "ar" ? "افتراضي" : "Default");

  async function check(value: string) {
    const normalized = value.trim();
    setError("");
    if (!normalized || normalized.length > 80 || !/^[A-Za-z0-9._:-]+$/.test(normalized)) {
      setError(t("barcodeInvalid"));
      return;
    }
    setBusy(true);
    try {
      const rows = await window.pos.listInventory({ search: normalized, limit: 250 }) as Product[];
      const match = rows.find((row) => [row.barcode, row.sku].some((item) => item?.toUpperCase() === normalized.toUpperCase()));
      setCode(normalized);
      setExisting(match ?? null);
      setSelected(null);
      setGroup([]);
      setQuery("");
      setStep(match ? "scan" : "search");
    } catch (value) {
      setError(localizeError(language, value));
    } finally {
      setBusy(false);
    }
  }

  function generate() {
    const bytes = new Uint8Array(8);
    globalThis.crypto.getRandomValues(bytes);
    const generated = `SHEA-${Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("").toUpperCase()}`;
    setInput(generated);
    void check(generated);
  }

  async function selectGroup(product: Product) {
    setError("");
    try {
      const rows = await window.pos.listInventory({ search: product.name, limit: 250 }) as Product[];
      const variants = rows.filter((row) => product.template_id
        ? row.template_id === product.template_id
        : row.local_id === product.local_id);
      setGroup(variants.length ? variants : [product]);
      setStep("variant");
    } catch (value) {
      setError(localizeError(language, value));
    }
  }

  async function assign() {
    if (!selected || busy || gatewayMode) return;
    setBusy(true);
    setError("");
    try {
      await window.pos.updateProduct({ productLocalId: selected.local_id, vendorBarcode: code });
      await onChanged();
      setStep("saved");
      onNotice(t("barcodeAssigned"));
    } catch (value) {
      setError(localizeError(language, value));
    } finally {
      setBusy(false);
    }
  }

  function reset() {
    setStep("scan"); setInput(""); setCode(""); setExisting(null);
    setSelected(null); setGroup([]); setQuery(""); setError("");
    window.setTimeout(() => scanRef.current?.focus(), 0);
  }

  const groups = results.filter((row, index, all) => all.findIndex((other) =>
    row.template_id ? other.template_id === row.template_id : other.local_id === row.local_id) === index);

  return <div className="barcode-workspace">
    <section className="panel barcode-main">
      <div className="barcode-heading"><ScanLine /><div><h2>{t("barcodeManager")}</h2><p>{t("barcodeScanHint")}</p></div></div>
      <form className="barcode-scan" onSubmit={(event) => { event.preventDefault(); void check(input); }}>
        <label htmlFor="barcode-input">{t("barcodeCode")}</label>
        <div className="barcode-input-row">
          <input id="barcode-input" ref={scanRef} dir="ltr" autoComplete="off" value={input}
            onChange={(event) => { setInput(event.target.value); setCode(""); setExisting(null); if (step !== "scan") setStep("scan"); }} />
          <button className="button primary" disabled={busy} type="submit">{t("barcodeCheck")}</button>
        </div>
      </form>
      {!gatewayMode && <button className="button secondary" type="button" onClick={generate}><WandSparkles />{t("barcodeGenerate")}</button>}
      <p className="barcode-help">{gatewayMode ? t("barcodeGatewayUnavailable") : t("barcodeOfflineHint")}</p>
      {error && <p className="barcode-error" role="alert">{error}</p>}
      {existing && <div className="barcode-result"><Check /><div><strong>{t("barcodeExisting")}</strong><p>{nameOf(existing)} · {variantOf(existing)}</p><code dir="ltr">{existing.barcode || existing.sku}</code></div></div>}
      {code && !existing && step !== "saved" && <div className="barcode-result"><Search /><div><strong>{t("barcodeUnknown")}</strong><code dir="ltr">{code}</code></div></div>}
    </section>

    {step === "search" && <section className="panel barcode-main">
      <div className="barcode-heading"><span className="barcode-step">1</span><h2>{t("barcodeSearchProduct")}</h2></div>
      <input className="barcode-search" data-keyboard-search placeholder={t("searchInventory")} value={query} onChange={(event) => setQuery(event.target.value)} />
      <div className="barcode-results">{groups.length ? groups.map((product) =>
        <button key={product.local_id} type="button" className="barcode-product" onClick={() => void selectGroup(product)}>
          {product.image && <img src={product.image} alt="" />}
          <span><strong>{nameOf(product)}</strong><small>{product.template_id ? results.filter((row) => row.template_id === product.template_id).length : 1} {language === "ar" ? "أنواع" : "variants"}</small></span>
        </button>) : <p className="barcode-help">{query.trim().length < 2 ? t("barcodeSearchHint") : t("barcodeNoResults")}</p>}</div>
    </section>}

    {step === "variant" && <section className="panel barcode-main">
      <div className="barcode-heading"><span className="barcode-step">2</span><h2>{t("barcodeSelectVariant")}</h2></div>
      <div className="barcode-results">{group.map((product) =>
        <button key={product.local_id} type="button" className="barcode-product" disabled={!product.server_id}
          onClick={() => { setSelected(product); setStep("confirm"); }}>
          {product.image && <img src={product.image} alt="" />}
          <span><strong>{variantOf(product)}</strong><small>{product.barcode || product.sku || ""}</small>{!product.server_id && <small>{t("barcodeDraft")}</small>}</span>
        </button>)}</div>
      <button className="button secondary" type="button" onClick={() => setStep("search")}>{t("previous")}</button>
    </section>}

    {step === "confirm" && selected && <section className="panel barcode-main">
      <div className="barcode-heading"><span className="barcode-step">3</span><h2>{t("barcodeConfirm")}</h2></div>
      <div className="barcode-confirm"><div><strong>{nameOf(selected)}</strong><small>{variantOf(selected)}</small></div><code dir="ltr">{code}</code></div>
      {selected.barcode && selected.barcode !== code && <p className="barcode-help">{t("barcodeReplace")} <code dir="ltr">{selected.barcode}</code></p>}
      <div className="barcode-actions"><button className="button secondary" type="button" onClick={() => setStep("variant")}>{t("previous")}</button><button className="button primary" type="button" disabled={busy || gatewayMode} onClick={() => void assign()}>{t("barcodeAssign")}</button></div>
    </section>}

    {step === "saved" && <section className="panel barcode-main"><div className="barcode-result"><Check /><strong>{t("barcodeAssigned")}</strong></div><button className="button primary" type="button" onClick={reset}>{t("barcodeNewScan")}</button></section>}
  </div>;
}
