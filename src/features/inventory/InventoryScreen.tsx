import { useEffect, useMemo, useState } from "react";
import {
  Boxes,
  Check,
  ChevronLeft,
  ChevronRight,
  History,
  ImageDown,
  LoaderCircle,
  PackagePlus,
  Printer,
  Search,
  SlidersHorizontal,
} from "lucide-react";
import { EmptyState } from "../../components/EmptyState";
import { ErrorState, LoadingState } from "../../components/AsyncState";
import { PageHeader } from "../../components/PageHeader";
import {
  ImagePreview,
  type ImagePreviewItem,
} from "../../components/ImagePreview";
import {
  localeFor,
  localizeError,
  localizeReason,
  localizeValue,
  useI18n,
} from "../../i18n";
import type { Catalog, Product } from "../../types";

type Changes = Omit<
  Parameters<typeof window.pos.updateProduct>[0],
  "productLocalId"
>;
type Tab = "products" | "catalog" | "movements";
type AdjustmentMode = "RECEIVE" | "REMOVE" | "SET";

export function InventoryScreen({
  onNotice,
}: {
  onNotice: (message: string) => void;
}) {
  const { t, language } = useI18n();
  const [tab, setTab] = useState<Tab>("products");
  const [products, setProducts] = useState<Product[]>([]),
    [templates, setTemplates] = useState<any[]>([]),
    [movements, setMovements] = useState<any[]>([]);
  const [catalog, setCatalog] = useState<Catalog | null>(null),
    [search, setSearch] = useState(""),
    [page, setPage] = useState(0);
  const [filters, setFilters] = useState({
    niche: "",
    category: "",
    type: "",
    brand: "",
    status: "",
    movementType: "",
  });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [activating, setActivating] = useState<number | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [creating, setCreating] = useState(false);
  const [preview, setPreview] = useState<ImagePreviewItem | null>(null);
  const [adjustingProduct, setAdjustingProduct] = useState<any | null>(null);
  const [adjustmentMode, setAdjustmentMode] = useState<AdjustmentMode>("RECEIVE");
  const [adjustmentQuantity, setAdjustmentQuantity] = useState("1");
  const [adjusting, setAdjusting] = useState(false);
  const [selectedLabels, setSelectedLabels] = useState<Set<string>>(new Set());
  const [showLabels, setShowLabels] = useState(false);
  const [labelCopies, setLabelCopies] = useState("1");
  const [labelPreview, setLabelPreview] = useState("");
  const [printingLabels, setPrintingLabels] = useState(false);
  const [refreshingImage, setRefreshingImage] = useState<string | null>(null);
  const [refreshingImages, setRefreshingImages] = useState(false);
  const limit = 50;
  const load = async () => {
    setLoading(true);
    setError("");
    try {
      const [inventory, catalogValue, templateRows, movementRows] =
        await Promise.all([
          window.pos.listInventory({ search, limit: 250 }),
          window.pos.listCatalog(),
          window.pos.listTemplates({ search, limit: 250 }),
          window.pos.listMovements({
            search,
            type: filters.movementType || undefined,
            limit: 500,
          }),
        ]);
      setProducts(inventory as Product[]);
      setCatalog(catalogValue as Catalog);
      setTemplates(templateRows);
      setMovements(movementRows);
    } catch (value) {
      setError(localizeError(language, value));
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => {
    void load();
  }, [search, filters.movementType]);
  useEffect(() => setPage(0), [search, filters, tab]);

  const categories =
    catalog?.categories.filter(
      (row) => !filters.niche || row.niche_id === Number(filters.niche),
    ) ?? [];
  const productTypes =
    catalog?.productTypes.filter(
      (row) =>
        !filters.category || row.category_id === Number(filters.category),
    ) ?? [];
  const brands =
    catalog?.brands.filter(
      (row) => !filters.niche || row.niche_id === Number(filters.niche),
    ) ?? [];
  const filteredProducts = useMemo(
    () =>
      products.filter((row: any) => {
        if (filters.category && row.category_id !== Number(filters.category))
          return false;
        if (filters.type && row.product_type_id !== Number(filters.type))
          return false;
        if (filters.brand && row.brand_id !== Number(filters.brand))
          return false;
        if (
          filters.niche &&
          !categories.some((category) => category.id === row.category_id)
        )
          return false;
        if (
          filters.status === "low" &&
          !(
            row.inventory_policy === "TRACKED" &&
            row.stock <= row.reorder_threshold
          )
        )
          return false;
        if (
          filters.status === "out" &&
          !(row.inventory_policy === "TRACKED" && row.stock <= 0)
        )
          return false;
        if (
          filters.status === "unlimited" &&
          row.inventory_policy !== "UNLIMITED"
        )
          return false;
        if (filters.status === "hidden" && row.visible_in_pos) return false;
        if (filters.status === "inactive" && row.active) return false;
        return true;
      }),
    [products, filters, categories],
  );
  const filteredTemplates = templates.filter(
    (row) =>
      (!filters.category || row.category_id === Number(filters.category)) &&
      (!filters.type || row.product_type_id === Number(filters.type)) &&
      (!filters.brand || row.brand_id === Number(filters.brand)) &&
      (!filters.niche ||
        categories.some((category) => category.id === row.category_id)),
  );
  const current = (
    tab === "products"
      ? filteredProducts
      : tab === "catalog"
        ? filteredTemplates
        : movements
  ).slice(page * limit, (page + 1) * limit);
  const localized = (row: any) =>
    language === "ar" && row.name_ar ? row.name_ar : row.name;

  async function update(
    productLocalId: string,
    changes: Changes,
    notice: string,
  ) {
    try {
      await window.pos.updateProduct({ productLocalId, ...changes });
      onNotice(notice);
      await load();
    } catch (error) {
      onNotice(localizeError(language, error));
    }
  }
  async function refreshImage(product: any) {
    if (!window.confirm(t("refreshImageConfirm"))) return;
    setRefreshingImage(product.local_id);
    try {
      await window.pos.refreshProductImage({ productLocalId: product.local_id });
      onNotice(t("productImageRefreshed"));
      await load();
    } catch (value) {
      onNotice(localizeError(language, value));
    } finally {
      setRefreshingImage(null);
    }
  }
  async function refreshAllImages() {
    const eligible = filteredProducts.filter(
      (product: any) => !product.provisional && product.remote_image_url,
    );
    if (!eligible.length) return;
    if (!window.confirm(t("refreshImagesConfirm"))) return;
    setRefreshingImages(true);
    try {
      let result: { refreshed: number; failed: number; results?: Array<{ error?: string }> };
      try {
        result = (await window.pos.refreshProductImages({
          productLocalIds: eligible.map((product: any) => product.local_id),
        })) as { refreshed: number; failed: number };
      } catch (error) {
        // A renderer reload can briefly precede the Electron main-process restart.
        // Preserve the bulk action with the long-standing single-image channel.
        if (!(error instanceof Error) || !error.message.includes("No handler registered")) throw error;
        const outcomes = await Promise.allSettled(
          eligible.map((product: any) => window.pos.refreshProductImage({ productLocalId: product.local_id })),
        );
        result = {
          refreshed: outcomes.filter((outcome) => outcome.status === "fulfilled").length,
          failed: outcomes.filter((outcome) => outcome.status === "rejected").length,
          results: outcomes.map((outcome) => outcome.status === "rejected" ? { error: outcome.reason instanceof Error ? outcome.reason.message : String(outcome.reason) } : {}),
        };
      }
      const firstError = result.results?.find((outcome) => outcome.error)?.error;
      const notice = t(firstError ? "productImagesRefreshError" : "productImagesRefreshed")
        .replace("{refreshed}", String(result.refreshed))
        .replace("{failed}", String(result.failed))
        .replace("{error}", firstError || "");
      onNotice(
        notice,
      );
      await load();
    } catch (value) {
      onNotice(localizeError(language, value));
    } finally {
      setRefreshingImages(false);
    }
  }
  async function activate(row: any, event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    setActivating(row.variant_id);
    try {
      await window.pos.activateProduct({
        variantId: row.variant_id,
        price: Number(data.get("price")),
        costPrice: Number(data.get("costPrice")),
        stock: Number(data.get("stock")),
        reorderThreshold: Number(data.get("threshold")),
        trackInventory: data.get("tracked") === "on",
      });
      onNotice(`${localized(row)}: ${t("productActivated")}`);
      await load();
    } catch (error) {
      onNotice(localizeError(language, error));
    } finally {
      setActivating(null);
    }
  }
  async function createLocal(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    setCreating(true);
    try {
      await window.pos.createLocalProduct({
        name: String(data.get("name")),
        nameAr: String(data.get("nameAr") || ""),
        description: String(data.get("description") || ""),
        categoryId: Number(data.get("categoryId")),
        productTypeId: data.get("productTypeId")
          ? Number(data.get("productTypeId"))
          : undefined,
        brandId: data.get("brandId") ? Number(data.get("brandId")) : undefined,
        variantName: String(data.get("variantName") || "Default"),
        sku: String(data.get("sku") || ""),
        price: Number(data.get("price")),
        costPrice: Number(data.get("costPrice") || 0),
        stock: Number(data.get("stock") || 0),
        reorderThreshold: Number(data.get("threshold") || 0),
        trackInventory: data.get("tracked") === "on",
      });
      setShowCreate(false);
      setTab("products");
      onNotice(t("productRequestQueued"));
      await load();
    } catch (error) {
      onNotice(localizeError(language, error));
    } finally {
      setCreating(false);
    }
  }

  function openAdjustment(product: any) {
    setAdjustingProduct(product);
    setAdjustmentMode("RECEIVE");
    setAdjustmentQuantity("1");
  }

  async function submitAdjustment(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!adjustingProduct) return;
    const data = new FormData(event.currentTarget);
    setAdjusting(true);
    try {
      const reason = [data.get("reason"), data.get("note")]
        .map((value) => String(value || "").trim())
        .filter(Boolean)
        .join(" · ");
      await window.pos.adjustStock({
        productLocalId: adjustingProduct.local_id,
        mode: adjustmentMode,
        quantity: Number(adjustmentQuantity),
        reason,
      });
      setAdjustingProduct(null);
      onNotice(t("stockAdjusted"));
      await load();
    } catch (value) {
      onNotice(localizeError(language, value));
    } finally {
      setAdjusting(false);
    }
  }

  function toggleLabel(productLocalId: string) {
    setSelectedLabels((current) => {
      const next = new Set(current);
      if (next.has(productLocalId)) next.delete(productLocalId);
      else next.add(productLocalId);
      return next;
    });
  }

  function openLabelQueue(product?: any) {
    if (product && !selectedLabels.has(product.local_id))
      setSelectedLabels(new Set([product.local_id]));
    setShowLabels(true);
  }

  useEffect(() => {
    if (!showLabels || !selectedLabels.size) return;
    const first = products.find((row) => selectedLabels.has(row.local_id));
    if (!first) return;
    void window.pos
      .previewPriceLabel({ productLocalId: first.local_id })
      .then(setLabelPreview)
      .catch((value) => onNotice(localizeError(language, value)));
  }, [showLabels, selectedLabels, products]);

  async function printSelectedLabels() {
    setPrintingLabels(true);
    try {
      await window.pos.printPriceLabels({
        items: [...selectedLabels].map((productLocalId) => ({
          productLocalId,
          copies: Number(labelCopies),
        })),
      });
      setShowLabels(false);
      setSelectedLabels(new Set());
      onNotice(t("labelsPrinted"));
    } catch (value) {
      onNotice(localizeError(language, value));
    } finally {
      setPrintingLabels(false);
    }
  }

  const title =
    tab === "products"
      ? t("products")
      : tab === "catalog"
        ? t("availableTemplates")
        : t("movementHistory");
  const description =
    tab === "catalog"
      ? t("availableTemplatesText")
      : tab === "movements"
        ? t("movementHistoryText")
        : t("noProductsText");
  return (
    <div className="inventory-stack page-stack">
      <PageHeader
        eyebrow={t("inventory")}
        title={title}
        description={description}
        actions={
          <>
            {tab === "products" && filteredProducts.some((product: any) => !product.provisional && product.remote_image_url) ? (
              <button
                type="button"
                className="button secondary"
                onClick={() => void refreshAllImages()}
                disabled={refreshingImages}
                title={t("refreshProductImages")}
              >
                {refreshingImages ? <LoaderCircle className="spin" /> : <ImageDown />}
                {t("refreshProductImages")}
              </button>
            ) : null}
            {selectedLabels.size ? (
              <button type="button" className="button secondary" onClick={() => openLabelQueue()}>
                <Printer />
                {t("printLabels")} ({selectedLabels.size})
              </button>
            ) : null}
            <button type="button" className="button primary" onClick={() => setShowCreate(true)}>
              <PackagePlus />
              {t("createProduct")}
            </button>
          </>
        }
      />
      <div className="panel inventory-header controls-only">
        <div className="segmented inventory-tabs">
          <button
            className={tab === "products" ? "active" : ""}
            onClick={() => setTab("products")}
          >
            <Boxes />
            {t("products")}
          </button>
          <button
            className={tab === "catalog" ? "active" : ""}
            onClick={() => setTab("catalog")}
          >
            <PackagePlus />
            {t("catalog")}
          </button>
          <button
            className={tab === "movements" ? "active" : ""}
            onClick={() => setTab("movements")}
          >
            <History />
            {t("movements")}
          </button>
        </div>
        <div className="search">
          <Search />
          <input
            data-keyboard-search
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={t("searchInventory")}
          />
        </div>
        <div className="filter-grid">
          <Filter
            value={filters.niche}
            onChange={(value) =>
              setFilters({
                ...filters,
                niche: value,
                category: "",
                type: "",
                brand: "",
              })
            }
            label={t("allNiches")}
            rows={catalog?.niches ?? []}
            name={localized}
          />
          <Filter
            value={filters.category}
            onChange={(value) =>
              setFilters({ ...filters, category: value, type: "" })
            }
            label={t("allCategories")}
            rows={categories}
            name={localized}
          />
          <Filter
            value={filters.type}
            onChange={(value) => setFilters({ ...filters, type: value })}
            label={t("allTypes")}
            rows={productTypes}
            name={localized}
          />
          <Filter
            value={filters.brand}
            onChange={(value) => setFilters({ ...filters, brand: value })}
            label={t("allBrands")}
            rows={brands}
            name={localized}
          />
          {tab === "products" && (
            <select
              value={filters.status}
              onChange={(e) =>
                setFilters({ ...filters, status: e.target.value })
              }
            >
              <option value="">{t("allStatuses")}</option>
              <option value="low">{t("lowStock")}</option>
              <option value="out">{t("outOfStock")}</option>
              <option value="unlimited">{t("unlimited")}</option>
              <option value="hidden">{t("hidden")}</option>
              <option value="inactive">{t("inactive")}</option>
            </select>
          )}
          {tab === "movements" && (
            <select
              value={filters.movementType}
              onChange={(e) =>
                setFilters({ ...filters, movementType: e.target.value })
              }
            >
              <option value="">{t("allMovements")}</option>
              {[
                "SALE",
                "RECEIPT",
                "RETURN",
                "ADJUSTMENT_IN",
                "ADJUSTMENT_OUT",
              ].map((value) => (
                <option key={value} value={value}>
                  {localizeValue(language, value)}
                </option>
              ))}
            </select>
          )}
        </div>
      </div>
      {loading ? (
        <div className="panel">
          <LoadingState label={t("loadingData")} />
        </div>
      ) : error ? (
        <div className="panel">
          <ErrorState
            title={t("unableToLoad")}
            text={error || t("tryAgainText")}
            retryLabel={t("retry")}
            onRetry={() => void load()}
          />
        </div>
      ) : (
        tab === "products" && (
          <div className="panel table-panel">
            {current.length ? (
              <div className="table">
                <div className="table-row inventory-advanced table-head">
                  <span>{t("product")}</span>
                  <span>{t("price")}</span>
                  <span>{t("cost")}</span>
                  <span>{t("stock")}</span>
                  <span>{t("threshold")}</span>
                  <span>{t("pos")}</span>
                  <span>{t("active")}</span>
                  <span>{t("actions")}</span>
                </div>
                {current.map((product: any) => (
                  <div
                    className="table-row inventory-advanced"
                    key={product.local_id}
                  >
                    <span className="inventory-product-cell">
                      <input
                        className="label-selector"
                        type="checkbox"
                        checked={selectedLabels.has(product.local_id)}
                        aria-label={`${t("printLabels")}: ${localized(product)}`}
                        onChange={() => toggleLabel(product.local_id)}
                      />
                      {product.image ? (
                        <button
                          type="button"
                          className="inventory-image-trigger"
                          aria-label={`${t("previewImage")}: ${localized(product)}`}
                          onClick={() =>
                            setPreview({
                              src: product.image,
                              title: localized(product),
                              subtitle: product.variant_name || product.sku,
                            })
                          }
                        >
                          <img src={product.image} alt="" loading="lazy" />
                          <span>{t("previewImage")}</span>
                        </button>
                      ) : (
                        <span className="inventory-image-placeholder">
                          <Boxes />
                        </span>
                      )}
                      <span className="inventory-product-copy">
                        <strong>{localized(product)}</strong>
                        <small>{product.variant_name || product.sku}</small>
                        {product.provisional ? (
                          <em className="badge warning">
                            {localizeValue(
                              language,
                              product.request_status || "PENDING",
                            )}
                          </em>
                        ) : null}
                      </span>
                    </span>
                    <InlineNumber
                      value={product.price}
                      onSave={(price) =>
                        update(product.local_id, { price }, t("priceSaved"))
                      }
                    />
                    <InlineNumber
                      value={product.cost_price}
                      onSave={(costPrice) =>
                        update(product.local_id, { costPrice }, t("costSaved"))
                      }
                    />
                    <span className="stock-cell">
                      {product.inventory_policy === "TRACKED" ? (
                        <strong>{product.stock}</strong>
                      ) : (
                        <em className="badge">{t("unlimited")}</em>
                      )}
                      <label className="tiny-check">
                        <input
                          type="checkbox"
                          defaultChecked={
                            product.inventory_policy === "TRACKED"
                          }
                          onChange={(e) =>
                            void update(
                              product.local_id,
                              { trackInventory: e.target.checked },
                              t("inventoryPolicySaved"),
                            )
                          }
                        />
                        {t("trackStock")}
                      </label>
                    </span>
                    <InlineNumber
                      value={product.reorder_threshold}
                      onSave={(reorderThreshold) =>
                        update(
                          product.local_id,
                          { reorderThreshold },
                          t("thresholdSaved"),
                        )
                      }
                    />
                    <span>
                      <input
                        type="checkbox"
                        checked={Boolean(product.visible_in_pos)}
                        onChange={(e) =>
                          void update(
                            product.local_id,
                            { visibleInPos: e.target.checked },
                            t("visibilitySaved"),
                          )
                        }
                      />
                    </span>
                    <span>
                      <input
                        type="checkbox"
                        checked={Boolean(product.active)}
                        onChange={(e) =>
                          void update(
                            product.local_id,
                            { active: e.target.checked },
                            t("statusSaved"),
                          )
                        }
                      />
                    </span>
                    <span className="inventory-row-actions">
                      <button type="button" className="icon-button" title={t("refreshProductImage")} onClick={() => void refreshImage(product)} disabled={refreshingImage === product.local_id || product.provisional || !product.remote_image_url}>
                        {refreshingImage === product.local_id ? <LoaderCircle className="spin" /> : <ImageDown />}
                      </button>
                      <button type="button" className="icon-button" title={t("adjustStock")} onClick={() => openAdjustment(product)} disabled={product.inventory_policy !== "TRACKED"}>
                        <SlidersHorizontal />
                      </button>
                      <button type="button" className="icon-button" title={t("printLabels")} onClick={() => openLabelQueue(product)}>
                        <Printer />
                      </button>
                    </span>
                  </div>
                ))}
              </div>
            ) : (
              <EmptyState
                icon={Boxes}
                title={t("noProducts")}
                text={t("noProductsText")}
              />
            )}
          </div>
        )
      )}
      {!loading && !error && tab === "catalog" && (
        <div className="catalog-activation-grid">
          {current.map((row: any) => (
            <form
              className="activation-card"
              key={row.variant_id}
              onSubmit={(event) => activate(row, event)}
            >
              {row.image ? (
                <button
                  type="button"
                  className="activation-image activation-image-trigger"
                  aria-label={`${t("previewImage")}: ${localized(row)}`}
                  onClick={() =>
                    setPreview({
                      src: row.image,
                      title: localized(row),
                      subtitle:
                        row.variant_name ||
                        row.sku ||
                        row.tags?.join(" · ") ||
                        t("standard"),
                    })
                  }
                >
                  <img src={row.image} alt="" loading="lazy" />
                  <span>{t("previewImage")}</span>
                </button>
              ) : (
                <div className="activation-image">
                  <PackagePlus />
                </div>
              )}
              <div className="activation-copy">
                <h3>{localized(row)}</h3>
                <p>
                  {row.variant_name ||
                    row.sku ||
                    row.tags?.join(" · ") ||
                    t("standard")}
                </p>
              </div>
              {row.product_local_id ? (
                <em className="badge">{t("alreadyAdded")}</em>
              ) : (
                <>
                  <div className="activation-fields">
                    <label>
                      {t("sellingPrice")}
                      <input name="price" type="number" min="0" required />
                    </label>
                    <label>
                      {t("costPrice")}
                      <input
                        name="costPrice"
                        type="number"
                        min="0"
                        defaultValue="0"
                      />
                    </label>
                    <label>
                      {t("initialStock")}
                      <input
                        name="stock"
                        type="number"
                        min="0"
                        defaultValue="0"
                      />
                    </label>
                    <label>
                      {t("threshold")}
                      <input
                        name="threshold"
                        type="number"
                        min="0"
                        defaultValue="0"
                      />
                    </label>
                  </div>
                  <label className="switch-label">
                    <input name="tracked" type="checkbox" defaultChecked />
                    {t("trackStock")}
                  </label>
                  <button
                    className="button primary full"
                    disabled={activating === row.variant_id}
                  >
                    {activating === row.variant_id ? (
                      <LoaderCircle className="spin" />
                    ) : (
                      <PackagePlus />
                    )}
                    {activating === row.variant_id
                      ? t("submitting")
                      : t("activate")}
                  </button>
                </>
              )}
            </form>
          ))}
        </div>
      )}
      {!loading && !error && tab === "movements" && (
        <div className="panel table-panel">
          {current.length ? (
            <div className="table">
              <div className="table-row movement table-head">
                <span>{t("product")}</span>
                <span>{t("change")}</span>
                <span>{t("beforeAfter")}</span>
                <span>{t("reason")}</span>
                <span>{t("date")}</span>
              </div>
              {current.map((row: any) => (
                <div className="table-row movement" key={row.id}>
                  <span>
                    <strong>
                      {language === "ar" && row.product_name_ar
                        ? row.product_name_ar
                        : row.product_name}
                    </strong>
                    <small>{row.variant_name || row.sku}</small>
                  </span>
                  <span>
                    <em
                      className={
                        row.quantity_delta >= 0
                          ? "quantity-positive"
                          : "quantity-negative"
                      }
                    >
                      {row.quantity_delta >= 0 ? "+" : ""}
                      {row.quantity_delta}
                    </em>
                    <small>{localizeValue(language, row.type)}</small>
                  </span>
                  <span>
                    {row.stock_before} → {row.stock_after}
                  </span>
                  <span>{localizeReason(language, row.reason)}</span>
                  <span>
                    {new Date(row.created_at).toLocaleString(
                      localeFor(language),
                    )}
                  </span>
                </div>
              ))}
            </div>
          ) : (
            <EmptyState
              icon={History}
              title={t("noMovements")}
              text={t("movementHistoryText")}
            />
          )}
        </div>
      )}
      {!loading && !error && (
        <div className="pagination">
          <button disabled={!page} onClick={() => setPage(page - 1)}>
            <ChevronLeft />
          </button>
          <span>{page + 1}</span>
          <button
            disabled={current.length < limit}
            onClick={() => setPage(page + 1)}
          >
            <ChevronRight />
          </button>
        </div>
      )}
      {showCreate && catalog && (
        <div
          className="modal-backdrop"
          onMouseDown={() => !creating && setShowCreate(false)}
        >
          <form
            className="modal-card product-create-dialog"
            onSubmit={createLocal}
            onMouseDown={(event) => event.stopPropagation()}
          >
            <p className="eyebrow">{t("localProduct")}</p>
            <h2>{t("createProduct")}</h2>
            <p className="muted">{t("createProductHelp")}</p>
            <div className="two-fields">
              <label>
                {t("englishName")}
                <input name="name" required autoFocus />
              </label>
              <label>
                {t("arabicName")}
                <input name="nameAr" dir="rtl" />
              </label>
            </div>
            <label>
              {t("description")}
              <textarea name="description" />
            </label>
            <div className="two-fields">
              <label>
                {t("category")}
                <select name="categoryId" required>
                  <option value="">{t("chooseCategory")}</option>
                  {catalog.categories.map((row) => (
                    <option key={row.id} value={row.id}>
                      {localized(row)}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                {t("productType")}
                <select name="productTypeId">
                  <option value="">{t("optional")}</option>
                  {catalog.productTypes.map((row) => (
                    <option key={row.id} value={row.id}>
                      {localized(row)}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                {t("brand")}
                <select name="brandId">
                  <option value="">{t("optional")}</option>
                  {catalog.brands.map((row) => (
                    <option key={row.id} value={row.id}>
                      {localized(row)}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                {t("variant")}
                <input name="variantName" defaultValue="Default" />
              </label>
              <label>
                {t("sku")}
                <input name="sku" />
              </label>
              <label>
                {t("sellingPrice")}
                <input name="price" type="number" min="0" required />
              </label>
              <label>
                {t("costPrice")}
                <input
                  name="costPrice"
                  type="number"
                  min="0"
                  defaultValue="0"
                />
              </label>
              <label>
                {t("initialStock")}
                <input name="stock" type="number" min="0" defaultValue="0" />
              </label>
              <label>
                {t("threshold")}
                <input
                  name="threshold"
                  type="number"
                  min="0"
                  defaultValue="0"
                />
              </label>
            </div>
            <label className="switch-label">
              <input name="tracked" type="checkbox" defaultChecked />
              {t("trackStock")}
            </label>
            <div className="dialog-actions">
              <button
                type="button"
                className="button secondary"
                onClick={() => setShowCreate(false)}
                disabled={creating}
              >
                {t("close")}
              </button>
              <button className="button primary" disabled={creating}>
                {creating ? <LoaderCircle className="spin" /> : <PackagePlus />}
                {creating ? t("submitting") : t("createProduct")}
              </button>
            </div>
          </form>
        </div>
      )}
      {preview ? (
        <ImagePreview item={preview} onClose={() => setPreview(null)} />
      ) : null}
      {adjustingProduct ? (
        <div className="modal-backdrop" onMouseDown={(event) => event.target === event.currentTarget && !adjusting && setAdjustingProduct(null)}>
          <form className="modal-card adjustment-dialog" onSubmit={submitAdjustment}>
            <p className="eyebrow">{t("inventory")}</p>
            <h2>{t("adjustStock")}</h2>
            <p className="muted">{localized(adjustingProduct)}{adjustingProduct.variant_name ? ` · ${adjustingProduct.variant_name}` : ""}</p>
            <div className="stock-result-strip">
              <span><small>{t("currentStock")}</small><strong>{adjustingProduct.stock}</strong></span>
              <span>→</span>
              <span><small>{t("resultingStock")}</small><strong>{resultingStock(adjustingProduct.stock, adjustmentMode, Number(adjustmentQuantity || 0))}</strong></span>
            </div>
            <div className="segmented adjustment-modes">
              <button type="button" className={adjustmentMode === "RECEIVE" ? "active" : ""} onClick={() => setAdjustmentMode("RECEIVE")}>{t("receiveStock")}</button>
              <button type="button" className={adjustmentMode === "REMOVE" ? "active" : ""} onClick={() => setAdjustmentMode("REMOVE")}>{t("removeStock")}</button>
              <button type="button" className={adjustmentMode === "SET" ? "active" : ""} onClick={() => setAdjustmentMode("SET")}>{t("setCount")}</button>
            </div>
            <label>{adjustmentMode === "RECEIVE" ? t("quantityToAdd") : adjustmentMode === "REMOVE" ? t("quantityToRemove") : t("countedQuantity")}<input type="number" min="0" step="1" required autoFocus value={adjustmentQuantity} onChange={(event) => setAdjustmentQuantity(event.target.value)} /></label>
            <label>{t("adjustmentReason")}<select key={adjustmentMode} name="reason" required defaultValue={adjustmentMode === "RECEIVE" ? "SUPPLIER_DELIVERY" : adjustmentMode === "REMOVE" ? "DAMAGED_GOODS" : "INVENTORY_COUNT"}><option value="SUPPLIER_DELIVERY">{t("supplierDelivery")}</option><option value="DAMAGED_GOODS">{t("damagedGoods")}</option><option value="INVENTORY_COUNT">{t("inventoryCount")}</option><option value="CORRECTION">{t("correction")}</option></select></label>
            <label>{t("adjustmentNote")}<textarea name="note" /></label>
            <div className="dialog-actions"><button type="button" className="button secondary" disabled={adjusting} onClick={() => setAdjustingProduct(null)}>{t("cancel")}</button><button className="button primary" disabled={adjusting || resultingStock(adjustingProduct.stock, adjustmentMode, Number(adjustmentQuantity || 0)) < 0}>{adjusting ? <LoaderCircle className="spin" /> : <Check />}{adjusting ? t("saving") : t("saveChanges")}</button></div>
          </form>
        </div>
      ) : null}
      {showLabels ? (
        <div className="modal-backdrop" onMouseDown={(event) => event.target === event.currentTarget && !printingLabels && setShowLabels(false)}>
          <section className="modal-card label-queue-dialog" role="dialog" aria-modal="true">
            <div><p className="eyebrow">{t("priceLabel")}</p><h2>{t("printLabels")}</h2><p className="muted">{selectedLabels.size} {t("selectedProducts")}</p></div>
            <div className="label-queue-grid">
              <div className="label-preview-mini">{labelPreview ? <iframe title={t("priceLabel")} srcDoc={labelPreview} sandbox="" /> : <LoadingState label={t("updatingPreview")} compact />}</div>
              <label>{t("labelCopies")}<input type="number" min="1" max="100" value={labelCopies} onChange={(event) => setLabelCopies(event.target.value)} /></label>
            </div>
            <div className="dialog-actions"><button type="button" className="button secondary" disabled={printingLabels} onClick={() => setShowLabels(false)}>{t("cancel")}</button><button type="button" className="button primary" disabled={printingLabels || !selectedLabels.size} onClick={() => void printSelectedLabels()}>{printingLabels ? <LoaderCircle className="spin" /> : <Printer />}{printingLabels ? t("printing") : t("printLabels")}</button></div>
          </section>
        </div>
      ) : null}
    </div>
  );
}

function resultingStock(current: number, mode: AdjustmentMode, quantity: number) {
  if (mode === "RECEIVE") return current + quantity;
  if (mode === "REMOVE") return current - quantity;
  return quantity;
}

function Filter({
  value,
  onChange,
  label,
  rows,
  name,
}: {
  value: string;
  onChange: (value: string) => void;
  label: string;
  rows: any[];
  name: (row: any) => string;
}) {
  return (
    <select value={value} onChange={(e) => onChange(e.target.value)}>
      <option value="">{label}</option>
      {rows.map((row) => (
        <option key={row.id} value={row.id}>
          {name(row)}
        </option>
      ))}
    </select>
  );
}
function InlineNumber({
  value,
  onSave,
}: {
  value: number;
  onSave: (value: number) => void;
}) {
  return (
    <span>
      <input
        className="quantity-input"
        type="number"
        min="0"
        defaultValue={value ?? 0}
        onBlur={(event) => {
          const next = Number(event.target.value);
          if (next !== value) onSave(next);
        }}
      />
    </span>
  );
}
