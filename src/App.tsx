import { useEffect, useLayoutEffect, useRef, useState } from "react";
import {
  BarChart3,
  BellRing,
  Boxes,
  ChevronDown,
  Cloud,
  CloudOff,
  Download as DownloadIcon,
  FileClock,
  Gift,
  Home,
  Keyboard,
  LayoutGrid,
  Languages,
  LoaderCircle,
  LogOut,
  PackagePlus,
  ReceiptText,
  RefreshCw,
  Settings,
  ScanLine,
  ShoppingBag,
  UsersRound,
  UserRoundCog,
  X,
} from "lucide-react";
import { CatalogRequestsScreen } from "./features/catalog/CatalogRequestsScreen";
import { InvoicesScreen, OrdersScreen } from "./features/history/HistoryScreens";
import { InventoryScreen } from "./features/inventory/InventoryScreen";
import { StockEntriesScreen } from "./features/inventory/StockEntriesScreen";
import { BarcodeManagerScreen } from "./features/barcodes/BarcodeManagerScreen";
import { CASH_SESSION_UPDATED_EVENT, COMPLETE_SALE_SHORTCUT_EVENT, FOCUS_TENDERED_AMOUNT_EVENT, HOLD_SALE_SHORTCUT_EVENT, POS_PAGE_SHORTCUT_EVENT, SAFE_POS_EXIT_REQUEST_EVENT, PosScreen } from "./features/pos/PosScreen";
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
import { DeploymentSetupScreen } from "./features/setup/DeploymentSetupScreen";
import { HomeLauncher, type LauncherGroup, type LauncherPage } from "./features/home/HomeLauncher";

type Page = LauncherPage | "home";
function isSoftRefreshShortcut(event: KeyboardEvent) {
  return event.key === "F5" || ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "r");
}
function contrastingTextColor(hex: string) {
  const value = hex.replace("#", "");
  const normalized = value.length === 3
    ? value.split("").map((part) => part + part).join("")
    : value;
  if (!/^[0-9a-f]{6}$/i.test(normalized)) return "#fff";
  const channels = [0, 2, 4].map((offset) => parseInt(normalized.slice(offset, offset + 2), 16) / 255);
  const weights = [0.2126, 0.7152, 0.0722];
  const luminance = channels
    .map((channel) => channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4)
    .reduce((sum, channel, index) => sum + channel * (weights[index] ?? 0), 0);
  return luminance > 0.2 ? "#29151d" : "#fff";
}
let incomingOrderAudioContext: AudioContext | null = null;
function playIncomingOrderTone() {
  try {
    const context = incomingOrderAudioContext;
    if (!context || context.state !== "running") return;
    const now = context.currentTime;
    [740, 988, 740].forEach((frequency, index) => {
      const oscillator = context.createOscillator();
      const gain = context.createGain();
      const start = now + index * 0.2;
      oscillator.type = "square";
      oscillator.frequency.value = frequency;
      gain.gain.setValueAtTime(0.0001, start);
      gain.gain.exponentialRampToValueAtTime(0.16, start + 0.025);
      gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.17);
      oscillator.connect(gain);
      gain.connect(context.destination);
      oscillator.start(start);
      oscillator.stop(start + 0.18);
    });
  } catch {
    // A blocked or unavailable audio device must not block the order alert.
  }
}
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
    remembered: false,
    user: null,
    permissions: [],
  },
};

const pagePermission: Record<LauncherPage, Permission> = {
  pos: "POS_SELL",
  stock: "INVENTORY_VIEW",
  barcodes: "INVENTORY_MANAGE",
  entries: "STOCK_RECEIVE",
  gifts: "CUSTOM_ORDERS_VIEW",
  orders: "ORDERS_VIEW",
  sales: "INVOICES_VIEW",
  reports: "REPORTS_VIEW",
  requests: "CATALOG_REQUEST",
  team: "USERS_MANAGE",
  settings: "SETTINGS_MANAGE",
};

function firstAllowedPage(granted: Permission[]): LauncherPage {
  const preferred: LauncherPage[] = ["pos", "gifts", "orders", "stock", "barcodes", "entries", "sales", "reports", "requests", "team", "settings"];
  return preferred.find((candidate) => granted.includes(pagePermission[candidate])) ?? "pos";
}

function landingPageFor(user: AppState["localAccess"]["user"], granted: Permission[]): Page {
  if (user?.role === "CASHIER" && granted.includes("POS_SELL")) return "pos";
  if (user?.role === "STOCK_CLERK" && granted.includes("INVENTORY_VIEW")) return "stock";
  return "home";
}

export default function App() {
  const [state, setState] = useState<AppState>(emptyState);
  const [ready, setReady] = useState(false);
  const [page, setPage] = useState<Page>("pos");
  const [pageTransitionLoading, setPageTransitionLoading] = useState(false);
  const previousPage = useRef(page);
  const initialLandingApplied = useRef(false);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [settings, setSettings] = useState<Record<string, string>>({});
  const [bootError, setBootError] = useState("");
  const [switchingOperator, setSwitchingOperator] = useState(false);
  const [operatorMenuOpen, setOperatorMenuOpen] = useState(false);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const [commandOpen, setCommandOpen] = useState(false);
  const [update, setUpdate] = useState<UpdateStatus>({ status: "idle" });
  const [incomingOrders, setIncomingOrders] = useState<any[]>([]);
  const [incomingOrderAudioReady, setIncomingOrderAudioReady] = useState(false);
  const [openOrderId, setOpenOrderId] = useState<number | null>(null);
  const [unreadOnlineCount, setUnreadOnlineCount] = useState(0);
  const knownOrderIds = useRef<Set<string> | null>(null);
  const realtimeOrderIds = useRef(new Set<number>());
  const alertedOrderIds = useRef(new Set<number>());
  const handledOrderIds = useRef(new Set<number>());
  const operatorMenuRef = useRef<HTMLDivElement>(null);
  const hasOrdersPermission = state.localAccess.permissions.includes("ORDERS_VIEW");
  const language = (settings.language === "ar" ? "ar" : "en") as Language;
  const t = (key: Parameters<typeof translate>[1]) => translate(language, key);
  const safeNavigateRef = useRef<(target: Page, beforeNavigate?: () => void) => void>(() => undefined);

  function requestSafePosExit(continueAction: () => void) {
    if (page !== "pos") {
      continueAction();
      return;
    }
    window.dispatchEvent(new CustomEvent(SAFE_POS_EXIT_REQUEST_EVENT, {
      detail: { complete: continueAction },
    }));
  }

  function navigateTo(target: Page, beforeNavigate?: () => void) {
    if (target === page) {
      beforeNavigate?.();
      return;
    }
    requestSafePosExit(() => {
      beforeNavigate?.();
      setPage(target);
    });
  }
  safeNavigateRef.current = navigateTo;

  useLayoutEffect(() => {
    if (previousPage.current === page) return;
    previousPage.current = page;

    const content = document.querySelector(".content");
    const startedAt = performance.now();
    let hideTimer: number | undefined;
    setPageTransitionLoading(true);

    const hasVisibleLoader = () =>
      Array.from(content?.querySelectorAll<HTMLElement>(".loading-state") ?? [])
        .some((loader) => loader.getClientRects().length > 0);

    const hideWhenReady = () => {
      if (hasVisibleLoader() || hideTimer !== undefined) return;
      const minimumDelay = Math.max(0, 220 - (performance.now() - startedAt));
      hideTimer = window.setTimeout(() => setPageTransitionLoading(false), minimumDelay);
    };

    const observer = content ? new MutationObserver(() => {
      if (hasVisibleLoader()) {
        if (hideTimer !== undefined) window.clearTimeout(hideTimer);
        hideTimer = undefined;
      } else {
        hideWhenReady();
      }
    }) : null;
    observer?.observe(content!, { childList: true, subtree: true });
    hideWhenReady();

    const safetyTimer = window.setTimeout(() => setPageTransitionLoading(false), 15_000);
    return () => {
      observer?.disconnect();
      if (hideTimer !== undefined) window.clearTimeout(hideTimer);
      window.clearTimeout(safetyTimer);
    };
  }, [page]);

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
  useEffect(() => window.pos.onCashSessionAutoClosed(() => {
    window.dispatchEvent(new Event(CASH_SESSION_UPDATED_EVENT));
    setNotice(t("registerAutoClosedNotice"));
    void refreshState();
  }), [language]);
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
    if (state.localAccess.authenticated && page !== "home" && !state.localAccess.permissions.includes(pagePermission[page]))
      setPage(state.localAccess.user?.role === "STOCK_CLERK" && state.localAccess.permissions.includes("INVENTORY_VIEW")
        ? "stock"
        : firstAllowedPage(state.localAccess.permissions));
  }, [page, state.localAccess.authenticated, state.localAccess.permissions, state.localAccess.user?.role]);
  useLayoutEffect(() => {
    if (!ready || !state.localAccess.authenticated || initialLandingApplied.current) return;
    initialLandingApplied.current = true;
    setPage(landingPageFor(state.localAccess.user, state.localAccess.permissions));
  }, [ready, state.localAccess.authenticated, state.localAccess.user?.id]);
  useEffect(() => {
    if (!operatorMenuOpen) return;
    const closeMenu = (event: MouseEvent | KeyboardEvent) => {
      if (event instanceof KeyboardEvent && event.key === "Escape") {
        setOperatorMenuOpen(false);
        return;
      }
      if (event instanceof MouseEvent && !operatorMenuRef.current?.contains(event.target as Node))
        setOperatorMenuOpen(false);
    };
    document.addEventListener("mousedown", closeMenu);
    document.addEventListener("keydown", closeMenu);
    return () => {
      document.removeEventListener("mousedown", closeMenu);
      document.removeEventListener("keydown", closeMenu);
    };
  }, [operatorMenuOpen]);
  useEffect(() => {
    const theme = settings.theme || "system";
    const media = matchMedia("(prefers-color-scheme: dark)");
    const applyTheme = () => {
      const dark = theme === "dark" || (theme === "system" && media.matches);
      document.documentElement.dataset.theme = dark ? "dark" : "light";
      const configuredColor = settings.primaryColor?.toLowerCase();
      const legacyDefault = !configuredColor || configuredColor === "#2f6fed" || configuredColor === "#a93660";
      const primaryColor = legacyDefault ? (dark ? "#d9829f" : "#a93660") : settings.primaryColor || "#a93660";
      document.documentElement.style.setProperty(
        "--primary",
        primaryColor,
      );
      document.documentElement.style.setProperty("--primary-contrast", contrastingTextColor(primaryColor));
    };
    applyTheme();
    media.addEventListener("change", applyTheme);
    document.documentElement.dir = settings.language === "ar" ? "rtl" : "ltr";
    document.documentElement.lang = settings.language || "en";
    return () => media.removeEventListener("change", applyTheme);
  }, [settings.theme, settings.primaryColor, settings.language]);
  useEffect(() => {
    // Notices are rendered text, so never carry one over into a new locale.
    setNotice("");
  }, [language]);
  useEffect(() => {
    const unlockAudio = () => {
      try {
        incomingOrderAudioContext ??= new window.AudioContext();
        void incomingOrderAudioContext.resume().then(() => {
          setIncomingOrderAudioReady(incomingOrderAudioContext?.state === "running");
          window.removeEventListener("pointerdown", unlockAudio);
          window.removeEventListener("keydown", unlockAudio);
        }).catch(() => undefined);
      } catch {
        // The visible alert and native notification remain available without audio.
      }
    };
    window.addEventListener("pointerdown", unlockAudio);
    window.addEventListener("keydown", unlockAudio);
    return () => {
      window.removeEventListener("pointerdown", unlockAudio);
      window.removeEventListener("keydown", unlockAudio);
    };
  }, []);
  useEffect(() => {
    if (!incomingOrders.length || !incomingOrderAudioReady) return;
    playIncomingOrderTone();
    const timer = window.setInterval(playIncomingOrderTone, 2400);
    return () => window.clearInterval(timer);
  }, [incomingOrders.length, incomingOrderAudioReady]);
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
  useEffect(() => {
    if (!state.authenticated || !state.localAccess.authenticated || !hasOrdersPermission) {
      knownOrderIds.current = null;
      realtimeOrderIds.current.clear();
      setIncomingOrders([]);
      setUnreadOnlineCount(0);
      return;
    }
    let active = true;
    const refreshOrders = async (detectNew: boolean) => {
      const rows = await window.pos.listOrders() as any[];
      if (!active) return;
      const unreadIds = await window.pos.listUnreadOnlineOrderIds();
      if (active) setUnreadOnlineCount(unreadIds.length);
      const currentIds = new Set(rows.map((row) => String(row.server_id)));
      const realtimeOrderUpdates = rows.filter((row) => realtimeOrderIds.current.has(Number(row.server_id)));
      for (const row of realtimeOrderUpdates) realtimeOrderIds.current.delete(Number(row.server_id));
      if (knownOrderIds.current === null) {
        knownOrderIds.current = currentIds;
      }
      const arrivingOrders = [
        ...realtimeOrderUpdates,
        ...(detectNew ? rows.filter((row) => !knownOrderIds.current?.has(String(row.server_id))) : []),
      ].filter((row, index, all) =>
        row.delivery_status === "PENDING" && row.status === "REQUESTED" &&
        all.findIndex((candidate) => candidate.server_id === row.server_id) === index
      );
      knownOrderIds.current = currentIds;
      for (const arriving of arrivingOrders) {
        const id = Number(arriving.server_id);
        if (handledOrderIds.current.has(id)) continue;
        setIncomingOrders((current) => current.some((row) => Number(row.server_id) === id)
          ? current.map((row) => Number(row.server_id) === id ? arriving : row)
          : [...current, arriving]);
        if (!alertedOrderIds.current.has(id)) {
          alertedOrderIds.current.add(id);
          if (alertedOrderIds.current.size > 1000) alertedOrderIds.current.delete(alertedOrderIds.current.values().next().value!);
          void window.pos.notifyNewOrder({
            id,
            title: t("newOnlineOrder"),
            body: `#${arriving.server_id}`,
          }).catch(() => undefined);
        }
      }
    };
    const unsubscribeRealtime = window.pos.onRealtimeOrder((id) => {
      realtimeOrderIds.current.add(id);
      void refreshOrders(true).catch(() => undefined);
    });
    void refreshOrders(false).catch(() => undefined);
    const unsubscribe = window.pos.onDataSyncComplete(() => void refreshOrders(true).catch(() => undefined));
    const unsubscribeOpen = window.pos.onOpenOrderNotification((id) => {
      safeNavigateRef.current("orders", () => openIncomingOrder(id));
    });
    return () => {
      active = false;
      unsubscribeRealtime();
      unsubscribe();
      unsubscribeOpen();
    };
  }, [state.authenticated, state.localAccess.authenticated, hasOrdersPermission, language]);

  function dismissIncomingOrder(id: number) {
    handledOrderIds.current.add(id);
    if (handledOrderIds.current.size > 1000) handledOrderIds.current.delete(handledOrderIds.current.values().next().value!);
    setIncomingOrders((current) => current.filter((row) => Number(row.server_id) !== id));
  }

  function openIncomingOrder(id: number) {
    navigateTo("orders", () => {
      dismissIncomingOrder(id);
      setOpenOrderId(id);
    });
  }

  async function sync() {
    if (busy) return;
    setBusy(true);
    setNotice("");
    try {
      const synced = (await window.pos.sync({ forceRetry: true })) as Partial<AppState>;
      // Sync refreshes server data; the local operator session stays active.
      setState((current) => ({ ...current, ...synced, localAccess: current.localAccess }));
      setNotice(synced.pendingChanges ? t("syncPending") : t("everythingUpToDate"));
    } catch (error) {
      setNotice(localizeError(language, error));
      await refreshState();
    } finally {
      setBusy(false);
    }
  }
  useEffect(() => {
    return window.pos.onSoftRefresh(() => {
      if (state.authenticated && state.localAccess.authenticated) void sync();
    });
  }, [state.authenticated, state.localAccess.authenticated, busy, language]);
  useEffect(() => {
    // This is a browser fallback and also protects against platform menu paths
    // that do not reach Electron's before-input-event hook.
    const interceptRefresh = (event: KeyboardEvent) => {
      if (!isSoftRefreshShortcut(event)) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      if (state.authenticated && state.localAccess.authenticated) void sync();
    };
    window.addEventListener("keydown", interceptRefresh, { capture: true });
    return () => window.removeEventListener("keydown", interceptRefresh, { capture: true });
  }, [state.authenticated, state.localAccess.authenticated, busy, language]);

  async function logout() {
    if (!window.confirm(t("logoutConfirm"))) return;
    setBusy(true);
    try {
      await window.pos.signOut();
      setSwitchingOperator(false);
      initialLandingApplied.current = false;
      setState(emptyState);
      setPage("pos");
      setNotice("");
    } catch (value) {
      setNotice(localizeError(language, value));
    } finally {
      setBusy(false);
    }
  }

  async function logoutLocalOperator() {
    if (!window.confirm(t("localSignOutConfirm"))) return;
    try {
      await window.pos.localLogout();
      setSwitchingOperator(false);
      initialLandingApplied.current = false;
      await refreshState();
    } catch (value) {
      setNotice(localizeError(language, value));
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
  if (settings.deploymentConfigured !== "true")
    return (
      <I18nProvider language={language}>
        <DeploymentSetupScreen onComplete={setSettings} />
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
          remembered={state.localAccess.remembered}
          onSuccess={(value) => {
            const next = value as AppState;
            initialLandingApplied.current = true;
            setState(next);
            setPage(landingPageFor(next.localAccess.user, next.localAccess.permissions));
          }}
        />
      </I18nProvider>
    );

  const can = (permission: Permission) =>
    state.localAccess.permissions.includes(permission);

  const allNavigationGroups: LauncherGroup[] = [
    {
      id: "operations",
      label: t("navOperations"),
      items: [
        { id: "pos", label: t("sell"), description: t("homePosDescription"), icon: ShoppingBag },
        { id: "orders", label: t("orders1"), description: t("homeOrdersDescription"), icon: FileClock, badge: unreadOnlineCount ? `${unreadOnlineCount} ${t("unread")}` : undefined },
        ...(state.capabilities.includes("CUSTOM_ORDERS") ? [{ id: "gifts" as const, label: t("customOrders"), description: t("homeGiftsDescription"), icon: Gift }] : []),
      ],
    },
    {
      id: "inventory",
      label: t("navCatalogInventory"),
      items: [
        { id: "stock", label: t("inventory"), description: t("homeInventoryDescription"), icon: Boxes },
        { id: "entries", label: t("stockEntries"), description: t("homeEntriesDescription"), icon: PackagePlus },
        { id: "barcodes", label: t("barcodeManager"), description: t("homeBarcodesDescription"), icon: ScanLine },
        { id: "requests", label: t("requests"), description: t("homeRequestsDescription"), icon: PackagePlus },
      ],
    },
    {
      id: "insights",
      label: t("navInsights"),
      items: [
        { id: "sales", label: t("invoices"), description: t("homeSalesDescription"), icon: ReceiptText },
        { id: "reports", label: t("reports"), description: t("homeReportsDescription"), icon: BarChart3 },
      ],
    },
    {
      id: "administration",
      label: t("navAdministration"),
      items: [
        { id: "team", label: t("team"), description: t("homeTeamDescription"), icon: UsersRound },
        { id: "settings", label: t("settings"), description: t("homeSettingsDescription"), icon: Settings },
      ],
    },
  ];
  const navGroups = allNavigationGroups.map((group) => ({
    ...group,
    items: group.items.filter((item) => can(pagePermission[item.id])),
  }));
  const navigation = [
    { id: "home" as const, label: t("home"), icon: Home },
    ...navGroups.flatMap((group) => group.items.map(({ id, label, icon }) => ({ id, label, icon }))),
  ];

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
    if (navigation.some((item) => item.id === target)) navigateTo(target);
  };
  const openLauncher = () => navigateTo("home");
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
      id: "soft-refresh",
      key: "F5",
      allowInField: true,
      enabled: state.authenticated && state.localAccess.authenticated,
      run: () => void sync(),
    },
    {
      id: "applications-home",
      key: "Escape",
      enabled: page !== "home",
      run: () => navigateTo("home"),
    },
    {
      id: "hold-sale-f3",
      key: "F3",
      allowInField: true,
      enabled: page === "pos" && can("POS_SELL"),
      run: () => window.dispatchEvent(new Event(HOLD_SALE_SHORTCUT_EVENT)),
    },
    {
      id: "complete-sale-f10",
      key: "F10",
      allowInField: true,
      enabled: page === "pos" && can("POS_SELL"),
      run: () => window.dispatchEvent(new Event(COMPLETE_SALE_SHORTCUT_EVENT)),
    },
    {
      id: "focus-tendered-amount-f6",
      key: "F6",
      allowInField: true,
      enabled: page === "pos" && can("POS_SELL"),
      run: () => window.dispatchEvent(new Event(FOCUS_TENDERED_AMOUNT_EVENT)),
    },
    {
      id: "pos-next-products-page",
      key: "ArrowRight",
      primary: true,
      enabled: page === "pos",
      run: () => window.dispatchEvent(new CustomEvent(POS_PAGE_SHORTCUT_EVENT, { detail: { direction: "next" } })),
    },
    {
      id: "pos-previous-products-page",
      key: "ArrowLeft",
      primary: true,
      enabled: page === "pos",
      run: () => window.dispatchEvent(new CustomEvent(POS_PAGE_SHORTCUT_EVENT, { detail: { direction: "previous" } })),
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
      run: () => requestSafePosExit(() => setSwitchingOperator(true)),
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
    { id: "command-operator", label: t("switchOperator"), group: commandGroups.actions, icon: UserRoundCog, shortcut: "Ctrl ⇧ L", run: () => requestSafePosExit(() => setSwitchingOperator(true)) },
    { id: "command-local-logout", label: t("signOutOperator"), group: commandGroups.system, icon: LogOut, run: () => requestSafePosExit(() => void logoutLocalOperator()) },
    { id: "command-shortcuts", label: t("keyboardShortcuts"), group: commandGroups.system, icon: Keyboard, shortcut: "F1", run: () => setShortcutsOpen(true) },
  ].filter((command) => command.id !== "command-sync" || can("SYNC_MANAGE"));

  return (
    <I18nProvider language={language}>
      <CommandPalette open={commandOpen} onClose={() => setCommandOpen(false)} commands={commands} placeholder={t("commandPalette")} emptyText={t("noMatchingCommands")} navigateText={t("navigate")} selectText={t("select")} />
      <div className={`app-shell ${page === "pos" ? "pos-mode" : ""}`}>
        <KeyboardShortcuts
          shortcuts={shortcuts}
          active={!switchingOperator && !shortcutsOpen && !commandOpen}
        />
        <main>
          <header>
            <div>
              <button
                className="app-launcher-button"
                type="button"
                aria-label={t("home")}
                title={t("home")}
                onClick={openLauncher}
              >
                <LayoutGrid aria-hidden="true" />
              </button>
            </div>
            <div className="header-page-title">
              <p className="eyebrow">
                {state.partner?.companyName || t("partnerWorkspace")}
              </p>
              <h1>{navigation.find((item) => item.id === page)?.label}</h1>
            </div>
            <div className="header-actions">
              <div
                className={`sync-pill ${state.lastSyncError ? "error" : state.pendingChanges ? "pending" : ""}`}
                title={`${state.device?.name || t("register")}${state.pendingChanges ? ` · ${state.pendingChanges} ${t("pendingChanges")}` : ""}`}
              >
                {state.lastSyncError ? <CloudOff /> : <Cloud />}
                <span>
                  {state.pendingChanges
                    ? `${state.pendingChanges} ${t("pendingChanges")}`
                    : state.lastSyncAt
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
              <div className="operator-menu" ref={operatorMenuRef}>
                <button
                  className="operator-menu-trigger"
                  type="button"
                  aria-haspopup="menu"
                  aria-expanded={operatorMenuOpen}
                  onClick={() => setOperatorMenuOpen((open) => !open)}
                >
                  <span className="operator-avatar">
                    {(state.localAccess.user?.name || "S").trim().charAt(0).toUpperCase()}
                  </span>
                  <span className="operator-menu-name">{state.localAccess.user?.name || state.user?.email}</span>
                  <ChevronDown aria-hidden="true" />
                </button>
                {operatorMenuOpen ? (
                  <div className="operator-menu-popover" role="menu">
                    <button type="button" role="menuitem" onClick={() => { setOperatorMenuOpen(false); requestSafePosExit(() => setSwitchingOperator(true)); }}>
                      <UserRoundCog /> {t("switchOperator")}
                    </button>
                    <button type="button" role="menuitem" onClick={() => { setOperatorMenuOpen(false); requestSafePosExit(() => void logoutLocalOperator()); }} disabled={busy}>
                      <LogOut /> {t("signOutOperator")}
                    </button>
                  </div>
                ) : null}
              </div>
            </div>
          </header>
          {notice && (
            <div className="notice" role="status">
              {notice}
              <button onClick={() => setNotice("")}>{t("close")}</button>
            </div>
          )}
          <section className="content" aria-busy={pageTransitionLoading}>
            {page === "home" && (
              <HomeLauncher
                greeting={t("homeWelcome").replace("{name}", state.localAccess.user?.name || state.user?.email || "")}
                storeName={settings.storeName || state.partner?.companyName || "Shea POS"}
                intro={t("homeLauncherIntro")}
                groups={navGroups.map((group) => ({
                  ...group,
                  items: group.items.map((item) => ({
                    ...item,
                    badge: item.id === "orders" && unreadOnlineCount > 0 ? `${unreadOnlineCount} ${t("unread")}` : item.badge,
                  })),
                }))}
                onNavigate={(target) => openPage(target)}
              />
            )}
            {page === "pos" && (
              <PosScreen
                onNotice={setNotice}
                onChanged={refreshState}
                canManageRegister={can("REGISTER_MANAGE")}
              />
            )}
            {page === "stock" && <InventoryScreen onNotice={setNotice} />}
            {page === "barcodes" && <BarcodeManagerScreen onNotice={setNotice} onChanged={refreshState} gatewayMode={settings.deploymentMode === "multi"} />}
            {page === "entries" && <StockEntriesScreen onNotice={setNotice} settings={settings} />}
            {page === "gifts" && <GiftStoreScreen capabilities={state.capabilities} canManage={can("CUSTOM_ORDERS_MANAGE")} syncVersion={state.lastSyncAt} />}
            {page === "orders" && <OrdersScreen openOrderId={openOrderId} onOpenedOrder={() => setOpenOrderId(null)} onUnreadOrdersChanged={setUnreadOnlineCount} />}
            {page === "sales" && (
              <InvoicesScreen onNotice={setNotice} settings={settings} canCorrect={can("REGISTER_MANAGE") && settings.deploymentMode !== "multi"} canRefund={can("SALES_REFUND")} onGoToPos={() => navigateTo("pos")} />
            )}
            {page === "reports" && <ReportsScreen onNotice={setNotice} canViewTeam={can("USERS_MANAGE")} />}
            {page === "requests" && (
              <CatalogRequestsScreen onNotice={setNotice} />
            )}
            {page === "team" && <TeamScreen onNotice={setNotice} canViewInvoices={can("INVOICES_VIEW")} />}
            {page === "settings" && (
              <SettingsScreen
                values={settings}
                onChange={setSettings}
                onNotice={setNotice}
                onSignOut={logout}
              />
            )}
          </section>
        </main>
        {pageTransitionLoading ? (
          <div className="page-transition-loader" role="status" aria-live="polite">
            <LoaderCircle className="spin" aria-hidden="true" />
            <span>{t("loadingData")}</span>
          </div>
        ) : null}
        {incomingOrders[0] && hasOrdersPermission ? (
          <aside className="incoming-order-alert" role="alert" aria-live="assertive">
            <div className="incoming-order-icon"><BellRing size={19} /></div>
            <div className="incoming-order-copy">
              <strong>{t("newOnlineOrder")}</strong>
              <span>#{incomingOrders[0].server_id} · {incomingOrders[0].customer_name || t("customer")}</span>
              {incomingOrders.length > 1 ? <small>{t("moreOrdersWaiting").replace("{count}", String(incomingOrders.length - 1))}</small> : null}
            </div>
            <button className="button primary" onClick={() => openIncomingOrder(Number(incomingOrders[0].server_id))}>{t("viewOrder")}</button>
            <button className="icon-button" aria-label={t("dismissAlert")} title={t("dismissAlert")} onClick={() => dismissIncomingOrder(Number(incomingOrders[0].server_id))}><X size={17} /></button>
          </aside>
        ) : null}
        {switchingOperator ? (
          <div className="operator-switch-layer">
            <LocalAccessScreen
              setupRequired={false}
              remembered={state.localAccess.remembered}
              canGoBack
              onBack={() => setSwitchingOperator(false)}
              onLock={async () => {
                await window.pos.localLogout();
                initialLandingApplied.current = false;
                setSwitchingOperator(false);
                await refreshState();
              }}
              onSuccess={(value) => {
                const next = value as AppState;
                initialLandingApplied.current = true;
                setState(next);
                setPage(landingPageFor(next.localAccess.user, next.localAccess.permissions));
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
                    { label: t("refresh"), keys: ["F5"] },
                    ...(page === "pos" && can("POS_SELL")
                      ? [
                        { label: t("nextPage"), keys: ["Ctrl/⌘", "→"] },
                        { label: t("previousPage"), keys: ["Ctrl/⌘", "←"] },
                        { label: t("backToApplications"), keys: ["Esc"] },
                        { label: t("newSaleAction"), keys: ["Esc", t("afterSaleComplete")] },
                        { label: t("holdSale"), keys: ["F3"] },
                        { label: t("amountTendered"), keys: ["F6"] },
                        { label: t("completeSale"), keys: ["F10"] },
                        { label: t("printReceipt"), keys: ["F9"] },
                      ]
                      : page !== "home"
                        ? [{ label: t("home"), keys: ["Esc"] }]
                        : []),
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
