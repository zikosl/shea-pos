import { useEffect, useState } from "react";
import {
  BarChart3,
  Boxes,
  Cloud,
  CloudOff,
  Download as DownloadIcon,
  FileClock,
  Gift,
  Keyboard,
  Languages,
  LoaderCircle,
  LogOut,
  PackagePlus,
  PanelLeftClose,
  PanelLeftOpen,
  ReceiptText,
  RefreshCw,
  Settings,
  ShoppingBag,
  UsersRound,
  UserRoundCog,
} from "lucide-react";
import { CatalogRequestsScreen } from "./features/catalog/CatalogRequestsScreen";
import { InvoicesScreen, OrdersScreen } from "./features/history/HistoryScreens";
import { InventoryScreen } from "./features/inventory/InventoryScreen";
import { StockEntriesScreen } from "./features/inventory/StockEntriesScreen";
import { PosScreen } from "./features/pos/PosScreen";
import { SettingsScreen } from "./features/settings/SettingsScreen";
import { ReportsScreen } from "./features/reports/ReportsScreen";
import { LocalAccessScreen } from "./features/access/LocalAccessScreen";
import { TeamScreen } from "./features/access/TeamScreen";
import { GiftStoreScreen } from "./features/gift-store/GiftStoreScreen";
import {
  I18nProvider,
  localeFor,
  localizeError,
  translate,
  type Language,
} from "./i18n";
import type { AppState } from "./types";
import type { Permission, UpdateStatus } from "../electron/contracts";
import { ErrorState } from "./components/AsyncState";
import {
  KeyboardShortcuts,
  type KeyboardShortcut,
} from "./components/KeyboardShortcuts";
import { CommandPalette, type CommandItem } from "./components/CommandPalette";

type Page =
  "pos" | "stock" | "entries" | "gifts" | "orders" | "sales" | "reports" | "requests" | "team" | "settings";
const emptyState: AppState = {
  authenticated: false,
  user: null,
  partner: null,
  device: null,
  lastSyncAt: null,
  lastSyncError: null,
  offlineUntil: null,
  offlineAllowed: false,
  pendingChanges: 0,
  capabilities: [],
  localAccess: {
    setupRequired: false,
    authenticated: false,
    user: null,
    permissions: [],
  },
};

const pagePermission: Record<Page, Permission> = {
  pos: "POS_SELL",
  stock: "INVENTORY_VIEW",
  entries: "STOCK_RECEIVE",
  gifts: "CUSTOM_ORDERS_VIEW",
  orders: "ORDERS_VIEW",
  sales: "INVOICES_VIEW",
  reports: "REPORTS_VIEW",
  requests: "CATALOG_REQUEST",
  team: "USERS_MANAGE",
  settings: "SETTINGS_MANAGE",
};

function firstAllowedPage(granted: Permission[]): Page {
  const preferred: Page[] = ["pos", "gifts", "orders", "stock", "entries", "sales", "reports", "requests", "team", "settings"];
  return preferred.find((candidate) => granted.includes(pagePermission[candidate])) ?? "pos";
}

export default function App() {
  const [state, setState] = useState<AppState>(emptyState);
  const [ready, setReady] = useState(false);
  const [page, setPage] = useState<Page>("pos");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [settings, setSettings] = useState<Record<string, string>>({});
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [bootError, setBootError] = useState("");
  const [switchingOperator, setSwitchingOperator] = useState(false);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const [commandOpen, setCommandOpen] = useState(false);
  const [update, setUpdate] = useState<UpdateStatus>({ status: "idle" });
  const language = (settings.language === "ar" ? "ar" : "en") as Language;
  const t = (key: Parameters<typeof translate>[1]) => translate(language, key);

  const refreshState = async () =>
    setState((await window.pos.getState()) as AppState);
  const initialize = async () => {
    setReady(false);
    setBootError("");
    try {
      await Promise.all([
        refreshState(),
        window.pos.getSettings().then((value) => {
          setSettings(value);
          setSidebarCollapsed(value.sidebarCollapsed === "true");
        }),
      ]);
    } catch (value) {
      setBootError(localizeError(language, value));
    } finally {
      setReady(true);
    }
  };
  useEffect(() => {
    void initialize();
  }, []);
  useEffect(() => {
    const unsubscribe = window.pos.onUpdateStatus(setUpdate);
    void window.pos.updateStatus().then(setUpdate).catch(() => undefined);
    return unsubscribe;
  }, []);
  useEffect(() => {
    if (!state.authenticated || !state.localAccess.authenticated) return;
    const timer = window.setInterval(() => void refreshState(), 30_000);
    let lastTouch = 0;
    const touch = () => {
      if (Date.now() - lastTouch < 30_000) return;
      lastTouch = Date.now();
      void window.pos.localTouch().catch(() => void refreshState());
    };
    window.addEventListener("pointerdown", touch);
    window.addEventListener("keydown", touch);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener("pointerdown", touch);
      window.removeEventListener("keydown", touch);
    };
  }, [state.authenticated, state.localAccess.authenticated]);
  useEffect(() => {
    if (
      state.localAccess.authenticated &&
      !state.localAccess.permissions.includes(pagePermission[page])
    )
      setPage(firstAllowedPage(state.localAccess.permissions));
  }, [page, state.localAccess.authenticated, state.localAccess.permissions]);
  useEffect(() => {
    const theme = settings.theme || "system";
    const media = matchMedia("(prefers-color-scheme: dark)");
    const applyTheme = () => {
      const dark = theme === "dark" || (theme === "system" && media.matches);
      document.documentElement.dataset.theme = dark ? "dark" : "light";
    };
    applyTheme();
    media.addEventListener("change", applyTheme);
    document.documentElement.style.setProperty(
      "--primary",
      settings.primaryColor || "#2f6fed",
    );
    document.documentElement.dir = settings.language === "ar" ? "rtl" : "ltr";
    document.documentElement.lang = settings.language || "en";
    return () => media.removeEventListener("change", applyTheme);
  }, [settings.theme, settings.primaryColor, settings.language]);
  useEffect(() => {
    if (!shortcutsOpen) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      setShortcutsOpen(false);
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [shortcutsOpen]);

  async function sync() {
    setBusy(true);
    setNotice("");
    try {
      const synced = (await window.pos.sync({ forceRetry: true })) as Partial<AppState>;
      // Sync refreshes server data; the local operator session stays active.
      setState((current) => ({ ...current, ...synced, localAccess: current.localAccess }));
      setNotice(t("everythingUpToDate"));
    } catch (error) {
      setNotice(localizeError(language, error));
      await refreshState();
    } finally {
      setBusy(false);
    }
  }

  async function toggleSidebar() {
    const next = !sidebarCollapsed;
    setSidebarCollapsed(next);
    setSettings((current) => ({
      ...current,
      sidebarCollapsed: String(next),
    }));
    try {
      setSettings(
        await window.pos.updateSettings({ sidebarCollapsed: String(next) }),
      );
    } catch (error) {
      setNotice(localizeError(language, error));
      setSidebarCollapsed(!next);
      setSettings((current) => ({
        ...current,
        sidebarCollapsed: String(!next),
      }));
    }
  }

  async function logout() {
    if (!window.confirm(t("logoutConfirm"))) return;
    setBusy(true);
    try {
      await window.pos.signOut();
      setSwitchingOperator(false);
      setState(emptyState);
      setPage("pos");
      setNotice("");
    } catch (value) {
      setNotice(localizeError(language, value));
    } finally {
      setBusy(false);
    }
  }

  async function updateAction() {
    try {
      if (update.status === "available") setUpdate(await window.pos.downloadUpdate());
      else if (update.status === "downloaded") await window.pos.installUpdate();
      else setUpdate(await window.pos.checkForUpdate());
    } catch (value) {
      setNotice(localizeError(language, value));
    }
  }

  if (!ready)
    return (
      <Centered>
        <LoaderCircle className="spin" />
        <p>{t("openingWorkspace")}</p>
      </Centered>
    );
  if (bootError)
    return (
      <I18nProvider language={language}>
        <Centered>
          <ErrorState
            title={t("unableToLoad")}
            text={bootError || t("tryAgainText")}
            retryLabel={t("retry")}
            onRetry={() => void initialize()}
          />
        </Centered>
      </I18nProvider>
    );
  if (!state.authenticated)
    return (
      <I18nProvider language={language}>
        <Login
          language={language}
          onLanguage={async (value) =>
            setSettings(
              await window.pos.updateSettings({ ...settings, language: value }),
            )
          }
          onSuccess={(value) => {
            setState(value);
            setNotice(t("posActivated"));
          }}
        />
      </I18nProvider>
    );

  if (!state.localAccess.authenticated)
    return (
      <I18nProvider language={language}>
        <LocalAccessScreen
          setupRequired={state.localAccess.setupRequired}
          onSuccess={(value) => {
            const next = value as AppState;
            setState(next);
            setPage(firstAllowedPage(next.localAccess.permissions));
          }}
        />
      </I18nProvider>
    );

  const can = (permission: Permission) =>
    state.localAccess.permissions.includes(permission);

  const navigation = [
    { id: "pos", label: t("sell"), icon: ShoppingBag, permission: "POS_SELL" },
    { id: "stock", label: t("inventory"), icon: Boxes, permission: "INVENTORY_VIEW" },
    { id: "entries", label: t("stockEntries"), icon: PackagePlus, permission: "STOCK_RECEIVE" },
    ...(state.capabilities.includes("CUSTOM_ORDERS") ? [{ id: "gifts" as const, label: t("customOrders"), icon: Gift, permission: "CUSTOM_ORDERS_VIEW" as const }] : []),
    { id: "orders", label: t("orders"), icon: FileClock, permission: "ORDERS_VIEW" },
    { id: "sales", label: t("invoices"), icon: ReceiptText, permission: "INVOICES_VIEW" },
    { id: "reports", label: t("reports"), icon: BarChart3, permission: "REPORTS_VIEW" },
    { id: "requests", label: t("requests"), icon: PackagePlus, permission: "CATALOG_REQUEST" },
    { id: "team", label: t("team"), icon: UsersRound, permission: "USERS_MANAGE" },
    { id: "settings", label: t("settings"), icon: Settings, permission: "SETTINGS_MANAGE" },
  ].filter((item) => can(item.permission as Permission)) as Array<{ id: Page; label: string; icon: typeof ShoppingBag; permission: string }>;

  const navigationKeys: Partial<Record<Page, string>> = {
    pos: "1",
    stock: "2",
    entries: "3",
    gifts: "4",
    orders: "5",
    sales: "6",
    reports: "7",
    requests: "8",
    settings: "9",
    team: "0",
  };
  const openPage = (target: Page) => {
    if (navigation.some((item) => item.id === target)) setPage(target);
  };
  const focusPageSearch = () => {
    const input = document.querySelector<HTMLInputElement>(
      "[data-keyboard-search]:not([disabled])",
    );
    input?.focus();
    input?.select();
  };
  const shortcuts: KeyboardShortcut[] = [
    ...navigation.flatMap((item) => {
      const key = navigationKeys[item.id];
      return key
        ? [{
          id: `page-${item.id}`,
          key,
          alt: true,
          allowInField: true,
          run: () => openPage(item.id),
        }]
        : [];
    }),
    {
      id: "search",
      key: "k",
      primary: true,
      allowInField: true,
      run: () => setCommandOpen(true),
    },
    {
      id: "search-f2",
      key: "F2",
      allowInField: true,
      run: focusPageSearch,
    },
    {
      id: "sync",
      key: "s",
      primary: true,
      shift: true,
      allowInField: true,
      enabled: can("SYNC_MANAGE"),
      run: () => void sync(),
    },
    {
      id: "settings",
      key: ",",
      primary: true,
      allowInField: true,
      enabled: can("SETTINGS_MANAGE"),
      run: () => openPage("settings"),
    },
    {
      id: "operator",
      key: "l",
      primary: true,
      shift: true,
      allowInField: true,
      run: () => setSwitchingOperator(true),
    },
    {
      id: "sidebar",
      key: "b",
      primary: true,
      allowInField: true,
      run: () => void toggleSidebar(),
    },
    {
      id: "help",
      key: "F1",
      allowInField: true,
      run: () => setShortcutsOpen(true),
    },
  ];
  const commandGroups = {
    navigation: language === "ar" ? "التنقل" : "Navigation",
    actions: language === "ar" ? "الإجراءات" : "Actions",
    system: language === "ar" ? "النظام" : "System",
  };
  const commands: CommandItem[] = [
    ...navigation.map((item) => ({ id: `command-${item.id}`, label: item.label, group: commandGroups.navigation, icon: item.icon, run: () => openPage(item.id) })),
    { id: "command-sync", label: t("sync"), group: commandGroups.actions, icon: RefreshCw, shortcut: "Ctrl ⇧ S", run: () => void sync() },
    { id: "command-search", label: t("focusSearch"), group: commandGroups.actions, icon: Keyboard, shortcut: "F2", run: focusPageSearch },
    { id: "command-operator", label: t("switchOperator"), group: commandGroups.actions, icon: UserRoundCog, shortcut: "Ctrl ⇧ L", run: () => setSwitchingOperator(true) },
    { id: "command-sidebar", label: sidebarCollapsed ? t("expandSidebar") : t("collapseSidebar"), group: commandGroups.system, icon: sidebarCollapsed ? PanelLeftOpen : PanelLeftClose, shortcut: "Ctrl B", run: () => void toggleSidebar() },
    { id: "command-shortcuts", label: t("keyboardShortcuts"), group: commandGroups.system, icon: Keyboard, shortcut: "F1", run: () => setShortcutsOpen(true) },
    { id: "command-logout", label: t("signOut"), group: commandGroups.system, icon: LogOut, run: () => void logout() },
  ].filter((command) => command.id !== "command-sync" || can("SYNC_MANAGE"));

  return (
    <I18nProvider language={language}>
      <CommandPalette open={commandOpen} onClose={() => setCommandOpen(false)} commands={commands} placeholder={t("commandPalette")} emptyText={t("noMatchingCommands")} navigateText={t("navigate")} selectText={t("select")} />
      <div
        className={`shell ${page === "pos" ? "pos-mode" : ""} ${sidebarCollapsed ? "sidebar-collapsed" : ""}`}
      >
        <KeyboardShortcuts
          shortcuts={shortcuts}
          active={!switchingOperator && !shortcutsOpen && !commandOpen}
        />
        <aside className="sidebar">
          <button
            type="button"
            className="sidebar-toggle"
            aria-label={
              sidebarCollapsed ? t("expandSidebar") : t("collapseSidebar")
            }
            title={sidebarCollapsed ? t("expandSidebar") : t("collapseSidebar")}
            onClick={() => void toggleSidebar()}
          >
            {sidebarCollapsed ? <PanelLeftOpen /> : <PanelLeftClose />}
          </button>
          <div className="brand">
            {settings.storeLogo ? (
              <img className="brand-logo" src={settings.storeLogo} alt="" />
            ) : (
              <span className="brand-mark">S</span>
            )}
            <div>
              <strong>
                {settings.storeName || state.partner?.companyName || "Shea POS"}
              </strong>
              <small>{t("workspace")}</small>
            </div>
          </div>
          <nav>
            {navigation.map((item) => (
              <button
                key={item.id}
                className={page === item.id ? "active" : ""}
                onClick={() => setPage(item.id)}
                title={`${item.label}${navigationKeys[item.id] ? ` (Alt+${navigationKeys[item.id]})` : ""}`}
                aria-keyshortcuts={navigationKeys[item.id] ? `Alt+${navigationKeys[item.id]}` : undefined}
              >
                <item.icon /> <span>{item.label}</span>
                {navigationKeys[item.id] ? (
                  <kbd className="nav-shortcut">
                    Alt+{navigationKeys[item.id]}
                  </kbd>
                ) : null}
                {item.id === "orders" && <i />}
              </button>
            ))}
          </nav>
          <div className="sidebar-foot">
            <div className="device">
              <span className={state.lastSyncError ? "dot warn" : "dot"} />{" "}
              <div>
                <strong>{state.device?.name || t("register")}</strong>
                <small>
                  {state.pendingChanges
                    ? `${state.pendingChanges} ${t("pendingChanges")}`
                    : t("synced")}
                </small>
              </div>
            </div>
            <button
              className="icon-button"
              aria-label={t("switchOperator")}
              onClick={() => setSwitchingOperator(true)}
              title={t("switchOperator")}
            >
              <UserRoundCog />
            </button>
            <button
              className="icon-button logout-button"
              aria-label={t("signOut")}
              onClick={() => void logout()}
              title={t("signOut")}
              disabled={busy}
            >
              <LogOut />
            </button>
          </div>
        </aside>
        <main>
          <header>
            <div>
              <p className="eyebrow">
                {state.partner?.companyName || t("partnerWorkspace")}
              </p>
              <h1>{navigation.find((item) => item.id === page)?.label}</h1>
            </div>
            <div className="header-actions">
              <div
                className={`sync-pill ${state.lastSyncError ? "error" : ""}`}
              >
                {state.lastSyncError ? <CloudOff /> : <Cloud />}
                <span>
                  {state.lastSyncAt
                    ? `${t("synced")} ${new Date(state.lastSyncAt).toLocaleTimeString(localeFor(language), { hour: "2-digit", minute: "2-digit" })}`
                    : t("localOnly")}
                </span>
              </div>
              <button
                className="icon-button keyboard-button"
                type="button"
                aria-label={t("keyboardShortcuts")}
                aria-keyshortcuts="F1"
                title={`${t("keyboardShortcuts")} (F1)`}
                onClick={() => setShortcutsOpen(true)}
              >
                <Keyboard />
              </button>
              {can("SYNC_MANAGE") ? <button
                className="button secondary"
                onClick={sync}
                disabled={busy}
              >
                <RefreshCw className={busy ? "spin" : ""} /> {t("sync")}
              </button> : null}
              {update.status !== "idle" && update.status !== "not-available" ? (
                <button
                  className={`button ${update.status === "error" ? "secondary" : "primary"}`}
                  onClick={() => void updateAction()}
                  disabled={update.status === "checking" || update.status === "downloading"}
                  title={update.error || undefined}
                >
                  {update.status === "checking" ? <LoaderCircle className="spin" /> : <DownloadIcon />}
                  {update.status === "available" ? `${t("updateAvailable")} ${update.version || ""}` : null}
                  {update.status === "downloading" ? `${t("downloadingUpdate")} ${Math.round(update.percent || 0)}%` : null}
                  {update.status === "downloaded" ? t("restartToUpdate") : null}
                  {update.status === "checking" ? t("checkingForUpdates") : null}
                  {update.status === "error" ? t("updateCheckFailed") : null}
                </button>
              ) : null}
            </div>
          </header>
          {notice && (
            <div className="notice" role="status">
              {notice}
              <button onClick={() => setNotice("")}>{t("close")}</button>
            </div>
          )}
          <section className="content">
            {page === "pos" && (
              <PosScreen onNotice={setNotice} onChanged={refreshState} />
            )}
            {page === "stock" && <InventoryScreen onNotice={setNotice} />}
            {page === "entries" && <StockEntriesScreen onNotice={setNotice} settings={settings} />}
            {page === "gifts" && <GiftStoreScreen capabilities={state.capabilities} canManage={can("CUSTOM_ORDERS_MANAGE")} syncVersion={state.lastSyncAt} />}
            {page === "orders" && <OrdersScreen />}
            {page === "sales" && (
              <InvoicesScreen onNotice={setNotice} settings={settings} />
            )}
            {page === "reports" && <ReportsScreen onNotice={setNotice} />}
            {page === "requests" && (
              <CatalogRequestsScreen onNotice={setNotice} />
            )}
            {page === "team" && <TeamScreen onNotice={setNotice} />}
            {page === "settings" && (
              <SettingsScreen
                values={settings}
                onChange={setSettings}
                onNotice={setNotice}
              />
            )}
          </section>
        </main>
        {switchingOperator ? (
          <div className="operator-switch-layer">
            <LocalAccessScreen
              setupRequired={false}
              canGoBack
              onBack={() => setSwitchingOperator(false)}
              onLock={async () => {
                await window.pos.localLogout();
                setSwitchingOperator(false);
                await refreshState();
              }}
              onSuccess={(value) => {
                const next = value as AppState;
                setState(next);
                setPage(firstAllowedPage(next.localAccess.permissions));
                setSwitchingOperator(false);
              }}
            />
          </div>
        ) : null}
        {shortcutsOpen ? (
          <div
            className="modal-backdrop"
            onMouseDown={(event) =>
              event.target === event.currentTarget && setShortcutsOpen(false)
            }
          >
            <section
              className="modal-card shortcuts-dialog"
              role="dialog"
              aria-modal="true"
              aria-labelledby="keyboard-shortcuts-title"
            >
              <div className="dialog-heading">
                <div>
                  <p className="eyebrow">Shea POS</p>
                  <h2 id="keyboard-shortcuts-title">
                    {t("keyboardShortcuts")}
                  </h2>
                  <p>{t("keyboardShortcutsText")}</p>
                </div>
                <button
                  className="icon-button"
                  type="button"
                  onClick={() => setShortcutsOpen(false)}
                  aria-label={t("close")}
                >
                  <span aria-hidden="true">×</span>
                </button>
              </div>
              <div className="shortcut-groups">
                <ShortcutGroup
                  title={t("navigationShortcuts")}
                  rows={navigation
                    .filter((item) => navigationKeys[item.id])
                    .map((item) => ({
                      label: item.label,
                      keys: ["Alt", navigationKeys[item.id]!],
                    }))}
                />
                <ShortcutGroup
                  title={t("actionShortcuts")}
                  rows={[
                    { label: t("focusSearch"), keys: ["Ctrl", "K"] },
                    { label: t("focusSearch"), keys: ["F2"] },
                    ...(can("SYNC_MANAGE")
                      ? [{ label: t("sync"), keys: ["Ctrl", "Shift", "S"] }]
                      : []),
                    ...(can("SETTINGS_MANAGE")
                      ? [{ label: t("settings"), keys: ["Ctrl", ","] }]
                      : []),
                    {
                      label: t("switchOperator"),
                      keys: ["Ctrl", "Shift", "L"],
                    },
                    {
                      label: sidebarCollapsed
                        ? t("expandSidebar")
                        : t("collapseSidebar"),
                      keys: ["Ctrl", "B"],
                    },
                    { label: t("keyboardShortcuts"), keys: ["F1"] },
                  ]}
                />
              </div>
            </section>
          </div>
        ) : null}
      </div>
    </I18nProvider>
  );
}

function ShortcutGroup({
  title,
  rows,
}: {
  title: string;
  rows: Array<{ label: string; keys: string[] }>;
}) {
  return (
    <section className="shortcut-group">
      <h3>{title}</h3>
      {rows.map((row) => (
        <div
          className="shortcut-row"
          key={`${row.label}-${row.keys.join("-")}`}
        >
          <span>{row.label}</span>
          <span>
            {row.keys.map((key) => (
              <kbd key={key}>{key}</kbd>
            ))}
          </span>
        </div>
      ))}
    </section>
  );
}

function Login({
  language,
  onLanguage,
  onSuccess,
}: {
  language: Language;
  onLanguage: (value: Language) => void;
  onSuccess: (state: AppState) => void;
}) {
  const t = (key: Parameters<typeof translate>[1]) => translate(language, key);
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError("");
    const data = new FormData(event.currentTarget);
    const endpoint =
      import.meta.env.VITE_API_URL || "https://shea.openzey.com/api/graphql";
    try {
      onSuccess(
        (await window.pos.signIn({
          endpoint,
          email: String(data.get("email")),
          password: String(data.get("password")),
          deviceName: `POS-${navigator.platform || "Desktop"}`,
        })) as AppState,
      );
    } catch (value) {
      setError(localizeError(language, value));
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="login simple-login">
      <form className="login-card" onSubmit={submit}>
        <div className="login-brand">
          <span className="brand-mark large">S</span>
          <button
            type="button"
            className="language-toggle"
            onClick={() => onLanguage(language === "en" ? "ar" : "en")}
          >
            <Languages />
            {language === "en" ? "العربية" : "English"}
          </button>
        </div>
        <p className="eyebrow">Shea POS</p>
        <h2>{t("welcome")}</h2>
        <p>{t("loginHelp")}</p>
        <label>
          {t("email")}
          <input
            name="email"
            type="email"
            autoComplete="username"
            required
            autoFocus
          />
        </label>
        <label>
          {t("password")}
          <input
            name="password"
            type="password"
            autoComplete="current-password"
            required
          />
        </label>
        {error && <div className="form-error">{error}</div>}
        <button className="button primary full" disabled={busy}>
          {busy ? <LoaderCircle className="spin" /> : <Cloud />}{" "}
          {busy ? t("loggingIn") : t("login")}
        </button>
      </form>
    </div>
  );
}

function Centered({ children }: { children: React.ReactNode }) {
  return <div className="centered">{children}</div>;
}
