import { useState } from "react";
import { ArrowLeft, KeyRound, LoaderCircle, LockKeyhole, ShieldCheck, UserRound } from "lucide-react";
import { localizeError, useI18n } from "../../i18n";
import type { AppState } from "../../types";

export function LocalAccessScreen({
  setupRequired,
  onSuccess,
  canGoBack = false,
  onBack,
  onLock,
}: {
  setupRequired: boolean;
  onSuccess: (state: AppState) => void;
  canGoBack?: boolean;
  onBack?: () => void;
  onLock?: () => Promise<void> | void;
}) {
  const { t, language } = useI18n();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError("");
    const data = new FormData(event.currentTarget);
    try {
      const secret = String(data.get("secret"));
      if (setupRequired && secret !== String(data.get("confirmSecret")))
        throw new Error(t("accessCodesDoNotMatch"));
      const result = setupRequired
        ? await window.pos.setupLocalOwner({
            name: String(data.get("name")),
            username: String(data.get("username")),
            secret,
          })
        : await window.pos.localLogin({
            username: String(data.get("username")),
            secret,
          });
      onSuccess(result as AppState);
    } catch (value) {
      setError(localizeError(language, value));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="login local-access-screen">
      <form className="login-card local-access-card" onSubmit={submit}>
        {canGoBack ? <div className="access-navigation"><button type="button" className="button ghost" onClick={onBack}><ArrowLeft />{t("backToWorkspace")}</button><button type="button" className="button ghost danger" onClick={() => void onLock?.()}><LockKeyhole />{t("lockWorkspace")}</button></div> : null}
        <div className="access-hero-icon">
          {setupRequired ? <ShieldCheck /> : <KeyRound />}
        </div>
        <p className="eyebrow">Shea POS</p>
        <h2>{setupRequired ? t("createGlobalAdmin") : canGoBack ? t("switchOperator") : t("unlockWorkspace")}</h2>
        <p>{setupRequired ? t("createGlobalAdminText") : canGoBack ? t("switchOperatorText") : t("unlockWorkspaceText")}</p>
        {setupRequired ? (
          <label>
            {t("displayName")}
            <span className="input-with-icon"><UserRound /><input name="name" required autoFocus /></span>
          </label>
        ) : null}
        <label>
          {t("username")}
          <span className="input-with-icon"><UserRound /><input name="username" autoComplete="username" required autoFocus={!setupRequired} /></span>
        </label>
        <label>
          {t("accessCode")}
          <span className="input-with-icon"><KeyRound /><input name="secret" type="password" minLength={4} autoComplete={setupRequired ? "new-password" : "current-password"} required /></span>
        </label>
        {setupRequired ? <label>{t("confirmAccessCode")}<input name="confirmSecret" type="password" minLength={4} autoComplete="new-password" required /></label> : null}
        {error ? <div className="form-error">{error}</div> : null}
        <button className="button primary full" disabled={busy}>
          {busy ? <LoaderCircle className="spin" /> : setupRequired ? <ShieldCheck /> : <KeyRound />}
          {busy ? t("pleaseWait") : setupRequired ? t("createAdmin") : canGoBack ? t("switchAndContinue") : t("unlock")}
        </button>
        <small className="access-footnote">{t("localAccessFootnote")}</small>
      </form>
    </div>
  );
}
