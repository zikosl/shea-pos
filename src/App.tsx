import { useEffect, useState } from "react";
import {
  BarChart3,
  Boxes,
  Cloud,
  CloudOff,
  FileClock,
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
} from "lucide-react";
import { CatalogRequestsScreen } from "./features/catalog/CatalogRequestsScreen";
import { OrdersScreen, SalesScreen } from "./features/history/HistoryScreens";
import { InventoryScreen } from "./features/inventory/InventoryScreen";
import { PosScreen } from "./features/pos/PosScreen";
import { SettingsScreen } from "./features/settings/SettingsScreen";
import { ReportsScreen } from "./features/reports/ReportsScreen";
import {
  I18nProvider,
  localeFor,
  localizeError,
  translate,
  type Language,
} from "./i18n";
import type { AppState } from "./types";
import { ErrorState } from "./components/AsyncState";

type Page =
  "pos" | "stock" | "orders" | "sales" | "reports" | "requests" | "settings";
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
};

export default function App() {
  const [state, setState] = useState<AppState>(emptyState);
  const [ready, setReady] = useState(false);
  const [page, setPage] = useState<Page>("pos");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [settings, setSettings] = useState<Record<string, string>>({});
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [bootError, setBootError] = useState("");
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

  async function sync() {
    setBusy(true);
    setNotice("");
    try {
      setState((await window.pos.sync()) as AppState);
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

  const navigation = [
    { id: "pos", label: t("sell"), icon: ShoppingBag },
    { id: "stock", label: t("inventory"), icon: Boxes },
    { id: "orders", label: t("orders"), icon: FileClock },
    { id: "sales", label: t("sales"), icon: ReceiptText },
    { id: "reports", label: t("reports"), icon: BarChart3 },
    { id: "requests", label: t("requests"), icon: PackagePlus },
    { id: "settings", label: t("settings"), icon: Settings },
  ] as const;

  return (
    <I18nProvider language={language}>
      <div
        className={`shell ${page === "pos" ? "pos-mode" : ""} ${sidebarCollapsed ? "sidebar-collapsed" : ""}`}
      >
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
                title={sidebarCollapsed ? item.label : undefined}
              >
                <item.icon /> <span>{item.label}</span>
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
              aria-label={t("signOut")}
              onClick={async () => {
                await window.pos.signOut();
                setState(emptyState);
              }}
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
                className="button secondary"
                onClick={sync}
                disabled={busy}
              >
                <RefreshCw className={busy ? "spin" : ""} /> {t("sync")}
              </button>
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
            {page === "orders" && <OrdersScreen />}
            {page === "sales" && (
              <SalesScreen onNotice={setNotice} settings={settings} />
            )}
            {page === "reports" && <ReportsScreen onNotice={setNotice} />}
            {page === "requests" && (
              <CatalogRequestsScreen onNotice={setNotice} />
            )}
            {page === "settings" && (
              <SettingsScreen
                values={settings}
                onChange={setSettings}
                onNotice={setNotice}
              />
            )}
          </section>
        </main>
      </div>
    </I18nProvider>
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
