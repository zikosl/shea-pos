import { useEffect, useMemo, useRef, useState } from "react";
import {
  Check,
  ChevronLeft,
  ChevronRight,
  CircleDollarSign,
  LoaderCircle,
  PackageOpen,
  Printer,
  Search,
  ShoppingBag,
  Trash2,
  UserRound,
  X,
} from "lucide-react";
import { EmptyState } from "../../components/EmptyState";
import { ErrorState, LoadingState } from "../../components/AsyncState";
import { localeFor, localizeError, useI18n } from "../../i18n";
import { money } from "../../shared/format";
import type { CartLine, Catalog, Product } from "../../types";

const PAGE_SIZE = 40;
const initials = (name: string) =>
  name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((word) => word[0])
    .join("")
    .toUpperCase();

export function PosScreen({
  onNotice,
  onChanged,
}: {
  onNotice: (message: string) => void;
  onChanged: () => Promise<void>;
}) {
  const { t, language } = useI18n();
  const [products, setProducts] = useState<Product[]>([]),
    [catalog, setCatalog] = useState<Catalog | null>(null);
  const [cart, setCart] = useState<CartLine[]>([]),
    [search, setSearch] = useState(""),
    [customerName, setCustomerName] = useState("");
  const [categoryId, setCategoryId] = useState<number>(),
    [offset, setOffset] = useState(0),
    [busy, setBusy] = useState(false);
  const [cashSession, setCashSession] = useState<any>(null),
    [showRegister, setShowRegister] = useState(false),
    [completedSale, setCompletedSale] = useState<any>(null);
  const [amountTendered, setAmountTendered] = useState("");
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const searchRef = useRef<HTMLInputElement>(null);

  const load = async () => {
    setLoading(true);
    setLoadError("");
    try {
      const [productRows, catalogValue, session] = await Promise.all([
        window.pos.listProducts({
          search,
          categoryId,
          limit: PAGE_SIZE,
          offset,
        }),
        window.pos.listCatalog(),
        window.pos.getCashSession(),
      ]);
      setProducts(productRows as Product[]);
      setCatalog(catalogValue as Catalog);
      setCashSession(session);
    } catch (value) {
      setLoadError(localizeError(language, value));
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => {
    void load();
  }, [search, categoryId, offset]);
  const total = useMemo(
    () =>
      cart.reduce(
        (sum, line) =>
          sum +
          Math.max(0, line.product.price - line.product.discount) *
            line.quantity,
        0,
      ),
    [cart],
  );
  const tendered = Number(amountTendered || 0),
    change = Math.max(0, tendered - total);
  const cashOptions = useMemo(() => suggestedCash(total), [total]);
  useEffect(() => setAmountTendered(total ? String(total) : ""), [total]);
  useEffect(() => {
    const shortcut = (event: KeyboardEvent) => {
      if (event.key === "F2") {
        event.preventDefault();
        searchRef.current?.focus();
      }
      if (event.key === "Escape" && !completedSale) setCart([]);
    };
    addEventListener("keydown", shortcut);
    return () => removeEventListener("keydown", shortcut);
  }, [completedSale]);

  function add(product: Product) {
    setCart((current) => {
      const found = current.find(
        (line) => line.product.local_id === product.local_id,
      );
      if (!found) return [...current, { product, quantity: 1 }];
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
    if (!cashSession) return setShowRegister(true);
    setBusy(true);
    try {
      const sale = await window.pos.checkout({
        paymentMethod: "CASH",
        amountTendered: tendered,
        customerName: customerName.trim() || undefined,
        lines: cart.map((line) => ({
          productLocalId: line.product.local_id,
          quantity: line.quantity,
        })),
      });
      setCompletedSale(sale);
      setCart([]);
      setCustomerName("");
      await load();
      await onChanged();
    } catch (error) {
      onNotice(localizeError(language, error));
    } finally {
      setBusy(false);
    }
  }
  const localized = (row: any) =>
    language === "ar" && row.name_ar ? row.name_ar : row.name;

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
              {!cashSession && (
                <button onClick={() => setShowRegister(true)}>
                  {t("openRegister")}
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
            {catalog?.categories.map((item) => (
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
          <div className="pos-search">
            <Search />
            <input
              ref={searchRef}
              value={search}
              onChange={(event) => {
                setSearch(event.target.value);
                setOffset(0);
              }}
              placeholder={t("searchProducts")}
              autoFocus
            />
            <kbd>F2</kbd>
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
            <div className="product-grid pos-product-grid">
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
            <div className="pagination pos-pagination">
              <button
                onClick={() => setOffset(Math.max(0, offset - PAGE_SIZE))}
                disabled={!offset}
              >
                <ChevronLeft />
              </button>
              <span>
                {t("page")} {offset / PAGE_SIZE + 1}
              </span>
              <button
                onClick={() => setOffset(offset + PAGE_SIZE)}
                disabled={products.length < PAGE_SIZE}
              >
                <ChevronRight />
              </button>
            </div>
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
              <button className="quiet-action" onClick={() => setCart([])}>
                <Trash2 />
                {t("clearSale")}
              </button>
            )}
          </div>
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
                    {line.product.image ? (
                      <img src={line.product.image} alt="" />
                    ) : (
                      <ShoppingBag />
                    )}
                  </div>
                  <div className="line-copy">
                    <strong>{localized(line.product)}</strong>
                    <small>{line.product.variant_name || t("standard")}</small>
                    <b>
                      {money(
                        Math.max(
                          0,
                          line.product.price - line.product.discount,
                        ) * line.quantity,
                      )}
                    </b>
                  </div>
                  <div className="line-controls">
                    <button
                      onClick={() =>
                        changeQuantity(line.product.local_id, line.quantity - 1)
                      }
                    >
                      −
                    </button>
                    <span>{line.quantity}</span>
                    <button
                      onClick={() =>
                        changeQuantity(line.product.local_id, line.quantity + 1)
                      }
                    >
                      +
                    </button>
                  </div>
                  <button
                    className="line-remove"
                    aria-label={t("remove")}
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
              <span>{t("amountTendered")}</span>
              <small>{t("cashPayment")}</small>
            </div>
            <div className="cash-options">
              {cashOptions.map((amount, index) => (
                <button
                  key={amount}
                  className={tendered === amount ? "active" : ""}
                  onClick={() => setAmountTendered(String(amount))}
                >
                  {index === 0 ? t("exact") : money(amount)}
                </button>
              ))}
            </div>
            <label className="cash-input">
              <CircleDollarSign />
              <input
                type="number"
                min={total}
                step="1"
                value={amountTendered}
                onChange={(event) => setAmountTendered(event.target.value)}
              />
              <span>DZD</span>
            </label>
            <div className="change-row">
              <span>{t("changeDue")}</span>
              <strong>{money(change)}</strong>
            </div>
            <button
              className="complete-sale"
              disabled={
                !cart.length || !cashSession || tendered < total || busy
              }
              onClick={checkout}
            >
              {busy ? <LoaderCircle className="spin" /> : <Check />}
              <span>{t("completeSale")}</span>
              <b>{money(total)}</b>
            </button>
          </div>
        </aside>
      </div>
      {showRegister && (
        <Modal onClose={() => setShowRegister(false)}>
          <form
            className="register-dialog"
            onSubmit={async (event) => {
              event.preventDefault();
              const form = new FormData(event.currentTarget);
              try {
                setCashSession(
                  await window.pos.openCashSession({
                    openingAmount: Number(form.get("opening")),
                  }),
                );
                setShowRegister(false);
                onNotice(t("registerOpen"));
              } catch (error) {
                onNotice(localizeError(language, error));
              }
            }}
          >
            <span className="dialog-icon">
              <CircleDollarSign />
            </span>
            <h2>{t("openRegisterTitle")}</h2>
            <p>{t("openRegisterHelp")}</p>
            <label>
              {t("openingCash")}
              <div className="money-field">
                <input
                  name="opening"
                  type="number"
                  min="0"
                  defaultValue="0"
                  autoFocus
                  required
                />
                <span>DZD</span>
              </div>
            </label>
            <div className="dialog-actions">
              <button
                type="button"
                className="button secondary"
                onClick={() => setShowRegister(false)}
              >
                {t("cancel")}
              </button>
              <button className="button primary">{t("openRegister")}</button>
            </div>
          </form>
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
                onClick={() =>
                  window.pos
                    .printReceipt({ saleId: completedSale.id })
                    .catch((error) => onNotice(localizeError(language, error)))
                }
              >
                <Printer />
                {t("printReceipt")}
              </button>
              <button
                className="button primary"
                onClick={() => {
                  setCompletedSale(null);
                  searchRef.current?.focus();
                }}
              >
                {t("newSaleAction")}
              </button>
            </div>
          </div>
        </Modal>
      )}
    </>
  );
}

function suggestedCash(total: number) {
  if (!total) return [];
  const values = [total];
  for (const denomination of [50, 100, 200, 500, 1000, 2000, 5000]) {
    const rounded = Math.ceil(total / denomination) * denomination;
    const candidate = rounded === total ? total + denomination : rounded;
    if (!values.includes(candidate)) values.push(candidate);
  }
  return values.slice(0, 5);
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
