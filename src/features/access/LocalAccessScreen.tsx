import { useState } from "react";
import { ArrowLeft, KeyRound, LoaderCircle, LockKeyhole, ShieldCheck, UserRound, X } from "lucide-react";
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
  const [recovering, setRecovering] = useState(false);

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

  async function recover(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError("");
    const data = new FormData(event.currentTarget);
    const secret = String(data.get("newSecret"));
    try {
      if (secret !== String(data.get("confirmNewSecret")))
        throw new Error(t("accessCodesDoNotMatch"));
      const result = await window.pos.recoverLocalOwner({
        username: String(data.get("recoveryUsername")),
        partnerPassword: String(data.get("partnerPassword")),
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
        {!setupRequired ? <button type="button" className="button ghost full" disabled={busy} onClick={() => { setError(""); setRecovering(true); }}>{t("forgotAccessCode")}</button> : null}
        <small className="access-footnote">{t("localAccessFootnote")}</small>
      </form>
      {recovering ? (
        <div className="modal-backdrop" onMouseDown={(event) => event.target === event.currentTarget && !busy && setRecovering(false)}>
          <form className="modal-card local-recovery-card" onSubmit={recover}>
            <div className="dialog-heading"><div><p className="eyebrow">Shea POS</p><h2>{t("recoverAccessCode")}</h2></div><button type="button" className="icon-button" aria-label={t("close")} disabled={busy} onClick={() => setRecovering(false)}><X /></button></div>
            <p>{t("recoverAccessCodeText")}</p>
            <label>{t("ownerUsername")}<input name="recoveryUsername" autoComplete="username" required autoFocus /></label>
            <label>{t("partnerAccountPassword")}<input name="partnerPassword" type="password" autoComplete="current-password" required /></label>
            <label>{t("newAccessCode")}<input name="newSecret" type="password" minLength={4} autoComplete="new-password" required /></label>
            <label>{t("confirmAccessCode")}<input name="confirmNewSecret" type="password" minLength={4} autoComplete="new-password" required /></label>
            {error ? <div className="form-error">{error}</div> : null}
            <div className="dialog-actions"><button type="button" className="button secondary" disabled={busy} onClick={() => setRecovering(false)}>{t("cancel")}</button><button className="button primary" disabled={busy}>{busy ? <LoaderCircle className="spin" /> : <ShieldCheck />}{busy ? t("pleaseWait") : t("verifyAndReset")}</button></div>
          </form>
        </div>
      ) : null}
    </div>
  );
}
