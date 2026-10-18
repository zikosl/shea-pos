import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Check,
  ArchiveRestore,
  CircleDollarSign,
  Filter,
  LoaderCircle,
  PackageOpen,
  Pause,
  Printer,
  Search,
  ShoppingBag,
  Trash2,
  UserRound,
  X,
} from "lucide-react";
import { EmptyState } from "../../components/EmptyState";
import { ErrorState, LoadingState } from "../../components/AsyncState";
import { Pagination } from "../../components/Pagination";
import { localeFor, localizeError, useI18n } from "../../i18n";
import { money } from "../../shared/format";
import { barcodeMatches, barcodeSearchTerms } from "../../../electron/domain/barcode";
import type { CartLine, Catalog, Product } from "../../types";

const DEFAULT_PAGE_SIZE = 12;
const MAX_PAGE_SIZE = 249;
export const HOLD_SALE_SHORTCUT_EVENT = "shea-pos:hold-sale";
export const POS_PAGE_SHORTCUT_EVENT = "shea-pos:page-products";
export const FOCUS_TENDERED_AMOUNT_EVENT = "shea-pos:focus-tendered-amount";
export const SAFE_POS_EXIT_REQUEST_EVENT = "shea-pos:safe-exit-request";
export const COMPLETE_SALE_SHORTCUT_EVENT = "shea-pos:complete-sale";
export const CASH_SESSION_UPDATED_EVENT = "shea-pos:cash-session-updated";
const initials = (name: string) =>
  name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((word) => word[0])
    .join("")
    .toUpperCase();

function ProductThumbnail({ image }: { image?: string }) {
  const [failed, setFailed] = useState(false);
  if (!image || failed) return <ShoppingBag />;
  return <img src={image} alt="" onError={() => setFailed(true)} />;
}

export function PosScreen({
  onNotice,
  onChanged,
  canManageRegister,
}: {
  onNotice: (message: string) => void;
  onChanged: () => Promise<void>;
  canManageRegister: boolean;
}) {
  const { t, language } = useI18n();
  const [products, setProducts] = useState<Product[]>([]),
    [catalog, setCatalog] = useState<Catalog | null>(null);
  const [cart, setCart] = useState<CartLine[]>([]),
    [search, setSearch] = useState(""),
    [customerName, setCustomerName] = useState("");
  const [categoryId, setCategoryId] = useState<number>(),
    [nicheId, setNicheId] = useState<number>(),
    [offset, setOffset] = useState(0),
    [busy, setBusy] = useState(false);
  const [pageSize, setPageSize] = useState(DEFAULT_PAGE_SIZE);
  const [cashSession, setCashSession] = useState<any>(null),
    [showRegister, setShowRegister] = useState(false),
    [completedSale, setCompletedSale] = useState<any>(null);
  const [registerBusy, setRegisterBusy] = useState(false);
  const registerPromptChecked = useRef(false);
  const [amountTendered, setAmountTendered] = useState("");
  const [priceProduct, setPriceProduct] = useState<Product | null>(null);
  const [heldCarts, setHeldCarts] = useState<any[]>([]);
  const [showHeldCarts, setShowHeldCarts] = useState(false);
  const [holdingSale, setHoldingSale] = useState(false);
  const [printingReceipt, setPrintingReceipt] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [hasNextPage, setHasNextPage] = useState(false);
  const productGridRef = useRef<HTMLDivElement>(null);
  const pageSizeRef = useRef(DEFAULT_PAGE_SIZE);
  const loadRequestId = useRef(0);
  const searchRef = useRef<HTMLInputElement>(null);
  const amountTenderedRef = useRef<HTMLInputElement>(null);
  const checkoutLock = useRef(false);
  const printingLock = useRef(false);

  const load = useCallback(async (keepCurrentResults = false) => {
    const requestId = ++loadRequestId.current;
    if (!keepCurrentResults) setLoading(true);
    setLoadError("");
    try {
      const [productRows, catalogValue, session] = await Promise.all([
        window.pos.listProducts({
          search,
          categoryId,
          nicheId,
          // One extra result makes the Next state accurate without a count query.
          limit: pageSize + 1,
          offset,
        }),
        window.pos.listCatalog(),
        window.pos.getCashSession(),
      ]);
      if (requestId !== loadRequestId.current) return;
      const pageRows = productRows as Product[];
      setProducts(pageRows.slice(0, pageSize));
      setHasNextPage(pageRows.length > pageSize);
      setCatalog(catalogValue as Catalog);
      setCashSession(session);
      if (!registerPromptChecked.current) {
        registerPromptChecked.current = true;
        if (canManageRegister && !session) setShowRegister(true);
      }
    } catch (value) {
      if (requestId === loadRequestId.current) setLoadError(localizeError(language, value));
    } finally {
      if (requestId === loadRequestId.current) setLoading(false);
    }
  }, [canManageRegister, categoryId, language, nicheId, offset, pageSize, search]);
  useEffect(() => {
    void load();
  }, [load]);
  useEffect(() => window.pos.onDataSyncComplete(() => void load(true)), [load]);
  useEffect(() => {
    if (loading || loadError) return;
    const grid = productGridRef.current;
    if (!grid) return;

    const measurePageCapacity = () => {
      const style = window.getComputedStyle(grid);
      const columns = style.gridTemplateColumns.split(/\s+/).filter(Boolean).length;
      const rowHeight = Number.parseFloat(style.gridAutoRows);
      const rowGap = Number.parseFloat(style.rowGap) || 0;
      if (!columns || !grid.clientHeight || !rowHeight) return;
      const rows = Math.max(1, Math.floor((grid.clientHeight + rowGap) / (rowHeight + rowGap)));
      const capacity = Math.min(columns * rows, MAX_PAGE_SIZE);
      if (capacity === pageSizeRef.current) return;
      pageSizeRef.current = capacity;
      setPageSize(capacity);
      setOffset(0);
    };

    measurePageCapacity();
    const observer = new ResizeObserver(measurePageCapacity);
    observer.observe(grid);
    return () => observer.disconnect();
  }, [loading, loadError]);
  useEffect(() => {
    const updateSession = () => {
      void window.pos.getCashSession().then((session) => {
        setCashSession(session);
        if (!session) setShowRegister(false);
      }).catch(() => undefined);
    };
    window.addEventListener(CASH_SESSION_UPDATED_EVENT, updateSession);
    return () => window.removeEventListener(CASH_SESSION_UPDATED_EVENT, updateSession);
  }, []);
  const visibleCategories = useMemo(
    () => catalog?.categories.filter((category) => !nicheId || category.niche_id === nicheId) ?? [],
    [catalog, nicheId],
  );
  const total = useMemo(
    () =>
      cart.reduce(
        (sum, line) =>
          sum +
          Math.max(0, (line.unitPrice ?? line.product.price) - line.product.discount) *
            line.quantity,
        0,
      ),
    [cart],
  );
  const tendered = Number(amountTendered || 0),
    change = Math.max(0, tendered - total);
  useEffect(() => setAmountTendered(""), [total]);
  function add(product: Product, unitPrice?: number) {
    if (product.price_on_request && unitPrice === undefined) {
      setPriceProduct(product);
      return;
    }
    setCart((current) => {
      const found = current.find(
        (line) => line.product.local_id === product.local_id,
      );
      if (!found) return [...current, { product, quantity: 1, unitPrice }];
      if (
        product.inventory_policy === "TRACKED" &&
        found.quantity >= product.stock
      ) {
        onNotice(`${localized(product)}: ${t("insufficientStock")}`);
        return current;
      }
      return current.map((line) =>
        line === found ? { ...line, quantity: line.quantity + 1 } : line,
      );
    });
  }
  async function scanProduct(rawValue = search) {
    const candidates = barcodeSearchTerms(rawValue);
    if (!candidates.length) return;
    try {
      let exact: Product | undefined;
      for (const candidate of candidates) {
        const matches = await window.pos.listProducts({ search: candidate, limit: 250, offset: 0 }) as Product[];
        exact = matches.find((product) => {
          return Boolean(product.barcode && barcodeMatches(product.barcode, candidate)) ||
            Boolean(product.sku && product.sku.toLowerCase() === candidate.toLowerCase());
        });
        if (exact) break;
      }
      if (!exact) return onNotice(t("barcodeNotFound"));
      add(exact);
      setSearch("");
      setOffset(0);
      searchRef.current?.focus();
    } catch (error) {
      onNotice(localizeError(language, error));
    }
  }
  async function holdCurrentCart() {
    if (!cart.length || holdingSale) return false;
    setHoldingSale(true);
    try {
      await window.pos.holdCart({
        customerName: customerName.trim() || undefined,
        lines: cart.map((line) => ({ productLocalId: line.product.local_id, quantity: line.quantity, unitPrice: line.unitPrice })),
      });
      setCart([]);
      setCustomerName("");
      onNotice(t("saleHeld"));
      searchRef.current?.focus();
      return true;
    } catch (error) {
      onNotice(localizeError(language, error));
      return false;
    } finally {
      setHoldingSale(false);
    }
  }
  useEffect(() => {
    const holdSale = () => void holdCurrentCart();
    window.addEventListener(HOLD_SALE_SHORTCUT_EVENT, holdSale);
    return () => window.removeEventListener(HOLD_SALE_SHORTCUT_EVENT, holdSale);
  }, [cart, customerName, holdingSale, language]);
  useEffect(() => {
    const changeProductPage = (event: Event) => {
      if (loading || loadError) return;
      const direction = (event as CustomEvent<{ direction?: "next" | "previous" }>).detail?.direction;
      if (direction === "next" && hasNextPage) setOffset((current) => current + pageSize);
      if (direction === "previous" && offset > 0) setOffset((current) => Math.max(0, current - pageSize));
    };
    window.addEventListener(POS_PAGE_SHORTCUT_EVENT, changeProductPage);
    return () => window.removeEventListener(POS_PAGE_SHORTCUT_EVENT, changeProductPage);
  }, [hasNextPage, loadError, loading, offset, pageSize]);
  useEffect(() => {
    const focusTenderedAmount = () => amountTenderedRef.current?.focus();
    window.addEventListener(FOCUS_TENDERED_AMOUNT_EVENT, focusTenderedAmount);
    return () => window.removeEventListener(FOCUS_TENDERED_AMOUNT_EVENT, focusTenderedAmount);
  }, []);
  useEffect(() => {
    const requestLauncher = (event: Event) => {
      const complete = (event as CustomEvent<{ complete?: () => void }>).detail?.complete;
      if (!complete) return;
      if (!cart.length) {
        complete();
        return;
      }
      if (!window.confirm(t("holdBeforeNavigationConfirm"))) return;
      void holdCurrentCart().then((held) => { if (held) complete(); });
    };
    window.addEventListener(SAFE_POS_EXIT_REQUEST_EVENT, requestLauncher);
    return () => window.removeEventListener(SAFE_POS_EXIT_REQUEST_EVENT, requestLauncher);
  }, [cart, customerName, holdingSale, language]);
  async function openHeldCarts() {
    try {
      setHeldCarts(await window.pos.listHeldCarts() as any[]);
      setShowHeldCarts(true);
    } catch (error) { onNotice(localizeError(language, error)); }
  }
  async function resumeCart(held: any) {
    const lines = (held.payload?.lines ?? []).map((line: any) => ({
      product: line.product as Product,
      quantity: Number(line.quantity),
      unitPrice: line.unitPrice,
    }));
    setCart(lines);
    setCustomerName(held.customer_name ?? "");
    await window.pos.deleteHeldCart(held.id);
    setShowHeldCarts(false);
    onNotice(t("saleResumed"));
  }
  function changeQuantity(id: string, quantity: number) {
    setCart((current) =>
      current
        .map((line) => {
          if (line.product.local_id !== id) return line;
          const safe =
            line.product.inventory_policy === "TRACKED"
              ? Math.min(quantity, line.product.stock)
              : quantity;
          return { ...line, quantity: safe };
        })
        .filter((line) => line.quantity > 0),
    );
  }
  async function checkout() {
    if (checkoutLock.current || busy) return;
    if (!cashSession) return setShowRegister(true);
    if (!cart.length || tendered < total) return;
    checkoutLock.current = true;
    setBusy(true);
    try {
      const sale = await window.pos.checkout({
        paymentMethod: "CASH",
        amountTendered: tendered,
        customerName: customerName.trim() || undefined,
        lines: cart.map((line) => ({
          productLocalId: line.product.local_id,
          quantity: line.quantity,
          unitPrice: line.unitPrice,
        })),
      });
      if ((sale as any).cashDrawerError) onNotice(localizeError(language, (sale as any).cashDrawerError));
      setCompletedSale(sale);
      setCart([]);
      setCustomerName("");
      await load();
      await onChanged();
    } catch (error) {
      onNotice(localizeError(language, error));
    } finally {
      checkoutLock.current = false;
      setBusy(false);
    }
  }
  const startNextSale = useCallback(() => {
    setCompletedSale(null);
    setSearch("");
    setOffset(0);
    window.setTimeout(() => searchRef.current?.focus(), 0);
  }, []);
  const printAndStartNextSale = useCallback(async () => {
    if (!completedSale || printingLock.current) return;
    printingLock.current = true;
    setPrintingReceipt(true);
    try {
      await window.pos.printReceipt({ saleId: completedSale.id });
      startNextSale();
    } catch (error) {
      onNotice(localizeError(language, error));
    } finally {
      printingLock.current = false;
      setPrintingReceipt(false);
    }
  }, [completedSale, language, onNotice, startNextSale]);
  useEffect(() => {
    const completeSale = () => void checkout();
    window.addEventListener(COMPLETE_SALE_SHORTCUT_EVENT, completeSale);
    return () => window.removeEventListener(COMPLETE_SALE_SHORTCUT_EVENT, completeSale);
  });
  useEffect(() => {
    if (!completedSale) return;
    const handleCompletedSaleKeys = (event: KeyboardEvent) => {
      if (event.repeat) return;
      if (event.key === "F9") {
        event.preventDefault();
        event.stopPropagation();
        void printAndStartNextSale();
      } else if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        startNextSale();
      }
    };
    window.addEventListener("keydown", handleCompletedSaleKeys);
    return () => window.removeEventListener("keydown", handleCompletedSaleKeys);
  }, [completedSale, printAndStartNextSale, startNextSale]);
  const localized = (row: any) =>
    language === "ar" && row.name_ar ? row.name_ar : row.name;
  const dismissRegisterPrompt = () => {
    setShowRegister(false);
  };

  return (
    <>
      <div className="pos-terminal">
        <section className="sell-workspace">
          <div className="pos-utility">
            <div>
              <p className="eyebrow">
                {new Intl.DateTimeFormat(localeFor(language), {
                  weekday: "short",
                  day: "numeric",
                  month: "short",
                }).format(new Date())}
              </p>
              <strong>{t("products")}</strong>
            </div>
            <div
              className={
                cashSession ? "register-state ready" : "register-state"
              }
            >
              <i />
              {cashSession ? t("registerReady") : t("cashRequired")}
              {canManageRegister && (
                <button type="button" onClick={() => setShowRegister(true)}>
                  {cashSession ? t("manageRegister") : t("openRegister")}
                </button>
              )}
            </div>
          </div>
          <div className="category-rail">
            <button
              className={`category-tile ${categoryId === undefined ? "active" : ""}`}
              onClick={() => {
                setCategoryId(undefined);
                setOffset(0);
              }}
            >
              <span>
                <ShoppingBag />
              </span>
              <strong>{t("allCategoriesShort")}</strong>
              <small>{t("productsAvailable")}</small>
            </button>
            {visibleCategories.map((item) => (
              <button
                className={`category-tile ${categoryId === item.id ? "active" : ""}`}
                key={item.id}
                onClick={() => {
                  setCategoryId(item.id);
                  setOffset(0);
                }}
              >
                <span>
                  {item.image ? (
                    <img src={item.image} alt="" />
                  ) : (
                    <b className="category-initials">
                      {initials(localized(item))}
                    </b>
                  )}
                </span>
                <strong>{localized(item)}</strong>
                <small>
                  {item.product_count ?? 0} {t("productsAvailable")}
                </small>
              </button>
            ))}
          </div>
          <div className="pos-search-row">
            <div className="pos-search">
              <Search />
              <input
                data-keyboard-search
                ref={searchRef}
                value={search}
                onChange={(event) => {
                  setSearch(event.target.value);
                  setOffset(0);
                }}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    event.preventDefault();
                    void scanProduct(event.currentTarget.value);
                  }
                }}
                placeholder={t("searchProducts")}
                autoFocus
              />
              <kbd>F2</kbd>
            </div>
            {catalog && catalog.niches.length > 1 ? (
              <label className="pos-niche-filter" title={t("niche")}>
                <Filter aria-hidden="true" />
                <select
                  aria-label={t("niche")}
                  value={nicheId ?? ""}
                  onChange={(event) => {
                    setNicheId(event.target.value ? Number(event.target.value) : undefined);
                    setCategoryId(undefined);
                    setOffset(0);
                  }}
                >
                  <option value="">{t("allNiches")}</option>
                  {catalog.niches.map((niche) => <option key={niche.id} value={niche.id}>{localized(niche)}</option>)}
                </select>
              </label>
            ) : null}
          </div>
          {loading ? (
            <LoadingState label={t("loadingData")} />
          ) : loadError ? (
            <ErrorState
              title={t("unableToLoad")}
              text={loadError || t("tryAgainText")}
              retryLabel={t("retry")}
              onRetry={() => void load()}
            />
          ) : (
            <div className="product-grid pos-product-grid" ref={productGridRef}>
              {products.map((product) => {
                const unavailable =
                  product.inventory_policy === "TRACKED" && product.stock <= 0;
                return (
                  <button
                    className="product-card pos-product-card"
                    key={product.local_id}
                    onClick={() => add(product)}
                    disabled={unavailable}
                  >
                    <div className="product-image">
                      {product.image ? (
                        <img src={product.image} alt="" loading="lazy" />
                      ) : (
                        <ShoppingBag />
                      )}
                      {unavailable && <em>{t("outOfStock")}</em>}
                    </div>
                    <div className="product-copy">
                      <strong>{localized(product)}</strong>
                      {product.price_on_request ? <em className="badge warning">{t("priceOnRequest")}</em> : null}
                      <small>
                        {product.variant_name || product.sku || t("standard")}
                      </small>
                    </div>
                    <footer>
                      <span
                        className={
                          product.stock <= product.reorder_threshold
                            ? "stock-low"
                            : ""
                        }
                      >
                        {product.inventory_policy === "UNLIMITED"
                          ? t("unlimited")
                          : `${product.stock} ${t("left")}`}
                      </span>
                      <b>
                        {money(Math.max(0, product.price - product.discount))}
                      </b>
                    </footer>
                  </button>
                );
              })}
            </div>
          )}
          {!loading && !loadError && !products.length && (
            <EmptyState
              icon={PackageOpen}
              title={t("noProducts")}
              text={t("noProductsText")}
            />
          )}
          {!loading && !loadError && (
            <Pagination
              className="pos-pagination"
              page={Math.floor(offset / pageSize)}
              pageSize={pageSize}
              hasNext={hasNextPage}
              onPageChange={(page) => setOffset(page * pageSize)}
            />
          )}
        </section>
        <aside className="checkout-panel">
          <div className="checkout-head">
            <div>
              <p className="eyebrow">{t("currentSale")}</p>
              <h2>
                {cart.length
                  ? `${cart.reduce((sum, line) => sum + line.quantity, 0)} ${t("items")}`
                  : t("newSale")}
              </h2>
            </div>
            {cart.length > 0 && (
              <div className="checkout-head-actions">
                <button className="quiet-action" aria-keyshortcuts="F3" title={`${t("holdSale")} (F3)`} disabled={!cart.length || holdingSale} onClick={() => void holdCurrentCart()}>{holdingSale ? <LoaderCircle className="spin" /> : <Pause />}{t("holdSale")}<kbd aria-hidden="true">F3</kbd></button>
                <button className="quiet-action" onClick={() => setCart([])}><Trash2 />{t("clearSale")}</button>
              </div>
            )}
          </div>
          <button type="button" className="held-sales-button" onClick={() => void openHeldCarts()}><ArchiveRestore />{t("heldSales")}</button>
          <label className="customer-field">
            <UserRound />
            <input
              value={customerName}
              onChange={(event) => setCustomerName(event.target.value)}
              placeholder={`${t("customerName")} · ${t("optional")}`}
            />
          </label>
          <div className="checkout-lines">
            {cart.length === 0 ? (
              <EmptyState
                icon={ShoppingBag}
                title={t("emptyCart")}
                text={t("emptyCartText")}
              />
            ) : (
              cart.map((line) => (
                <article className="checkout-line" key={line.product.local_id}>
                  <div className="line-thumb">
                    <ProductThumbnail image={line.product.image} />
                  </div>
                  <div className="line-copy">
                    <strong>{localized(line.product)}</strong>
                    <small>{line.product.variant_name || t("standard")}</small>
                    {line.product.price_on_request ? <em className="badge warning">{t("priceOnRequest")}</em> : null}
                    <b>
                      {money(
                        Math.max(
                          0,
                          (line.unitPrice ?? line.product.price) - line.product.discount,
                        ) * line.quantity,
                      )}
                    </b>
                  </div>
                  <div className="line-controls">
                    <button
                      type="button"
                      aria-label={`${t("decreaseQuantity")} ${localized(line.product)}`}
                      title={t("decreaseQuantity")}
                      onClick={() =>
                        changeQuantity(line.product.local_id, line.quantity - 1)
                      }
                    >
                      −
                    </button>
                    <span>{line.quantity}</span>
                    <button
                      type="button"
                      aria-label={`${t("increaseQuantity")} ${localized(line.product)}`}
                      title={t("increaseQuantity")}
                      onClick={() =>
                        changeQuantity(line.product.local_id, line.quantity + 1)
                      }
                    >
                      +
                    </button>
                  </div>
                  <button
                    type="button"
                    className="line-remove"
                    aria-label={t("remove")}
                    title={t("remove")}
                    onClick={() => changeQuantity(line.product.local_id, 0)}
                  >
                    <X />
                  </button>
                </article>
              ))
            )}
          </div>
          <div className="cash-checkout">
            <div className="total-row">
              <span>{t("total")}</span>
              <strong>{money(total)}</strong>
            </div>
            <div className="cash-label">
              <span>{t("amountTendered")} <kbd aria-hidden="true">F6</kbd></span>
              <small>{t("cashPayment")}</small>
            </div>
            <label className="cash-input">
              <CircleDollarSign />
              <input
                ref={amountTenderedRef}
                type="number"
                min={total}
                step="1"
                value={amountTendered}
                onChange={(event) => setAmountTendered(event.target.value)}
                aria-keyshortcuts="F6"
                title={`${t("amountTendered")} (F6)`}
              />
              <span>DZD</span>
            </label>
            <div className="change-row">
              <span>{t("changeDue")}</span>
              <strong>{money(change)}</strong>
            </div>
            <button
              className="complete-sale"
              aria-keyshortcuts="F10"
              title={`${t("completeSale")} (F10)`}
              disabled={
                !cart.length || !cashSession || tendered < total || busy
              }
              onClick={checkout}
            >
              {busy ? <LoaderCircle className="spin" /> : <Check />}
              <span>{t("completeSale")}</span>
              <b>{money(total)}</b>
              <kbd aria-hidden="true">F10</kbd>
            </button>
          </div>
        </aside>
      </div>
      {showRegister && (
        <Modal onClose={() => cashSession && dismissRegisterPrompt()}>
          {cashSession ? (
            <div className="register-dialog">
              <span className="dialog-icon"><CircleDollarSign /></span>
              <h2>{t("registerSessionActive")}</h2>
              <p>{t("registerSessionActiveHelp")}</p>
              <div className="register-session-summary">
                <span><small>{t("openingCash")}</small><strong>{money(cashSession.opening_amount)}</strong></span>
                <span><small>{t("expectedCash")}</small><strong>{money(cashSession.expected_cash)}</strong></span>
              </div>
              <small className="register-session-date">{t("sessionStarted")}: {new Date(cashSession.opened_at).toLocaleString(localeFor(language))}</small>
              {canManageRegister ? <form onSubmit={async (event) => {
                event.preventDefault();
                const countedCash = Number(new FormData(event.currentTarget).get("counted"));
                setRegisterBusy(true);
                try {
                  await window.pos.closeCashSession({ countedCash });
                  setCashSession(null);
                  setShowRegister(false);
                  onNotice(t("registerClosed"));
                } catch (error) {
                  onNotice(localizeError(language, error));
                } finally {
                  setRegisterBusy(false);
                }
              }}>
                <label>
                  {t("countedCash")}
                  <div className="money-field">
                    <input name="counted" type="number" min="0" step="1" defaultValue="0" required />
                    <span>DZD</span>
                  </div>
                </label>
                <div className="dialog-actions">
                  <button type="button" className="button secondary" onClick={dismissRegisterPrompt}>{t("continueRegister")}</button>
                  <button className="button danger" disabled={registerBusy}>
                    {registerBusy ? <LoaderCircle className="spin" /> : null}
                    {t("closeRegister")}
                  </button>
                </div>
              </form> : <div className="dialog-actions register-session-continue"><button type="button" className="button primary" onClick={dismissRegisterPrompt}>{t("continueRegister")}</button></div>}
            </div>
          ) : (
            <form className="register-dialog" onSubmit={async (event) => {
              event.preventDefault();
              const openingAmount = Number(new FormData(event.currentTarget).get("opening"));
              setRegisterBusy(true);
              try {
                setCashSession(await window.pos.openCashSession({ openingAmount }));
                setShowRegister(false);
                onNotice(t("registerOpen"));
              } catch (error) {
                onNotice(localizeError(language, error));
              } finally {
                setRegisterBusy(false);
              }
            }}>
              <span className="dialog-icon"><CircleDollarSign /></span>
              <h2>{t("openRegisterTitle")}</h2>
              <p>{t("openRegisterHelp")}</p>
              <label>
                {t("openingCash")}
                <div className="money-field">
                  <input name="opening" type="number" min="0" step="1" defaultValue="0" autoFocus required />
                  <span>DZD</span>
                </div>
              </label>
              <div className="dialog-actions">
                <button type="button" className="button secondary" onClick={() => setShowRegister(false)}>{t("cancel")}</button>
                <button className="button primary" disabled={registerBusy}>
                  {registerBusy ? <LoaderCircle className="spin" /> : null}
                  {t("openRegister")}
                </button>
              </div>
            </form>
          )}
        </Modal>
      )}
      {priceProduct && (
        <Modal onClose={() => setPriceProduct(null)}>
          <form className="register-dialog" onSubmit={(event) => {
            event.preventDefault();
            const value = Number(new FormData(event.currentTarget).get("price"));
            if (!Number.isFinite(value) || value <= 0) return;
            add(priceProduct, value);
            setPriceProduct(null);
          }}>
            <h2>{t("confirmSellingPrice")}</h2>
            <p>{localized(priceProduct)}</p>
            <label>{t("sellingPrice")}<div className="money-field"><input name="price" type="number" min="0.01" step="0.01" autoFocus required /><span>DZD</span></div></label>
            <div className="dialog-actions"><button type="button" className="button secondary" onClick={() => setPriceProduct(null)}>{t("cancel")}</button><button className="button primary">{t("confirm")}</button></div>
          </form>
        </Modal>
      )}
      {showHeldCarts && (
        <Modal onClose={() => setShowHeldCarts(false)}>
          <div className="held-carts-dialog">
            <div className="dialog-heading"><div><p className="eyebrow">{t("heldSales")}</p><h2>{t("resumeSale")}</h2></div><button type="button" className="icon-button" onClick={() => setShowHeldCarts(false)}><X /></button></div>
            {heldCarts.length ? <div className="held-cart-list">{heldCarts.map((held) => <button type="button" key={held.id} onClick={() => void resumeCart(held)}><span className="held-cart-preview" aria-hidden="true">{(held.payload?.lines ?? []).slice(0, 3).map((line: any, index: number) => line.product?.image ? <img key={`${line.product_local_id ?? line.product?.local_id ?? index}-${index}`} src={line.product.image} alt="" /> : <span key={`${line.product_local_id ?? index}-${index}`}><PackageOpen /></span>)}</span><span className="held-cart-summary"><strong>{held.customer_name || t("walkInCustomer")}</strong><small>{new Date(held.updated_at).toLocaleString(localeFor(language))}</small></span><b>{held.payload?.lines?.reduce((sum: number, line: any) => sum + Number(line.quantity), 0) ?? 0} {t("items")}</b></button>)}</div> : <EmptyState icon={ArchiveRestore} title={t("noHeldSales")} text={t("noHeldSalesText")} />}
          </div>
        </Modal>
      )}
      {completedSale && (
        <Modal onClose={() => setCompletedSale(null)}>
          <div className="success-dialog">
            <span className="success-mark">
              <Check />
            </span>
            <p className="eyebrow">{completedSale.sale_number}</p>
            <h2>{t("saleComplete")}</h2>
            <strong>{money(completedSale.total)}</strong>
            <p>{t("saleCompleteHelp")}</p>
            <div className="dialog-actions">
              <button
                className="button secondary"
                aria-keyshortcuts="F9"
                disabled={printingReceipt}
                onClick={() => void printAndStartNextSale()}
              >
                {printingReceipt ? <LoaderCircle className="spin" /> : <Printer />}
                {t("printReceipt")}
                <kbd aria-hidden="true">F9</kbd>
              </button>
              <button
                className="button primary"
                aria-keyshortcuts="Escape"
                title={`${t("newSaleAction")} (Esc)`}
                onClick={startNextSale}
              >
                {t("newSaleAction")}
                <kbd aria-hidden="true">Esc</kbd>
              </button>
            </div>
          </div>
        </Modal>
      )}
    </>
  );
}

function Modal({
  children,
  onClose,
}: {
  children: React.ReactNode;
  onClose: () => void;
}) {
  return (
    <div
      className="modal-backdrop"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div className="modal-card" role="dialog" aria-modal="true">
        {children}
      </div>
    </div>
  );
}
