import { useEffect, useState } from "react";
import { ArrowLeft, ArrowRight, Check, History, KeyRound, LoaderCircle, Pencil, Plus, ShieldCheck, UserRound, UsersRound, X } from "lucide-react";
import type { LocalRole, Permission } from "../../../electron/contracts";
import { ErrorState, LoadingState } from "../../components/AsyncState";
import { EmptyState } from "../../components/EmptyState";
import { PageHeader } from "../../components/PageHeader";
import { localeFor, localizeError, localizeValue, useI18n } from "../../i18n";

const roles: LocalRole[] = ["OWNER", "MANAGER", "CASHIER", "STOCK_CLERK", "CUSTOM"];
type Draft = { name: string; username: string; secret: string; active: boolean };

export function TeamScreen({ onNotice }: { onNotice: (message: string) => void }) {
  const { t, language } = useI18n();
  const [tab, setTab] = useState<"users" | "audit">("users");
  const [users, setUsers] = useState<any[]>([]);
  const [audit, setAudit] = useState<any[]>([]);
  const [model, setModel] = useState<{ permissions: Permission[]; rolePermissions: Record<LocalRole, Permission[]> } | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [editing, setEditing] = useState<any | "new" | null>(null);
  const [resetting, setResetting] = useState<any | null>(null);
  const [step, setStep] = useState<1 | 2>(1);
  const [draft, setDraft] = useState<Draft>({ name: "", username: "", secret: "", active: true });
  const [role, setRole] = useState<LocalRole>("CASHIER");
  const [granted, setGranted] = useState<Permission[]>([]);
  const [saving, setSaving] = useState(false);

  const load = async () => {
    setLoading(true);
    setError("");
    try {
      const [userRows, auditRows, accessModel] = await Promise.all([
        window.pos.listLocalUsers(), window.pos.listAuditLogs(), window.pos.getAccessModel(),
      ]);
      setUsers(userRows as any[]);
      setAudit(auditRows as any[]);
      setModel(accessModel);
    } catch (value) { setError(localizeError(language, value)); }
    finally { setLoading(false); }
  };
  useEffect(() => { void load(); }, []);

  function openEditor(user: any | "new") {
    const nextRole = user === "new" ? "CASHIER" : user.role as LocalRole;
    setDraft(user === "new" ? { name: "", username: "", secret: "", active: true } : { name: user.name, username: user.username, secret: "", active: user.active });
    setRole(nextRole);
    setGranted(user === "new" ? model?.rolePermissions.CASHIER ?? [] : user.permissions);
    setStep(1);
    setEditing(user);
  }
  function selectRole(value: LocalRole) {
    setRole(value);
    if (value !== "CUSTOM") setGranted(model?.rolePermissions[value] ?? []);
  }
  function togglePermission(permission: Permission) {
    setRole("CUSTOM");
    setGranted((current) => current.includes(permission) ? current.filter((value) => value !== permission) : [...current, permission]);
  }
  async function saveUser() {
    if (!editing) return;
    setSaving(true);
    try {
      if (editing === "new") await window.pos.createLocalUser({ ...draft, role, permissions: granted });
      else await window.pos.updateLocalUser({ id: editing.id, name: draft.name, username: draft.username, role, permissions: granted, active: draft.active });
      setEditing(null);
      onNotice(editing === "new" ? t("userCreated") : t("userUpdated"));
      await load();
    } catch (value) { onNotice(localizeError(language, value)); }
    finally { setSaving(false); }
  }
  async function resetSecret(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    if (String(data.get("secret")) !== String(data.get("confirmSecret"))) return onNotice(t("accessCodesDoNotMatch"));
    setSaving(true);
    try {
      await window.pos.resetLocalUserSecret({ id: resetting.id, secret: String(data.get("secret")) });
      setResetting(null); onNotice(t("accessCodeReset")); await load();
    } catch (value) { onNotice(localizeError(language, value)); }
    finally { setSaving(false); }
  }

  return <div className="page-stack team-page">
    <PageHeader eyebrow={t("security")} title={t("teamAccess")} description={t("teamAccessText")} actions={tab === "users" ? <button className="button primary" onClick={() => openEditor("new")}><Plus />{t("addUser")}</button> : undefined} />
    <div className="segmented team-tabs"><button className={tab === "users" ? "active" : ""} onClick={() => setTab("users")}><UsersRound />{t("users")}</button><button className={tab === "audit" ? "active" : ""} onClick={() => setTab("audit")}><History />{t("auditLog")}</button></div>
    {loading ? <LoadingState label={t("loadingData")} /> : error ? <ErrorState title={t("unableToLoad")} text={error} retryLabel={t("retry")} onRetry={() => void load()} /> : tab === "users" ? (
      users.length ? <div className="team-grid">{users.map((user) => <article className={`panel user-card ${user.active ? "" : "disabled"}`} key={user.id}>
        <div className="user-avatar"><UserRound /></div><div className="user-card-copy"><div><h3>{user.name}</h3><em className="badge">{localizeValue(language, user.role)}</em></div><p>@{user.username}</p><small>{user.permissions.length} {t("permissions")} · {user.lastLoginAt ? `${t("lastLogin")} ${new Date(user.lastLoginAt).toLocaleString(localeFor(language))}` : t("neverLoggedIn")}</small></div>
        <div className="user-card-actions"><button className="icon-button" title={t("resetAccessCode")} onClick={() => setResetting(user)}><KeyRound /></button><button className="icon-button" title={t("edit")} onClick={() => openEditor(user)}><Pencil /></button></div>
      </article>)}</div> : <EmptyState icon={UsersRound} title={t("noUsers")} text={t("noUsersText")} />
    ) : audit.length ? <div className="panel table-panel"><div className="table"><div className="table-row audit-row table-head"><span>{t("date")}</span><span>{t("user")}</span><span>{t("action")}</span><span>{t("target")}</span></div>{audit.map((row) => <div className="table-row audit-row" key={row.id}><span>{new Date(row.created_at).toLocaleString(localeFor(language))}</span><span><strong>{row.user_name}</strong></span><span>{localizeValue(language, row.action)}</span><span>{row.entity_type ? `${row.entity_type}${row.entity_id ? ` · ${row.entity_id}` : ""}` : "-"}</span></div>)}</div></div> : <EmptyState icon={History} title={t("noAuditEvents")} text={t("noAuditEventsText")} />}

    {editing && model ? <div className="modal-backdrop" onMouseDown={(event) => event.target === event.currentTarget && !saving && setEditing(null)}><div className="modal-card user-editor">
      <div className="receipt-preview-heading"><div><p className="eyebrow">{t("stepOf").replace("{current}", String(step)).replace("{total}", "2")}</p><h2>{editing === "new" ? t("addUser") : t("editUser")}</h2></div><button type="button" className="icon-button" onClick={() => setEditing(null)}><X /></button></div>
      <div className="wizard-progress"><span className={step >= 1 ? "active" : ""}>{t("identity")}</span><i /><span className={step >= 2 ? "active" : ""}>{t("accessAndRole")}</span></div>
      {step === 1 ? <form className="user-wizard-step" onSubmit={(event) => { event.preventDefault(); setStep(2); }}>
        <div className="two-fields"><label>{t("displayName")}<input required autoFocus value={draft.name} onChange={(event) => setDraft({ ...draft, name: event.target.value })} /></label><label>{t("username")}<input required pattern="[a-zA-Z0-9._-]+" value={draft.username} onChange={(event) => setDraft({ ...draft, username: event.target.value })} /></label></div>
        {editing === "new" ? <label>{t("accessCode")}<input type="password" minLength={4} required value={draft.secret} onChange={(event) => setDraft({ ...draft, secret: event.target.value })} /></label> : <label className="setting-toggle"><span><strong>{t("accountActive")}</strong><small>{t("accountActiveText")}</small></span><input type="checkbox" checked={draft.active} onChange={(event) => setDraft({ ...draft, active: event.target.checked })} /></label>}
        <div className="dialog-actions"><button type="button" className="button secondary" onClick={() => setEditing(null)}>{t("cancel")}</button><button className="button primary">{t("continue")}<ArrowRight /></button></div>
      </form> : <div className="user-wizard-step">
        <div><p className="field-title">{t("chooseRole")}</p><div className="role-grid">{roles.map((value) => <button type="button" className={role === value ? "selected" : ""} onClick={() => selectRole(value)} key={value}><ShieldCheck /><span><strong>{localizeValue(language, value)}</strong><small>{t(roleDescriptionKey(value))}</small></span>{role === value ? <Check /> : null}</button>)}</div></div>
        <div><p className="field-title">{t("permissions")}</p><div className="permission-grid">{model.permissions.map((permission) => <label className={granted.includes(permission) ? "selected" : ""} key={permission}><input type="checkbox" checked={granted.includes(permission)} onChange={() => togglePermission(permission)} /><ShieldCheck /><span>{permissionLabel(t, permission)}</span></label>)}</div></div>
        <div className="dialog-actions"><button type="button" className="button secondary" onClick={() => setStep(1)}><ArrowLeft />{t("back")}</button><button type="button" className="button primary" disabled={saving || !granted.length} onClick={() => void saveUser()}>{saving ? <LoaderCircle className="spin" /> : <Check />}{saving ? t("saving") : t("saveUser")}</button></div>
      </div>}
    </div></div> : null}
    {resetting ? <div className="modal-backdrop" onMouseDown={(event) => event.target === event.currentTarget && !saving && setResetting(null)}><form className="modal-card reset-code-dialog" onSubmit={resetSecret}><p className="eyebrow">{t("security")}</p><h2>{t("resetAccessCode")}</h2><p>{resetting.name}</p><label>{t("newAccessCode")}<input name="secret" type="password" minLength={4} required autoFocus /></label><label>{t("confirmAccessCode")}<input name="confirmSecret" type="password" minLength={4} required /></label><div className="dialog-actions"><button type="button" className="button secondary" onClick={() => setResetting(null)}>{t("cancel")}</button><button className="button primary" disabled={saving}>{saving ? <LoaderCircle className="spin" /> : <KeyRound />}{t("reset")}</button></div></form></div> : null}
  </div>;
}

function roleDescriptionKey(role: LocalRole): Parameters<ReturnType<typeof useI18n>["t"]>[0] {
  return ({ OWNER: "roleOwnerText", MANAGER: "roleManagerText", CASHIER: "roleCashierText", STOCK_CLERK: "roleStockClerkText", CUSTOM: "roleCustomText" } as const)[role];
}

function permissionLabel(t: ReturnType<typeof useI18n>["t"], permission: Permission) {
  const keys: Record<Permission, Parameters<typeof t>[0]> = {
    POS_SELL: "permissionPosSell", REGISTER_MANAGE: "permissionRegister", ORDERS_VIEW: "permissionOrders",
    INVOICES_VIEW: "permissionInvoices", SALES_REFUND: "permissionRefunds", INVENTORY_VIEW: "permissionInventoryView", INVENTORY_MANAGE: "permissionInventoryManage",
    STOCK_RECEIVE: "permissionStockReceive", CATALOG_REQUEST: "permissionCatalog", REPORTS_VIEW: "permissionReports",
    SETTINGS_MANAGE: "permissionSettings", SYNC_MANAGE: "permissionSync", USERS_MANAGE: "permissionUsers",
    CUSTOM_ORDERS_VIEW: "permissionCustomOrdersView", CUSTOM_ORDERS_MANAGE: "permissionCustomOrdersManage",
  };
  return t(keys[permission]);
}
