import { useState } from "react";
import { ArrowRight, Database, LoaderCircle, Network, Server } from "lucide-react";
import { localizeError, useI18n } from "../../i18n";

export function DeploymentSetupScreen({ onComplete }: { onComplete: (settings: Record<string, string>) => void }) {
  const { t, language } = useI18n();
  const [mode, setMode] = useState<"solo" | "multi">("solo");
  const [gatewayUrl, setGatewayUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      onComplete(await window.pos.configureDeployment({ mode, gatewayUrl: mode === "multi" ? gatewayUrl : undefined }));
    } catch (value) {
      setError(localizeError(language, value));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="deployment-setup">
      <form className="deployment-card" onSubmit={submit}>
        <div className="deployment-mark"><Server /></div>
        <p className="eyebrow">Shea POS</p>
        <h1>{t("chooseDeploymentTitle")}</h1>
        <p className="deployment-intro">{t("chooseDeploymentText")}</p>
        <div className="deployment-options">
          <button type="button" className={`deployment-option ${mode === "solo" ? "selected" : ""}`} onClick={() => setMode("solo")}>
            <Database /><span><strong>{t("singleRegister")}</strong><small>{t("singleRegisterHelp")}</small></span>
          </button>
          <button type="button" className={`deployment-option ${mode === "multi" ? "selected" : ""}`} onClick={() => setMode("multi")}>
            <Network /><span><strong>{t("multipleRegisters")}</strong><small>{t("multipleRegistersHelp")}</small></span>
          </button>
        </div>
        {mode === "multi" ? <label>{t("gatewayAddress")}<input type="url" value={gatewayUrl} onChange={(event) => setGatewayUrl(event.target.value)} placeholder="http://192.168.1.10:3510" required autoFocus /></label> : null}
        {error ? <div className="form-error">{error}</div> : null}
        <button className="button primary full" disabled={busy}>{busy ? <LoaderCircle className="spin" /> : <ArrowRight />}{t("continue")}</button>
        <small>{t("deploymentCanChangeLater")}</small>
      </form>
    </div>
  );
}
