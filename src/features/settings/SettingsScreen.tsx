import { useEffect, useState } from "react";
import {
  Check,
  FileText,
  LoaderCircle,
  Printer,
  RefreshCw,
  ScanBarcode,
  SlidersHorizontal,
} from "lucide-react";
import { localizeError, useI18n } from "../../i18n";
import { LoadingState } from "../../components/AsyncState";
import { PageHeader } from "../../components/PageHeader";

type PrintTab = "receipt" | "label";

const defaults: Record<string, string> = {
  theme: "system",
  language: "en",
  primaryColor: "#2f6fed",
  receiptPaperWidth: "80",
  receiptShowLogo: "true",
  receiptShowCustomer: "true",
  receiptShowSku: "true",
  receiptShowTendered: "true",
  labelWidth: "50",
  labelHeight: "30",
  labelShowLogo: "false",
  labelShowVariant: "true",
  labelShowSku: "true",
  labelShowBarcode: "true",
};

export function SettingsScreen({
  values,
  onChange,
  onNotice,
}: {
  values: Record<string, string>;
  onChange: (value: Record<string, string>) => void;
  onNotice: (message: string) => void;
}) {
  const { t, language } = useI18n();
  const [printers, setPrinters] = useState<any[]>([]);
  const [draft, setDraft] = useState({ ...defaults, ...values });
  const [tab, setTab] = useState<PrintTab>("receipt");
  const [previewHtml, setPreviewHtml] = useState("");
  const [previewLoading, setPreviewLoading] = useState(true);
  const [loadingPrinters, setLoadingPrinters] = useState(true);
  const [saving, setSaving] = useState(false);
  const [printing, setPrinting] = useState(false);

  useEffect(() => setDraft({ ...defaults, ...values }), [values]);

  function loadPrinters() {
    setLoadingPrinters(true);
    void window.pos
      .listPrinters()
      .then(setPrinters as any)
      .catch((value) => onNotice(localizeError(language, value)))
      .finally(() => setLoadingPrinters(false));
  }

  useEffect(loadPrinters, []);

  useEffect(() => {
    let current = true;
    setPreviewLoading(true);
    const timeout = window.setTimeout(() => {
      const request =
        tab === "receipt"
          ? window.pos.previewReceipt({ settings: draft })
          : window.pos.previewPriceLabel({ settings: draft });
      void request
        .then((html) => current && setPreviewHtml(html))
        .catch((value) =>
          current && onNotice(localizeError(language, value)),
        )
        .finally(() => current && setPreviewLoading(false));
    }, 180);
    return () => {
      current = false;
      window.clearTimeout(timeout);
    };
  }, [draft, tab]);

  function change(key: string, value: string, applyImmediately = false) {
    const next = { ...draft, [key]: value };
    setDraft(next);
    if (applyImmediately) onChange(next);
  }

  async function save(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    try {
      const result = await window.pos.updateSettings(draft);
      setDraft({ ...defaults, ...result });
      onChange(result);
      onNotice(t("settingsSaved"));
    } catch (value) {
      onNotice(localizeError(language, value));
    } finally {
      setSaving(false);
    }
  }

  function chooseLogo(file?: File) {
    if (!file) return;
    if (file.size > 2_000_000) return onNotice(t("logoTooLarge"));
    const reader = new FileReader();
    reader.onload = () => change("storeLogo", String(reader.result), true);
    reader.readAsDataURL(file);
  }

  async function testPrint() {
    setPrinting(true);
    try {
      if (tab === "receipt") {
        await window.pos.testPrinter({
          printerName: draft.printerName || undefined,
          settings: draft,
        });
      } else {
        await window.pos.testPriceLabel({
          printerName: draft.labelPrinterName || undefined,
          settings: draft,
        });
      }
      onNotice(t("testReceiptSent"));
    } catch (value) {
      onNotice(localizeError(language, value));
    } finally {
      setPrinting(false);
    }
  }

  return (
    <form className="page-stack settings-form" onSubmit={save}>
      <PageHeader
        eyebrow={t("workspace")}
        title={t("appearancePrinting")}
        description={t("appearanceHelp")}
        actions={
          <button className="button primary" disabled={saving}>
            {saving ? <LoaderCircle className="spin" /> : <Check />}
            {saving ? t("saving") : t("saveChanges")}
          </button>
        }
      />

      <div className="settings-overview-grid">
        <section className="panel settings-section">
          <div className="section-title">
            <div className="section-icon"><SlidersHorizontal /></div>
            <div><h3>{t("workspace")}</h3><p>{t("workspaceSettingsHelp")}</p></div>
          </div>
          <label>
            {t("storeName")}
            <input value={draft.storeName || ""} onChange={(event) => change("storeName", event.target.value)} />
          </label>
          <div className="two-fields">
            <label>
              {t("appearance")}
              <select value={draft.theme} onChange={(event) => change("theme", event.target.value, true)}>
                <option value="system">{t("system")}</option>
                <option value="light">{t("light")}</option>
                <option value="dark">{t("dark")}</option>
              </select>
            </label>
            <label>
              {t("language")}
              <select value={draft.language} onChange={(event) => change("language", event.target.value, true)}>
                <option value="en">{t("english")}</option>
                <option value="ar">{t("arabic")}</option>
              </select>
            </label>
          </div>
          <label>
            {t("brandColor")}
            <input className="color-input" type="color" value={draft.primaryColor} onChange={(event) => change("primaryColor", event.target.value, true)} />
          </label>
          <label>
            {t("storeLogo")}
            <div className="logo-picker">
              {draft.storeLogo ? <img src={draft.storeLogo} alt="" /> : <span>S</span>}
              <input type="file" accept="image/png,image/jpeg,image/webp,image/svg+xml" onChange={(event) => chooseLogo(event.target.files?.[0])} />
              {draft.storeLogo ? <button type="button" className="button secondary" onClick={() => change("storeLogo", "", true)}>{t("removeLogo")}</button> : null}
            </div>
          </label>
        </section>

        <section className="panel settings-section">
          <div className="section-title">
            <div className="section-icon"><Printer /></div>
            <div><h3>{t("windowsPrinters")}</h3><p>{t("nativePrinterHelp")}</p></div>
          </div>
          <PrinterSelect label={t("receiptPrinter")} value={draft.printerName || ""} onChange={(value) => change("printerName", value)} printers={printers} loading={loadingPrinters} defaultLabel={t("defaultPrinter")} defaultSuffix={t("defaultSuffix")} />
          <PrinterSelect label={t("labelPrinter")} value={draft.labelPrinterName || ""} onChange={(value) => change("labelPrinterName", value)} printers={printers} loading={loadingPrinters} defaultLabel={t("defaultPrinter")} defaultSuffix={t("defaultSuffix")} />
          {loadingPrinters ? <LoadingState label={t("loading")} compact /> : null}
          <button type="button" className="button secondary" disabled={loadingPrinters} onClick={loadPrinters}><RefreshCw />{t("refreshPrinters")}</button>
          <div className="info"><SlidersHorizontal /><p><strong>{t("windowsDriverTitle")}</strong><br />{t("windowsDriverHelp")}</p></div>
        </section>
      </div>

      <section className="panel print-studio">
        <div className="print-studio-heading">
          <div>
            <p className="eyebrow">{t("printStudio")}</p>
            <h3>{tab === "receipt" ? t("receiptDesign") : t("priceLabelDesign")}</h3>
            <p>{t("printStudioHelp")}</p>
          </div>
          <div className="segmented print-tabs">
            <button type="button" className={tab === "receipt" ? "active" : ""} onClick={() => setTab("receipt")}><FileText />{t("receipt")}</button>
            <button type="button" className={tab === "label" ? "active" : ""} onClick={() => setTab("label")}><ScanBarcode />{t("priceLabel")}</button>
          </div>
        </div>
        <div className="print-studio-grid">
          <div className="print-controls">
            {tab === "receipt" ? (
              <>
                <label>{t("paperWidth")}<select value={draft.receiptPaperWidth} onChange={(event) => change("receiptPaperWidth", event.target.value)}><option value="58">58 mm</option><option value="80">80 mm</option></select></label>
                <label>{t("receiptHeader")}<textarea value={draft.receiptHeader || ""} onChange={(event) => change("receiptHeader", event.target.value)} /></label>
                <label>{t("receiptFooter")}<textarea value={draft.receiptFooter || ""} onChange={(event) => change("receiptFooter", event.target.value)} /></label>
                <Toggle label={t("showLogo")} value={draft.receiptShowLogo} onChange={(value) => change("receiptShowLogo", value)} />
                <Toggle label={t("showCustomer")} value={draft.receiptShowCustomer} onChange={(value) => change("receiptShowCustomer", value)} />
                <Toggle label={t("showSku")} value={draft.receiptShowSku} onChange={(value) => change("receiptShowSku", value)} />
                <Toggle label={t("showTenderedChange")} value={draft.receiptShowTendered} onChange={(value) => change("receiptShowTendered", value)} />
              </>
            ) : (
              <>
                <div className="two-fields">
                  <label>{t("labelWidth")}<input type="number" min="25" max="100" value={draft.labelWidth} onChange={(event) => change("labelWidth", event.target.value)} /></label>
                  <label>{t("labelHeight")}<input type="number" min="15" max="100" value={draft.labelHeight} onChange={(event) => change("labelHeight", event.target.value)} /></label>
                </div>
                <Toggle label={t("showLogo")} value={draft.labelShowLogo} onChange={(value) => change("labelShowLogo", value)} />
                <Toggle label={t("showVariant")} value={draft.labelShowVariant} onChange={(value) => change("labelShowVariant", value)} />
                <Toggle label={t("showSku")} value={draft.labelShowSku} onChange={(value) => change("labelShowSku", value)} />
                <Toggle label={t("showBarcode")} value={draft.labelShowBarcode} onChange={(value) => change("labelShowBarcode", value)} />
              </>
            )}
            <button type="button" className="button secondary full" disabled={printing || previewLoading} onClick={() => void testPrint()}>{printing ? <LoaderCircle className="spin" /> : <Printer />}{printing ? t("printing") : t("testPrint")}</button>
          </div>
          <div className="print-preview-panel">
            <div className="print-preview-toolbar"><span><i />{t("livePreview")}</span><small>{tab === "receipt" ? `${draft.receiptPaperWidth} mm` : `${draft.labelWidth} × ${draft.labelHeight} mm`}</small></div>
            <div className={`print-preview-canvas ${tab}`}>
              {previewLoading ? <LoadingState label={t("updatingPreview")} compact /> : <iframe title={t("livePreview")} srcDoc={previewHtml} sandbox="" />}
            </div>
          </div>
        </div>
      </section>
    </form>
  );
}

function PrinterSelect({ label, value, onChange, printers, loading, defaultLabel, defaultSuffix }: { label: string; value: string; onChange: (value: string) => void; printers: any[]; loading: boolean; defaultLabel: string; defaultSuffix: string }) {
  return <label>{label}<select value={value} disabled={loading} onChange={(event) => onChange(event.target.value)}><option value="">{defaultLabel}</option>{printers.map((printer) => <option key={printer.name} value={printer.name}>{printer.displayName || printer.name}{printer.isDefault ? ` (${defaultSuffix})` : ""}</option>)}</select></label>;
}

function Toggle({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
  return <label className="setting-toggle"><span>{label}</span><input type="checkbox" checked={value !== "false"} onChange={(event) => onChange(String(event.target.checked))} /></label>;
}
