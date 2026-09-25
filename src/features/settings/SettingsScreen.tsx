import { useEffect, useState } from "react";
import {
  Check,
  FileText,
  LoaderCircle,
  Printer,
  RefreshCw,
  ScanBarcode,
  Network,
  MonitorSmartphone,
  LogOut,
  ShieldCheck,
  TriangleAlert,
  Unplug,
  SlidersHorizontal,
} from "lucide-react";
import { localizeError, useI18n } from "../../i18n";
import { LoadingState } from "../../components/AsyncState";
import { PageHeader } from "../../components/PageHeader";

type PrintTab = "receipt" | "label";

type StoreNetwork = {
  id: string;
  name: string;
  cloudSyncEnabled: boolean;
  cloudGatewayUrl?: string;
  localGatewayUrl?: string;
};

const defaults: Record<string, string> = {
  theme: "system",
  language: "en",
  primaryColor: "#2f6fed",
  receiptPaperWidth: "80",
  receiptShowLogo: "true",
  receiptShowCustomer: "true",
  receiptShowSku: "true",
  receiptShowTendered: "true",
  receiptShowNote: "true",
  receiptPreset: "standard",
  receiptDensity: "standard",
  receiptTextSize: "standard",
  receiptMargin: "standard",
  receiptLogoSize: "medium",
  receiptCodeType: "qr",
  receiptCodePosition: "footer",
  receiptCodeAlignment: "center",
  labelWidth: "50",
  labelHeight: "30",
  labelShowLogo: "false",
  labelShowVariant: "true",
  labelShowSku: "true",
  labelShowBarcode: "true",
  localSessionTimeout: "15",
  deploymentMode: "solo",
  gatewayUrl: "http://127.0.0.1:3510",
};

function settingsDraft(values: Record<string, string>) {
  const merged = { ...defaults, ...values };
  for (const [key, fallback] of Object.entries(defaults)) {
    if (!merged[key]) merged[key] = fallback;
  }
  return merged;
}

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
  const [draft, setDraft] = useState(() => settingsDraft(values));
  const [tab, setTab] = useState<PrintTab>("receipt");
  const [previewHtml, setPreviewHtml] = useState("");
  const [previewRevision, setPreviewRevision] = useState(0);
  const [previewLoading, setPreviewLoading] = useState(true);
  const [loadingPrinters, setLoadingPrinters] = useState(true);
  const [saving, setSaving] = useState(false);
  const [printing, setPrinting] = useState(false);
  const [gatewayStatus, setGatewayStatus] = useState<any>(null);
  const [gatewayBusy, setGatewayBusy] = useState(false);
  const [pairingCode, setPairingCode] = useState("");
  const [stores, setStores] = useState<StoreNetwork[]>([]);
  const [selectedStoreId, setSelectedStoreId] = useState("");
  const [gatewayCredential, setGatewayCredential] = useState<any>(null);
  const [accountSessions, setAccountSessions] = useState<any[]>([]);
  const [currentTokenId, setCurrentTokenId] = useState("");
  const [sessionsLoading, setSessionsLoading] = useState(true);

  useEffect(() => setDraft(settingsDraft(values)), [values]);

  function loadPrinters() {
    setLoadingPrinters(true);
    void window.pos
      .listPrinters()
      .then(setPrinters as any)
      .catch((value) => onNotice(localizeError(language, value)))
      .finally(() => setLoadingPrinters(false));
  }

  useEffect(loadPrinters, []);

  function loadGatewayStatus() {
    void window.pos.getGatewayStatus().then(setGatewayStatus).catch(() => setGatewayStatus(null));
  }

  useEffect(loadGatewayStatus, [values.deploymentMode, values.gatewayUrl]);

  function loadAccountSessions() {
    setSessionsLoading(true);
    void window.pos.listAccountSessions()
      .then((result) => { setAccountSessions(result.sessions); setCurrentTokenId(result.currentTokenId || ""); })
      .catch((value) => onNotice(localizeError(language, value)))
      .finally(() => setSessionsLoading(false));
  }

  useEffect(loadAccountSessions, []);

  async function revokeSession(tokenId: string) {
    if (!window.confirm(t("signOutDeviceConfirm"))) return;
    try {
      await window.pos.revokeAccountSession({ tokenId });
      onNotice(t("deviceSignedOut"));
      loadAccountSessions();
    } catch (value) {
      onNotice(localizeError(language, value));
    }
  }

  async function revokeOtherSessions() {
    if (!window.confirm(t("signOutOtherDevicesConfirm"))) return;
    try {
      await window.pos.revokeOtherAccountSessions();
      onNotice(t("otherDevicesSignedOut"));
      loadAccountSessions();
    } catch (value) {
      onNotice(localizeError(language, value));
    }
  }

  function applyStoreNetwork(rows: StoreNetwork[]) {
      setStores(rows);
      setSelectedStoreId((current) => rows.some((store) => store.id === current) ? current : rows[0]?.id || "");
      const suggestedGatewayUrl = rows[0]?.localGatewayUrl;
      if (suggestedGatewayUrl && values.deploymentMode !== "multi") {
        setDraft((current) => ({ ...current, gatewayUrl: suggestedGatewayUrl }));
      }
  }

  useEffect(() => {
    void window.pos.getStoreNetwork().then((rows) => applyStoreNetwork(rows as StoreNetwork[])).catch(() => undefined);
  }, []);

  useEffect(() => {
    let current = true;
    setPreviewLoading(true);
    const timeout = window.setTimeout(() => {
      const request =
        tab === "receipt"
          ? window.pos.previewReceipt({ settings: draft })
          : window.pos.previewPriceLabel({ settings: draft });
      void request
        .then((html) => {
          if (!current) return;
          setPreviewHtml(html);
          setPreviewRevision((revision) => revision + 1);
        })
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

  function changeReceipt(key: string, value: string) {
    setDraft((current) => ({ ...current, receiptPreset: "custom", [key]: value }));
  }

  function applyReceiptPreset(preset: "compact" | "standard" | "detailed") {
    const presetValues = {
      compact: {
        receiptDensity: "compact",
        receiptTextSize: "small",
        receiptMargin: "small",
        receiptLogoSize: "small",
        receiptShowCustomer: "false",
        receiptShowSku: "false",
        receiptShowTendered: "false",
        receiptShowNote: "false",
        receiptCodeType: "barcode",
      },
      standard: {
        receiptDensity: "standard",
        receiptTextSize: "standard",
        receiptMargin: "standard",
        receiptLogoSize: "medium",
        receiptShowCustomer: "true",
        receiptShowSku: "true",
        receiptShowTendered: "true",
        receiptShowNote: "true",
        receiptCodeType: "qr",
      },
      detailed: {
        receiptDensity: "comfortable",
        receiptTextSize: "large",
        receiptMargin: "large",
        receiptLogoSize: "large",
        receiptShowCustomer: "true",
        receiptShowSku: "true",
        receiptShowTendered: "true",
        receiptShowNote: "true",
        receiptCodeType: "both",
      },
    }[preset];
    setDraft((current) => ({ ...current, receiptPreset: preset, ...presetValues }));
  }

  async function save(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    try {
      const result = await window.pos.updateSettings(draft);
      setDraft(settingsDraft(result));
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

  async function pairGateway() {
    setGatewayBusy(true);
    try {
      const status = await window.pos.pairGateway({
        url: draft.gatewayUrl,
        pairingCode,
        name: draft.storeName || "Shea POS",
      });
      setPairingCode("");
      const next = await window.pos.updateSettings({ deploymentMode: "multi", gatewayUrl: draft.gatewayUrl });
      setDraft(settingsDraft(next));
      onChange(next);
      setGatewayStatus(status);
      onNotice(t("gatewayPaired"));
    } catch (value) {
      onNotice(localizeError(language, value));
    } finally {
      setGatewayBusy(false);
    }
  }

  async function disconnectGateway() {
    setGatewayBusy(true);
    try {
      await window.pos.disconnectGateway();
      const next = await window.pos.updateSettings({ deploymentMode: "solo" });
      setDraft(settingsDraft(next));
      onChange(next);
      setGatewayStatus({ mode: "solo", connected: true });
      onNotice(t("gatewayDisconnected"));
    } finally {
      setGatewayBusy(false);
    }
  }

  async function provisionGateway() {
    if (!selectedStoreId) return;
    setGatewayBusy(true);
    try {
      const latest = await window.pos.getStoreNetwork() as StoreNetwork[];
      applyStoreNetwork(latest);
      const store = latest.find((item) => item.id === selectedStoreId) ?? latest[0];
      if (!store?.cloudSyncEnabled || !store.cloudGatewayUrl) {
        onNotice(t("cloudGatewayNotConfigured"));
        return;
      }
      const credential = await window.pos.provisionStoreGateway({ storeId: store.id });
      setGatewayCredential(credential);
      onNotice(t("gatewayCredentialCreated"));
    } catch (value) {
      onNotice(localizeError(language, value));
    } finally {
      setGatewayBusy(false);
    }
  }

  async function copyGatewayCredential() {
    if (!gatewayCredential) return;
    await window.pos.copyText(`STORE_ID=${gatewayCredential.storeId}\nCLOUD_GATEWAY_URL=${gatewayCredential.cloudGatewayUrl}\nGATEWAY_TOKEN=${gatewayCredential.token}`);
    onNotice(t("gatewayCredentialCopied"));
  }

  const selectedStore = stores.find((store) => store.id === selectedStoreId);
  const cloudProvisioningReady = Boolean(selectedStore?.cloudSyncEnabled && selectedStore.cloudGatewayUrl);

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
            {t("sessionTimeout")}
            <select value={draft.localSessionTimeout} onChange={(event) => change("localSessionTimeout", event.target.value)}>
              <option value="5">5 {t("minutes")}</option>
              <option value="15">15 {t("minutes")}</option>
              <option value="30">30 {t("minutes")}</option>
              <option value="60">60 {t("minutes")}</option>
            </select>
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

        <section className="panel settings-section gateway-settings">
          <div className="section-title">
            <div className="section-icon"><Network /></div>
            <div><h3>{t("storeNetwork")}</h3><p>{t("storeNetworkHelp")}</p></div>
          </div>
          <div className={`gateway-status ${gatewayStatus?.connected ? "connected" : "disconnected"}`}>
            {gatewayStatus?.connected ? <ShieldCheck /> : <Unplug />}
            <div>
              <strong>{draft.deploymentMode === "multi" ? t(gatewayStatus?.connected ? "gatewayConnected" : "gatewayUnavailable") : t("soloMode")}</strong>
              <p>{draft.deploymentMode === "multi" ? (gatewayStatus?.error || t("multiPosModeHelp")) : t("soloModeHelp")}</p>
            </div>
          </div>
          <label>
            {t("gatewayAddress")}
            <input
              value={draft.gatewayUrl}
              disabled={draft.deploymentMode === "multi" && gatewayStatus?.connected}
              placeholder="http://192.168.1.10:3510"
              onChange={(event) => change("gatewayUrl", event.target.value)}
            />
          </label>
          {draft.deploymentMode !== "multi" || !gatewayStatus?.connected ? (
            <label>
              {t("pairingCode")}
              <input type="password" autoComplete="one-time-code" value={pairingCode} onChange={(event) => setPairingCode(event.target.value)} />
            </label>
          ) : null}
          <div className="gateway-actions">
            {draft.deploymentMode === "multi" && gatewayStatus?.connected ? (
              <button type="button" className="button secondary" disabled={gatewayBusy} onClick={disconnectGateway}><Unplug />{t("useSoloMode")}</button>
            ) : (
              <button type="button" className="button secondary" disabled={gatewayBusy || pairingCode.length < 4} onClick={pairGateway}>
                {gatewayBusy ? <LoaderCircle className="spin" /> : <Network />}{t("pairGateway")}
              </button>
            )}
            <button type="button" className="button ghost" disabled={gatewayBusy} onClick={loadGatewayStatus}><RefreshCw />{t("testConnection")}</button>
          </div>
          {draft.deploymentMode !== "multi" || !gatewayStatus?.connected ? (
            <div className="gateway-provision">
              <div>
                <strong>{t("gatewayServerSetup")}</strong>
                <p>{t("gatewayServerSetupHelp")}</p>
              </div>
              {stores.length > 1 ? (
                <select value={selectedStoreId} onChange={(event) => setSelectedStoreId(event.target.value)}>
                  {stores.map((store) => <option key={store.id} value={store.id}>{store.name}</option>)}
                </select>
              ) : null}
              {!cloudProvisioningReady ? (
                <div className="gateway-prerequisite" role="status">
                  <TriangleAlert />
                  <div>
                    <strong>{t("cloudGatewayRequiredTitle")}</strong>
                    <p>{t("cloudGatewayRequiredHelp")}</p>
                  </div>
                </div>
              ) : null}
              <button type="button" className="button ghost" disabled={gatewayBusy || !selectedStoreId} onClick={provisionGateway}>
                {gatewayBusy ? <LoaderCircle className="spin" /> : <ShieldCheck />}{t("generateGatewayCredential")}
              </button>
              {gatewayCredential ? (
                <div className="gateway-credential">
                  <p>{t("gatewayCredentialWarning")}</p>
                  <code>STORE_ID={gatewayCredential.storeId}<br />GATEWAY_TOKEN={gatewayCredential.token}</code>
                  <button type="button" className="button secondary" onClick={copyGatewayCredential}>{t("copyCredential")}</button>
                </div>
              ) : null}
            </div>
          ) : null}
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

        <section className="panel settings-section account-sessions-section">
          <div className="section-title">
            <div className="section-icon"><MonitorSmartphone /></div>
            <div><h3>{t("loggedInDevices")}</h3><p>{t("loggedInDevicesHelp")}</p></div>
          </div>
          {sessionsLoading ? <LoadingState label={t("loading")} compact /> : accountSessions.length ? (
            <div className="account-session-list">
              {accountSessions.map((session) => {
                const current = session.id === currentTokenId;
                return <div className="account-session-row" key={session.id}>
                  <div className="account-session-icon"><MonitorSmartphone /></div>
                  <div className="account-session-copy">
                    <strong>{session.deviceName || t("unknownDevice")}</strong>
                    <span>{session.platform || t("unknownPlatform")} · {new Date(session.lastSeenAt).toLocaleString()}</span>
                    {session.ipAddress ? <small>{session.ipAddress}{session.appVersion ? ` · v${session.appVersion}` : ""}</small> : null}
                  </div>
                  {current ? <span className="status-pill success">{t("thisDevice")}</span> : <button type="button" className="icon-button danger" title={t("signOutDevice")} onClick={() => void revokeSession(session.id)}><LogOut /></button>}
                </div>;
              })}
            </div>
          ) : <p className="muted-copy">{t("noLoggedInDevices")}</p>}
          <div className="gateway-actions">
            <button type="button" className="button ghost" disabled={sessionsLoading} onClick={loadAccountSessions}><RefreshCw />{t("refresh")}</button>
            {accountSessions.some((session) => session.id !== currentTokenId) ? <button type="button" className="button secondary danger" onClick={() => void revokeOtherSessions()}><LogOut />{t("signOutOtherDevices")}</button> : null}
          </div>
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
                <div className="receipt-control-group">
                  <div className="receipt-control-heading"><strong>{t("receiptPreset")}</strong><small>{t("receiptPresetHelp")}</small></div>
                  <div className="receipt-presets" role="group" aria-label={t("receiptPreset")}>
                    {(["compact", "standard", "detailed"] as const).map((preset) => (
                      <button key={preset} type="button" className={draft.receiptPreset === preset ? "active" : ""} onClick={() => applyReceiptPreset(preset)}>{t(preset)}</button>
                    ))}
                  </div>
                </div>
                <div className="receipt-control-group">
                  <div className="receipt-control-heading"><strong>{t("receiptLayout")}</strong><small>{t("receiptLayoutHelp")}</small></div>
                  <div className="two-fields">
                    <label>{t("paperWidth")}<select value={draft.receiptPaperWidth} onChange={(event) => changeReceipt("receiptPaperWidth", event.target.value)}><option value="58">58 mm</option><option value="80">80 mm</option></select></label>
                    <label>{t("receiptDensity")}<select value={draft.receiptDensity} onChange={(event) => changeReceipt("receiptDensity", event.target.value)}><option value="compact">{t("compact")}</option><option value="standard">{t("standard")}</option><option value="comfortable">{t("comfortable")}</option></select></label>
                    <label>{t("receiptTextSize")}<select value={draft.receiptTextSize} onChange={(event) => changeReceipt("receiptTextSize", event.target.value)}><option value="small">{t("small")}</option><option value="standard">{t("standard")}</option><option value="large">{t("large")}</option></select></label>
                    <label>{t("receiptMargin")}<select value={draft.receiptMargin} onChange={(event) => changeReceipt("receiptMargin", event.target.value)}><option value="small">{t("small")}</option><option value="standard">{t("standard")}</option><option value="large">{t("large")}</option></select></label>
                    <label>{t("receiptLogoSize")}<select value={draft.receiptLogoSize} onChange={(event) => changeReceipt("receiptLogoSize", event.target.value)}><option value="small">{t("small")}</option><option value="medium">{t("medium")}</option><option value="large">{t("large")}</option></select></label>
                  </div>
                </div>
                <div className="receipt-control-group">
                  <div className="receipt-control-heading"><strong>{t("invoiceCode")}</strong><small>{t("invoiceCodeHelp")}</small></div>
                  <div className="two-fields">
                    <label>{t("codeType")}<select value={draft.receiptCodeType} onChange={(event) => changeReceipt("receiptCodeType", event.target.value)}><option value="none">{t("noCode")}</option><option value="qr">{t("qrCode")}</option><option value="barcode">{t("barcode")}</option><option value="both">{t("qrAndBarcode")}</option></select></label>
                    <label>{t("codePosition")}<select disabled={draft.receiptCodeType === "none"} value={draft.receiptCodePosition} onChange={(event) => changeReceipt("receiptCodePosition", event.target.value)}><option value="header">{t("belowHeader")}</option><option value="beforeTotals">{t("beforeTotals")}</option><option value="footer">{t("afterTotals")}</option></select></label>
                    <label>{t("codeAlignment")}<select disabled={draft.receiptCodeType === "none"} value={draft.receiptCodeAlignment} onChange={(event) => changeReceipt("receiptCodeAlignment", event.target.value)}><option value="start">{t("alignStart")}</option><option value="center">{t("alignCenter")}</option><option value="end">{t("alignEnd")}</option></select></label>
                  </div>
                </div>
                <label>{t("receiptHeader")}<textarea value={draft.receiptHeader || ""} onChange={(event) => change("receiptHeader", event.target.value)} /></label>
                <label>{t("receiptFooter")}<textarea value={draft.receiptFooter || ""} onChange={(event) => change("receiptFooter", event.target.value)} /></label>
                <Toggle label={t("showLogo")} value={draft.receiptShowLogo} onChange={(value) => changeReceipt("receiptShowLogo", value)} />
                <Toggle label={t("showCustomer")} value={draft.receiptShowCustomer} onChange={(value) => changeReceipt("receiptShowCustomer", value)} />
                <Toggle label={t("showNote")} value={draft.receiptShowNote} onChange={(value) => changeReceipt("receiptShowNote", value)} />
                <Toggle label={t("showSku")} value={draft.receiptShowSku} onChange={(value) => changeReceipt("receiptShowSku", value)} />
                <Toggle label={t("showTenderedChange")} value={draft.receiptShowTendered} onChange={(value) => changeReceipt("receiptShowTendered", value)} />
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
              {previewLoading ? <LoadingState label={t("updatingPreview")} compact /> : <iframe key={`${tab}-${previewRevision}`} title={t("livePreview")} srcDoc={previewHtml} sandbox="" />}
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
