import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Boxes,
  Check,
  History,
  ImageDown,
  LoaderCircle,
  MoreHorizontal,
  PackagePlus,
  Printer,
  Search,
  SlidersHorizontal,
  X,
} from "lucide-react";
import { EmptyState } from "../../components/EmptyState";
import { ErrorState, LoadingState } from "../../components/AsyncState";
import { Pagination } from "../../components/Pagination";
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
type CatalogImportDraft = {
  item: any;
  price: string;
  costPrice: string;
  stock: string;
  trackInventory: boolean;
  visibleInPos: boolean;
  available: boolean;
};
type RowMenuPosition = { top: number; left: number };
type InventoryProductRowProps = {
  product: any;
  selected: boolean;
  busy: boolean;
  refreshingImage: boolean;
  menuPosition: RowMenuPosition | null;
  onToggleLabel: (productLocalId: string) => void;
  onPreview: (src: string, title: string, subtitle: string) => void;
  onUpdate: (productLocalId: string, changes: Changes, notice: string) => void;
  onToggleMenu: (event: React.MouseEvent<HTMLButtonElement>, productId: string) => void;
  onCloseMenu: () => void;
  onRefreshImage: (product: any) => void;
  onAdjustStock: (product: any) => void;
  onPrintLabels: (product: any) => void;
  onToggleFlag: (product: any, key: "trackInventory" | "visibleInPos" | "active", checked: boolean) => void;
};

function productPatch(changes: Changes): Partial<Product> {
  const patch: Partial<Product> = {};
  if (changes.price !== undefined) patch.price = changes.price;
  if (changes.costPrice !== undefined) patch.cost_price = changes.costPrice;
  if (changes.discount !== undefined) patch.discount = changes.discount;
  if (changes.stock !== undefined) patch.stock = changes.stock;
  if (changes.reorderThreshold !== undefined) patch.reorder_threshold = changes.reorderThreshold;
  if (changes.trackInventory !== undefined) patch.inventory_policy = changes.trackInventory ? "TRACKED" : "UNLIMITED";
  if (changes.available !== undefined) patch.available = changes.available ? 1 : 0;
  if (changes.visibleInPos !== undefined) patch.visible_in_pos = changes.visibleInPos ? 1 : 0;
  if (changes.active !== undefined) patch.active = changes.active ? 1 : 0;
  if (changes.priceOnRequest !== undefined) patch.price_on_request = changes.priceOnRequest ? 1 : 0;
  if (changes.vendorBarcode !== undefined) patch.barcode = changes.vendorBarcode;
  return patch;
}

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
  const [importDrafts, setImportDrafts] = useState<Record<number, CatalogImportDraft>>({});
  const [reviewCatalogImport, setReviewCatalogImport] = useState(false);
  const [importingCatalog, setImportingCatalog] = useState(false);
  const [catalogImportError, setCatalogImportError] = useState("");
  const [catalogView, setCatalogView] = useState<"grouped" | "flat">("grouped");
  const [catalogFilter, setCatalogFilter] = useState<"all" | "unadded">("all");
  const [catalogTotal, setCatalogTotal] = useState(0);
  const [catalogPageLoading, setCatalogPageLoading] = useState(false);
  const [catalogReload, setCatalogReload] = useState(0);
  const [showCreate, setShowCreate] = useState(false);
  const [creating, setCreating] = useState(false);
  const [draftImage, setDraftImage] = useState<{ ref: string; previewUrl: string; filename: string; mimeType: string } | null>(null);
  const [imageUrl, setImageUrl] = useState("");
  const [imageBusy, setImageBusy] = useState(false);
  const [imageError, setImageError] = useState("");
  const [preview, setPreview] = useState<ImagePreviewItem | null>(null);
  const [adjustingProduct, setAdjustingProduct] = useState<any | null>(null);
  const [adjustmentMode, setAdjustmentMode] = useState<AdjustmentMode>("RECEIVE");
  const [adjustmentQuantity, setAdjustmentQuantity] = useState("1");
  const [adjusting, setAdjusting] = useState(false);
  const [selectedLabels, setSelectedLabels] = useState<Set<string>>(new Set());
  const [bulkUpdating, setBulkUpdating] = useState(false);
  const [rowMenu, setRowMenu] = useState<{ productId: string; top: number; left: number } | null>(null);
  const [showLabels, setShowLabels] = useState(false);
  const [labelCopies, setLabelCopies] = useState("1");
  const [labelPreview, setLabelPreview] = useState("");
  const [printingLabels, setPrintingLabels] = useState(false);
  const [refreshingImage, setRefreshingImage] = useState<string | null>(null);
  const [pendingProductIds, setPendingProductIds] = useState<Set<string>>(new Set());
  const pendingProductIdsRef = useRef(new Set<string>());
  const productsRef = useRef(products);
  const [refreshingImages, setRefreshingImages] = useState(false);
  const limit = 50;
  const load = async () => {
    setLoading(true);
    setError("");
    try {
      const [inventory, catalogValue, movementRows] =
        await Promise.all([
          window.pos.listInventory({ search, limit: 250 }),
          window.pos.listCatalog(),
          window.pos.listMovements({
            search,
            type: filters.movementType || undefined,
            limit: 500,
          }),
        ]);
      setProducts(inventory as Product[]);
      setCatalog(catalogValue as Catalog);
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
  useEffect(() => {
    let cancelled = false;
    setCatalogPageLoading(true);
    setError("");
    void window.pos.listTemplates({
      search,
      categoryId: filters.category ? Number(filters.category) : undefined,
      nicheId: filters.niche ? Number(filters.niche) : undefined,
      productTypeId: filters.type ? Number(filters.type) : undefined,
      brandId: filters.brand ? Number(filters.brand) : undefined,
      grouped: catalogView === "grouped",
      unaddedOnly: catalogFilter === "unadded",
      limit,
      offset: page * limit,
    }).then((result) => {
      if (cancelled) return;
      // Keep the renderer safe during a dev hot reload where the Electron main
      // process may still expose the previous array-only IPC response.
      const pageResult = result as unknown as { rows?: unknown[]; total?: number } | unknown[] | undefined;
      const rows = Array.isArray(pageResult)
        ? pageResult
        : Array.isArray(pageResult?.rows)
          ? pageResult.rows
          : [];
      setTemplates(rows as any[]);
      setCatalogTotal(Array.isArray(pageResult) ? pageResult.length : Number(pageResult?.total) || 0);
    }).catch((value) => {
      if (!cancelled) setError(localizeError(language, value));
    }).finally(() => {
      if (!cancelled) setCatalogPageLoading(false);
    });
    return () => { cancelled = true; };
  }, [search, filters.category, filters.niche, filters.type, filters.brand, catalogView, catalogFilter, page, catalogReload]);
  useEffect(() => {
    productsRef.current = products;
  }, [products]);
  useEffect(() => {
    setPage(0);
    setSelectedLabels(new Set());
  }, [search, filters, tab]);
  useEffect(() => {
    if (!rowMenu) return;
    const closeOnOutsideClick = (event: PointerEvent) => {
      const target = event.target as Element | null;
      if (!target?.closest(".inventory-row-more-trigger, .inventory-row-menu")) setRowMenu(null);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setRowMenu(null);
    };
    document.addEventListener("pointerdown", closeOnOutsideClick);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("pointerdown", closeOnOutsideClick);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [rowMenu]);

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
  const catalogGroups = Array.from(
    templates.reduce((groups: Map<number, any>, row: any) => {
      const templateId = Number(row.template_id);
      const group = groups.get(templateId) ?? { templateId, rows: [] };
      group.rows.push(row);
      groups.set(templateId, group);
      return groups;
    }, new Map<number, any>()).values(),
  );
  const catalogPageRows = catalogView === "grouped" ? catalogGroups : templates;
  const current = (
    tab === "products"
      ? filteredProducts
      : tab === "catalog"
        ? templates
        : movements
  ).slice(page * limit, (page + 1) * limit);
  const localized = (row: any) =>
    language === "ar" && row.name_ar ? row.name_ar : row.name;
  const categoryName = (categoryId: number) => {
    const category = catalog?.categories.find((row) => row.id === categoryId);
    return category ? localized(category) : "";
  };
  const renderCatalogVariant = (row: any) => {
    const selected = Boolean(importDrafts[row.variant_id]);
    const description = row.variant_description || row.description || "";
    return (
      <article className="catalog-activation-row" key={row.variant_id}>
        {row.image ? (
          <button type="button" className="activation-image activation-image-trigger" aria-label={`${t("previewImage")}: ${localized(row)}`} onClick={() => setPreview({ src: row.image, title: localized(row), subtitle: row.variant_name || row.sku || row.tags?.join(" · ") || t("standard") })}>
            <img src={row.image} alt="" loading="lazy" /><span>{t("previewImage")}</span>
          </button>
        ) : <div className="activation-image"><PackagePlus /></div>}
        <div className="activation-copy">
          <h3>{localized(row)}{row.variant_name ? ` · ${row.variant_name}` : ""}</h3>
          <p>{description || row.tags?.join(" · ") || t("standard")}</p>
          <small className="activation-category">{categoryName(row.category_id)}</small>
        </div>
        {row.product_local_id ? <em className="badge">{t("alreadyAdded")}</em> : (
          <button type="button" className={`button ${selected ? "secondary" : "primary"}`} onClick={() => selected ? setImportDrafts((drafts) => { const next = { ...drafts }; delete next[row.variant_id]; return next; }) : addCatalogItem(row)}>
            {selected ? <Check /> : <PackagePlus />}{selected ? t("itemSelected") : t("addItem")}
          </button>
        )}
      </article>
    );
  };

  const update = useCallback(async (
    productLocalId: string,
    changes: Changes,
    notice: string,
  ) => {
    if (pendingProductIdsRef.current.has(productLocalId)) return;
    const previous = productsRef.current.find((product) => product.local_id === productLocalId);
    const patch = productPatch(changes);
    pendingProductIdsRef.current.add(productLocalId);
    setPendingProductIds((current) => new Set(current).add(productLocalId));
    setProducts((current) => current.map((product) =>
      product.local_id === productLocalId ? { ...product, ...patch } : product,
    ));
    try {
      const saved = await window.pos.updateProduct({ productLocalId, ...changes }) as Product;
      setProducts((current) => current.map((product) =>
        product.local_id === productLocalId
          ? saved?.local_id === productLocalId ? { ...saved, image: previous?.image ?? product.image } : { ...product, ...patch }
          : product,
      ));
      onNotice(notice);
    } catch (error) {
      if (previous) {
        setProducts((current) => current.map((product) =>
          product.local_id === productLocalId ? previous : product,
        ));
      }
      onNotice(localizeError(language, error));
    } finally {
      pendingProductIdsRef.current.delete(productLocalId);
      setPendingProductIds((current) => {
        const next = new Set(current);
        next.delete(productLocalId);
        return next;
      });
    }
  }, [language, onNotice]);

  const refreshImage = useCallback(async (product: any) => {
    if (!window.confirm(t("refreshImageConfirm"))) return;
    if (pendingProductIdsRef.current.has(product.local_id)) return;
    pendingProductIdsRef.current.add(product.local_id);
    setPendingProductIds((current) => new Set(current).add(product.local_id));
    setRefreshingImage(product.local_id);
    try {
      const refreshed = await window.pos.refreshProductImage({ productLocalId: product.local_id }) as Product;
      if (refreshed?.local_id === product.local_id) {
        setProducts((current) => current.map((row) => row.local_id === product.local_id ? refreshed : row));
      }
      onNotice(t("productImageRefreshed"));
    } catch (value) {
      onNotice(localizeError(language, value));
    } finally {
      pendingProductIdsRef.current.delete(product.local_id);
      setPendingProductIds((current) => {
        const next = new Set(current);
        next.delete(product.local_id);
        return next;
      });
      setRefreshingImage(null);
    }
  }, [language, onNotice, t]);

  async function refreshAllImages() {
    const eligible = filteredProducts.filter(
      (product: any) => !product.provisional && product.remote_image_url && !pendingProductIdsRef.current.has(product.local_id),
    );
    if (!eligible.length) return;
    if (!window.confirm(t("refreshImagesConfirm"))) return;
    for (const product of eligible) pendingProductIdsRef.current.add(product.local_id);
    setPendingProductIds((current) => new Set([...current, ...eligible.map((product: any) => product.local_id)]));
    setRefreshingImages(true);
    try {
      let result: { refreshed: number; failed: number; results?: Array<{ localId: string; error?: string; image?: string | null }> };
      try {
        result = (await window.pos.refreshProductImages({
          productLocalIds: eligible.map((product: any) => product.local_id),
        })) as { refreshed: number; failed: number; results?: Array<{ localId: string; error?: string; image?: string | null }> };
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
          results: outcomes.map((outcome, index) => outcome.status === "fulfilled"
            ? { localId: eligible[index].local_id, image: (outcome.value as Product)?.image }
            : { localId: eligible[index].local_id, error: outcome.reason instanceof Error ? outcome.reason.message : String(outcome.reason) }),
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
      const refreshed = result.results?.filter((outcome) => outcome.image !== undefined) ?? [];
      if (refreshed.length) {
        const imageById = new Map(refreshed.map((outcome) => [outcome.localId, outcome.image]));
        setProducts((current) => current.map((product) => imageById.has(product.local_id)
          ? { ...product, image: imageById.get(product.local_id) ?? undefined }
          : product));
      }
    } catch (value) {
      onNotice(localizeError(language, value));
    } finally {
      for (const product of eligible) pendingProductIdsRef.current.delete(product.local_id);
      setPendingProductIds((current) => {
        const next = new Set(current);
        for (const product of eligible) next.delete(product.local_id);
        return next;
      });
      setRefreshingImages(false);
    }
  }
  function addCatalogItem(row: any) {
    setImportDrafts((drafts) => ({
      ...drafts,
      [row.variant_id]: drafts[row.variant_id] ?? {
        item: row,
        price: "",
        costPrice: "",
        stock: "",
        trackInventory: true,
        visibleInPos: true,
        available: true,
      },
    }));
    setCatalogImportError("");
  }

  function updateCatalogDraft<K extends keyof CatalogImportDraft>(
    variantId: number,
    key: K,
    value: CatalogImportDraft[K],
  ) {
    setImportDrafts((drafts) => ({
      ...drafts,
      [variantId]: { ...drafts[variantId], [key]: value },
    }));
    setCatalogImportError("");
  }

  async function confirmCatalogImport() {
    const selected = Object.entries(importDrafts);
    const invalid = selected.some(([, draft]) =>
      !draft.price.trim() || !Number.isFinite(Number(draft.price)) || Number(draft.price) < 0 ||
      !Number.isFinite(Number(draft.costPrice)) || Number(draft.costPrice) < 0 ||
      !Number.isFinite(Number(draft.stock)) || Number(draft.stock) < 0 ||
      !Number.isInteger(Number(draft.stock)),
    );
    if (invalid) {
      setCatalogImportError(t("catalogImportValidation"));
      return;
    }

    setImportingCatalog(true);
    setCatalogImportError("");
    const failed: Record<number, CatalogImportDraft> = {};
    let imported = 0;
    let firstError = "";
    for (const [variantId, draft] of selected) {
      const id = Number(variantId);
      try {
        await window.pos.activateProduct({
          variantId: id,
          price: Number(draft.price),
          costPrice: Number(draft.costPrice),
          stock: draft.trackInventory ? Number(draft.stock) : 0,
          trackInventory: draft.trackInventory,
          available: draft.available,
          visibleInPos: draft.visibleInPos,
        });
        imported += 1;
      } catch (error) {
        failed[id] = draft;
        firstError ||= localizeError(language, error);
      }
    }
    setImportDrafts(failed);
    if (!Object.keys(failed).length) setReviewCatalogImport(false);
    if (imported) {
      await load();
      setCatalogReload((value) => value + 1);
    }
    if (Object.keys(failed).length) {
      setCatalogImportError(firstError || t("catalogImportPartial"));
    }
    onNotice(
      t(imported && Object.keys(failed).length ? "catalogImportPartialSummary" : imported ? "catalogImportSuccess" : "catalogImportFailed")
        .replace("{imported}", String(imported))
        .replace("{failed}", String(Object.keys(failed).length)),
    );
    setImportingCatalog(false);
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
        image: draftImage?.ref,
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
        priceOnRequest: data.get("priceOnRequest") === "on",
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

  function openCreateProduct() {
    setDraftImage(null);
    setImageUrl("");
    setImageError("");
    setShowCreate(true);
  }

  async function importProductImage(action: () => Promise<{ ref: string; previewUrl: string; filename: string; mimeType: string } | null>) {
    setImageBusy(true);
    setImageError("");
    try {
      const image = await action();
      if (image) setDraftImage(image);
    } catch (error) {
      setImageError(localizeError(language, error));
    } finally {
      setImageBusy(false);
    }
  }

  async function importProductImageUrl() {
    if (!imageUrl.trim()) {
      setImageError(t("imageUrlRequired"));
      return;
    }
    await importProductImage(() => window.pos.importCatalogImageUrl(imageUrl.trim()));
  }

  const openAdjustment = useCallback((product: any) => {
    setAdjustingProduct(product);
    setAdjustmentMode("RECEIVE");
    setAdjustmentQuantity("1");
  }, []);

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
      const saved = await window.pos.adjustStock({
        productLocalId: adjustingProduct.local_id,
        mode: adjustmentMode,
        quantity: Number(adjustmentQuantity),
        reason,
      }) as Product;
      const nextStock = resultingStock(adjustingProduct.stock, adjustmentMode, Number(adjustmentQuantity));
      setProducts((current) => current.map((product) => product.local_id === adjustingProduct.local_id
        ? saved?.local_id === product.local_id ? { ...saved, image: product.image } : { ...product, stock: nextStock }
        : product));
      try {
        const movementRows = await window.pos.listMovements({ search, type: filters.movementType || undefined, limit: 500 });
        setMovements(movementRows);
      } catch {
        // The stock mutation succeeded; a stale movement view should not undo it.
      }
      setAdjustingProduct(null);
      onNotice(t("stockAdjusted"));
    } catch (value) {
      onNotice(localizeError(language, value));
    } finally {
      setAdjusting(false);
    }
  }

  const toggleLabel = useCallback((productLocalId: string) => {
    setSelectedLabels((current) => {
      const next = new Set(current);
      if (next.has(productLocalId)) next.delete(productLocalId);
      else next.add(productLocalId);
      return next;
    });
  }, []);

  function selectVisibleProducts() {
    const visible = current.filter((product: any) => !product.provisional);
    const allSelected = visible.length > 0 && visible.every((product: any) => selectedLabels.has(product.local_id));
    setSelectedLabels((selected) => {
      const next = new Set(selected);
      for (const product of visible) {
        if (allSelected) next.delete(product.local_id);
        else next.add(product.local_id);
      }
      return next;
    });
  }

  async function setSelectedInventoryPolicy(trackInventory: boolean) {
    const selected = filteredProducts.filter((product: any) => selectedLabels.has(product.local_id));
    const targets = selected.filter((product: any) => (product.inventory_policy === "TRACKED") !== trackInventory);
    if (!targets.length) return;
    if (!trackInventory && !window.confirm(t("stockPolicyBulkConfirm").replace("{count}", String(targets.length)))) return;

    setBulkUpdating(true);
    for (const product of targets) pendingProductIdsRef.current.add(product.local_id);
    setPendingProductIds((current) => new Set([...current, ...targets.map((product: any) => product.local_id)]));
    let updated = 0;
    let failed = 0;
    const updatedProducts: Product[] = [];
    try {
      for (const product of targets) {
        try {
          const saved = await window.pos.updateProduct({ productLocalId: product.local_id, trackInventory }) as Product;
          updatedProducts.push(saved?.local_id === product.local_id
            ? { ...saved, image: product.image }
            : { ...product, inventory_policy: trackInventory ? "TRACKED" : "UNLIMITED" });
          updated += 1;
        } catch {
          failed += 1;
        }
      }
      if (updatedProducts.length) {
        const byId = new Map(updatedProducts.map((product) => [product.local_id, product]));
        setProducts((current) => current.map((product) => byId.get(product.local_id) ?? product));
      }
      onNotice(t(failed ? "bulkPolicyPartial" : "bulkPolicyUpdated")
        .replace("{updated}", String(updated))
        .replace("{failed}", String(failed)));
      if (!failed) {
        setSelectedLabels(new Set());
      }
    } finally {
      for (const product of targets) pendingProductIdsRef.current.delete(product.local_id);
      setPendingProductIds((current) => {
        const next = new Set(current);
        for (const product of targets) next.delete(product.local_id);
        return next;
      });
      setBulkUpdating(false);
    }
  }

  const toggleProductFlag = useCallback(async (product: any, key: "trackInventory" | "visibleInPos" | "active", checked: boolean) => {
    if (key === "trackInventory" && !checked && !window.confirm(t("stockPolicySingleConfirm"))) return;
    await update(
      product.local_id,
      { [key]: checked },
      key === "trackInventory" ? t("inventoryPolicySaved") : key === "visibleInPos" ? t("visibilitySaved") : t("statusSaved"),
    );
  }, [t, update]);

  const openLabelQueue = useCallback((product?: any) => {
    setRowMenu(null);
    if (product) setSelectedLabels((current) => current.has(product.local_id) ? current : new Set([product.local_id]));
    setShowLabels(true);
  }, []);

  const toggleRowMenu = useCallback((event: React.MouseEvent<HTMLButtonElement>, productId: string) => {
    const rect = event.currentTarget.getBoundingClientRect();
    const menuWidth = 246;
    const menuHeight = 304;
    const position = {
      top: rect.bottom + menuHeight > window.innerHeight ? Math.max(12, rect.top - menuHeight) : rect.bottom + 6,
      left: Math.max(12, Math.min(window.innerWidth - menuWidth - 12, rect.right - menuWidth)),
    };
    setRowMenu((current) => current?.productId === productId ? null : {
      productId,
      ...position,
    });
  }, []);
  const closeRowMenu = useCallback(() => setRowMenu(null), []);

  const previewProductImage = useCallback((src: string, title: string, subtitle: string) => {
    setPreview({ src, title, subtitle });
  }, []);

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
            {tab === "products" ? (
              <details className="inventory-more-actions">
                <summary className="button secondary"><MoreHorizontal />{t("moreActions")}</summary>
                <div className="inventory-more-menu" role="menu">
                  <button type="button" role="menuitem" onClick={(event) => { event.currentTarget.closest("details")?.removeAttribute("open"); selectVisibleProducts(); }}>{t("selectVisibleProducts")}</button>
                </div>
              </details>
            ) : null}
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
            <button type="button" className="button primary" onClick={openCreateProduct}>
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
            onChange={(value) => {
              setPage(0);
              setFilters((current) => ({
                ...current,
                niche: value,
                category: "",
                type: "",
                brand: "",
              }));
            }}
            label={t("allNiches")}
            rows={catalog?.niches ?? []}
            name={localized}
          />
          <Filter
            value={filters.category}
            onChange={(value) => {
              setPage(0);
              setFilters((current) => ({ ...current, category: value, type: "" }));
            }}
            label={t("allCategories")}
            rows={categories}
            name={localized}
          />
          <Filter
            value={filters.type}
            onChange={(value) => {
              setPage(0);
              setFilters((current) => ({ ...current, type: value }));
            }}
            label={t("allTypes")}
            rows={productTypes}
            name={localized}
          />
          <Filter
            value={filters.brand}
            onChange={(value) => {
              setPage(0);
              setFilters((current) => ({ ...current, brand: value }));
            }}
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
              <>
              <div className="table">
                <div className="table-row inventory-advanced table-head">
                  <span>{t("product")}</span>
                  <span>{t("price")}</span>
                  <span>{t("cost")}</span>
                  <span>{t("stock")}</span>
                  <span>{t("threshold")}</span>
                  <span>{t("priceOnRequest")}</span>
                  <span>{t("actions")}</span>
                </div>
                {current.map((product: any) => (
                  <InventoryProductRow
                    key={product.local_id}
                    product={product}
                    selected={selectedLabels.has(product.local_id)}
                    busy={pendingProductIds.has(product.local_id)}
                    refreshingImage={refreshingImage === product.local_id}
                    menuPosition={rowMenu && rowMenu.productId === product.local_id ? { top: rowMenu.top, left: rowMenu.left } : null}
                    onToggleLabel={toggleLabel}
                    onPreview={previewProductImage}
                    onUpdate={update}
                    onToggleMenu={toggleRowMenu}
                    onCloseMenu={closeRowMenu}
                    onRefreshImage={refreshImage}
                    onAdjustStock={openAdjustment}
                    onPrintLabels={openLabelQueue}
                    onToggleFlag={toggleProductFlag}
                  />
                ))}
              </div>
              {selectedLabels.size ? (
                <div className="inventory-bulk-bar">
                  <span><strong>{selectedLabels.size}</strong> {t("selectedProducts")}</span>
                  <div>
                    <button type="button" className="button secondary" disabled={!selectedLabels.size || bulkUpdating} onClick={() => void setSelectedInventoryPolicy(false)}>{t("setUnlimitedStock")}</button>
                    <button type="button" className="button secondary" disabled={!selectedLabels.size || bulkUpdating} onClick={() => void setSelectedInventoryPolicy(true)}>{t("enableStockTracking")}</button>
                    <button type="button" className="button secondary" disabled={!selectedLabels.size || bulkUpdating} onClick={() => openLabelQueue()}><Printer />{t("printLabels")}</button>
                    <button type="button" className="button quiet" disabled={bulkUpdating} onClick={() => setSelectedLabels(new Set())}>{t("clearSelection")}</button>
                  </div>
                  {bulkUpdating ? <LoaderCircle className="spin" aria-label={t("saving")} /> : null}
                </div>
              ) : null}
              </>
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
        reviewCatalogImport ? (
          <section className="catalog-import-review panel">
            <div className="catalog-review-heading">
              <div>
                <h2>{t("reviewCatalogItems")}</h2>
                <p>{t("reviewCatalogItemsHelp").replace("{count}", String(Object.keys(importDrafts).length))}</p>
              </div>
              <button type="button" className="button secondary" onClick={() => setReviewCatalogImport(false)} disabled={importingCatalog}>
                {t("backToCatalog")}
              </button>
            </div>
            {catalogImportError ? <p className="catalog-import-error" role="alert">{catalogImportError}</p> : null}
            <div className="catalog-import-table-wrap">
              <div className="catalog-import-table">
                <div className="catalog-import-row catalog-import-head">
                  <span>{t("product")}</span>
                  <span>{t("quantity")}</span>
                  <span>{t("costPrice")}</span>
                  <span>{t("sellingPrice")}</span>
                  <span>{t("unlimited")}</span>
                  <span>{t("pos")}</span>
                  <span>{t("availability")}</span>
                  <span aria-label={t("actions")} />
                </div>
                {Object.entries(importDrafts).map(([id, draft]) => {
                  const row = templates.find((item: any) => item.variant_id === Number(id)) || draft.item;
                  if (!row) return null;
                  const description = row.variant_description || row.description || "";
                  return (
                    <div className="catalog-import-row" key={id}>
                      <div className="catalog-import-product">
                        {row.image ? <img src={row.image} alt="" loading="lazy" /> : <span className="catalog-import-placeholder"><Boxes /></span>}
                        <span><strong>{localized(row)}{row.variant_name ? ` · ${row.variant_name}` : ""}</strong><small>{categoryName(row.category_id)}</small>{description ? <small className="catalog-import-description">{description}</small> : null}</span>
                      </div>
                      <input aria-label={t("quantity")} type="number" min="0" step="1" value={draft.stock} disabled={!draft.trackInventory || importingCatalog} onChange={(event) => updateCatalogDraft(Number(id), "stock", event.target.value)} />
                      <input aria-label={t("costPrice")} type="number" min="0" step="0.01" value={draft.costPrice} disabled={importingCatalog} onChange={(event) => updateCatalogDraft(Number(id), "costPrice", event.target.value)} />
                      <input aria-label={t("sellingPrice")} type="number" min="0" step="0.01" value={draft.price} disabled={importingCatalog} onChange={(event) => updateCatalogDraft(Number(id), "price", event.target.value)} />
                      <label className="catalog-import-check"><input type="checkbox" checked={!draft.trackInventory} disabled={importingCatalog} onChange={(event) => updateCatalogDraft(Number(id), "trackInventory", !event.target.checked)} />{t("unlimited")}</label>
                      <label className="catalog-import-check"><input type="checkbox" checked={draft.visibleInPos} disabled={importingCatalog} onChange={(event) => updateCatalogDraft(Number(id), "visibleInPos", event.target.checked)} />{t("displayInPos")}</label>
                      <label className="catalog-import-check"><input type="checkbox" checked={draft.available} disabled={importingCatalog} onChange={(event) => updateCatalogDraft(Number(id), "available", event.target.checked)} />{t("availability")}</label>
                      <button type="button" className="icon-button" aria-label={t("removeItem")} title={t("removeItem")} disabled={importingCatalog} onClick={() => setImportDrafts((drafts) => { const next = { ...drafts }; delete next[Number(id)]; return next; })}><X /></button>
                    </div>
                  );
                })}
              </div>
            </div>
            <div className="catalog-import-actions">
              <span>{Object.keys(importDrafts).length} {t("selectedProducts")}</span>
              <button type="button" className="button primary" disabled={importingCatalog || !Object.keys(importDrafts).length} onClick={() => void confirmCatalogImport()}>
                {importingCatalog ? <LoaderCircle className="spin" /> : <Check />}
                {importingCatalog ? t("importingItems") : t("confirmImport")}
              </button>
            </div>
          </section>
        ) : (
          <>
            <div className="catalog-toolbar" role="group" aria-label={t("catalogControls")}>
              <div className="catalog-view-switch" role="group" aria-label={t("catalogView")}>
                <button type="button" className={catalogView === "grouped" ? "active" : ""} aria-pressed={catalogView === "grouped"} onClick={() => { setCatalogView("grouped"); setPage(0); }}>{t("groupedView")}</button>
                <button type="button" className={catalogView === "flat" ? "active" : ""} aria-pressed={catalogView === "flat"} onClick={() => { setCatalogView("flat"); setPage(0); }}>{t("allVariantsView")}</button>
              </div>
              <div className="catalog-filter-switch" role="group" aria-label={t("catalogFilter")}>
                <button type="button" className={catalogFilter === "all" ? "active" : ""} aria-pressed={catalogFilter === "all"} onClick={() => { setCatalogFilter("all"); setPage(0); }}>{t("showAllItems")}</button>
                <button type="button" className={catalogFilter === "unadded" ? "active" : ""} aria-pressed={catalogFilter === "unadded"} onClick={() => { setCatalogFilter("unadded"); setPage(0); }}>{t("showUnaddedItems")}</button>
              </div>
            </div>
            {catalogPageLoading ? <LoadingState label={t("loadingData")} /> : <div className="catalog-activation-list">
              {catalogPageRows.length ? catalogPageRows.map((entry: any) => catalogView === "grouped" ? (
                <details className="catalog-template-group" key={entry.templateId}>
                  <summary className="catalog-template-heading">
                    {entry.rows[0].image ? <img src={entry.rows[0].image} alt="" loading="lazy" /> : <span className="catalog-group-placeholder"><PackagePlus /></span>}
                    <span className="catalog-template-copy"><strong>{localized(entry.rows[0])}</strong><small>{categoryName(entry.rows[0].category_id)}</small></span>
                    <span className="catalog-variant-count">{entry.rows.length} {t("variantsCount")}</span>
                    <span className="catalog-expand-indicator" aria-hidden="true" />
                  </summary>
                  <div className="catalog-template-variants">{entry.rows.map(renderCatalogVariant)}</div>
                </details>
              ) : renderCatalogVariant(entry)) : (
                <EmptyState icon={Boxes} title={t("noProducts")} text={t("noProductsText")} />
              )}
            </div>}
            {Object.keys(importDrafts).length ? (
              <div className="catalog-selection-bar">
                <span><strong>{Object.keys(importDrafts).length}</strong> {t("selectedProducts")}</span>
                <button type="button" className="button primary" onClick={() => { setReviewCatalogImport(true); setCatalogImportError(""); }}>
                  {t("reviewItems")}<span className="catalog-selection-count">{Object.keys(importDrafts).length}</span>
                </button>
              </div>
            ) : null}
          </>
        )
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
      {!loading && !error && !(tab === "catalog" && reviewCatalogImport) && (
        <Pagination
          page={page}
          pageSize={limit}
          total={tab === "products" ? filteredProducts.length : tab === "catalog" ? catalogTotal : movements.length}
          onPageChange={setPage}
        />
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
            <section className="product-image-editor" aria-label={t("productImage")}>
              <div className="product-image-editor-preview">
                {draftImage ? (
                  <button type="button" className="image-preview-button" onClick={() => setPreview({ src: draftImage.previewUrl, title: t("productImage"), subtitle: draftImage.filename })}>
                    <img src={draftImage.previewUrl} alt="" />
                  </button>
                ) : <span><Boxes /></span>}
                <div><strong>{t("productImage")}</strong><small>{draftImage ? draftImage.filename : t("productImageOptionalHelp")}</small></div>
                {draftImage ? <button type="button" className="icon-button" aria-label={t("removeImage")} onClick={() => setDraftImage(null)}><X /></button> : null}
              </div>
              <div className="product-image-editor-controls">
                <label className="product-image-url-field">
                  {t("imageUrl")}
                  <input type="url" value={imageUrl} maxLength={2048} placeholder="https://example.com/product.jpg" disabled={imageBusy || creating} onChange={(event) => setImageUrl(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); void importProductImageUrl(); } }} />
                </label>
                <button type="button" className="button secondary" disabled={imageBusy || creating} onClick={() => void importProductImageUrl()}>{imageBusy ? <LoaderCircle className="spin" /> : <ImageDown />}{t("useImageUrl")}</button>
                <button type="button" className="button secondary" disabled={imageBusy || creating} onClick={() => void importProductImage(() => window.pos.pasteCatalogImage())}>{imageBusy ? <LoaderCircle className="spin" /> : <PackagePlus />}{t("pasteImage")}</button>
                <button type="button" className="button secondary" disabled={imageBusy || creating} onClick={() => void importProductImage(() => window.pos.selectCatalogImage())}>{imageBusy ? <LoaderCircle className="spin" /> : <ImageDown />}{t("chooseImage")}</button>
              </div>
              {imageError ? <p className="product-image-error" role="alert">{imageError}</p> : null}
            </section>
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
                />
              </label>
              <label>
                {t("initialStock")}
                <input name="stock" type="number" min="0" />
              </label>
              <label>
                {t("threshold")}
                <input
                  name="threshold"
                  type="number"
                  min="0"
                />
              </label>
            </div>
            <label className="switch-label">
              <input name="tracked" type="checkbox" defaultChecked />
              {t("trackStock")}
            </label>
            <label className="switch-label">
              <input name="priceOnRequest" type="checkbox" />
              {t("priceOnRequest")}
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

const InventoryProductRow = memo(function InventoryProductRow({
  product,
  selected,
  busy,
  refreshingImage,
  menuPosition,
  onToggleLabel,
  onPreview,
  onUpdate,
  onToggleMenu,
  onCloseMenu,
  onRefreshImage,
  onAdjustStock,
  onPrintLabels,
  onToggleFlag,
}: InventoryProductRowProps) {
  const { t, language } = useI18n();
  const name = language === "ar" && product.name_ar ? product.name_ar : product.name;
  const save = (changes: Changes, notice: string) => void onUpdate(product.local_id, changes, notice);

  return (
    <div className="table-row inventory-advanced" aria-busy={busy}>
      <span className="inventory-product-cell">
        <input
          className="label-selector"
          type="checkbox"
          checked={selected}
          aria-label={`${t("selectProducts")}: ${name}`}
          onChange={() => onToggleLabel(product.local_id)}
          disabled={Boolean(product.provisional)}
        />
        {product.image ? (
          <button
            type="button"
            className="inventory-image-trigger"
            aria-label={`${t("previewImage")}: ${name}`}
            onClick={() => onPreview(product.image, name, product.variant_name || product.sku || "")}
          >
            <img src={product.image} alt="" loading="lazy" />
            <span>{t("previewImage")}</span>
          </button>
        ) : (
          <span className="inventory-image-placeholder"><Boxes /></span>
        )}
        <span className="inventory-product-copy">
          <strong>{name}</strong>
          <small>{product.variant_name || product.sku}</small>
          {product.provisional ? <em className="badge warning">{localizeValue(language, product.request_status || "PENDING")}</em> : null}
        </span>
      </span>
      <span className="stock-cell">
        <InlineNumber value={product.price} disabled={busy} onSave={(price) => save({ price }, t("priceSaved"))} />
      </span>
      <InlineNumber value={product.cost_price} disabled={busy} onSave={(costPrice) => save({ costPrice }, t("costSaved"))} />
      <span className="stock-cell">
        {product.inventory_policy === "TRACKED" ? <strong>{product.stock}</strong> : <em className="badge">{t("unlimited")}</em>}
      </span>
      <InlineNumber value={product.reorder_threshold} disabled={busy} onSave={(reorderThreshold) => save({ reorderThreshold }, t("thresholdSaved"))} />
      <span className="inventory-price-request-cell">
        <input
          type="checkbox"
          checked={Boolean(product.price_on_request)}
          aria-label={`${t("priceOnRequest")}: ${name}`}
          disabled={busy}
          onChange={(event) => save({ priceOnRequest: event.target.checked }, t("priceModeSaved"))}
        />
      </span>
      <span className="inventory-row-actions">
        {busy ? <LoaderCircle className="spin inventory-row-saving" aria-label={t("saving")} /> : null}
        <button type="button" className="icon-button inventory-row-more-trigger" aria-label={`${t("moreActions")}: ${name}`} title={t("moreActions")} aria-expanded={Boolean(menuPosition)} disabled={busy} onClick={(event) => onToggleMenu(event, product.local_id)}><MoreHorizontal /></button>
        {menuPosition ? (
          <div className="inventory-row-menu" role="menu" style={menuPosition}>
            <button type="button" role="menuitem" disabled={busy || product.provisional || !product.remote_image_url} onClick={() => { onCloseMenu(); void onRefreshImage(product); }}>{refreshingImage ? <LoaderCircle className="spin" /> : <ImageDown />}{t("refreshProductImage")}</button>
            <button type="button" role="menuitem" disabled={busy || product.inventory_policy !== "TRACKED"} onClick={() => { onCloseMenu(); onAdjustStock(product); }}><SlidersHorizontal />{t("adjustStock")}</button>
            <button type="button" role="menuitem" disabled={busy} onClick={() => onPrintLabels(product)}><Printer />{t("printLabels")}</button>
            <div className="inventory-menu-divider" />
            <button type="button" role="menuitemcheckbox" aria-checked={product.inventory_policy === "UNLIMITED"} disabled={busy} onClick={() => { onCloseMenu(); void onToggleFlag(product, "trackInventory", product.inventory_policy === "UNLIMITED"); }}><span className="inventory-menu-check">{product.inventory_policy === "UNLIMITED" ? <Check /> : null}</span>{t("unlimitedStock")}</button>
            <button type="button" role="menuitemcheckbox" aria-checked={Boolean(product.visible_in_pos)} disabled={busy} onClick={() => { onCloseMenu(); void onToggleFlag(product, "visibleInPos", !product.visible_in_pos); }}><span className="inventory-menu-check">{product.visible_in_pos ? <Check /> : null}</span>{t("displayInPos")}</button>
            <button type="button" role="menuitemcheckbox" aria-checked={Boolean(product.active)} disabled={busy} onClick={() => { onCloseMenu(); void onToggleFlag(product, "active", !product.active); }}><span className="inventory-menu-check">{product.active ? <Check /> : null}</span>{t("active")}</button>
          </div>
        ) : null}
      </span>
    </div>
  );
});

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
  disabled = false,
  onSave,
}: {
  value: number;
  disabled?: boolean;
  onSave: (value: number) => void;
}) {
  const [draft, setDraft] = useState(String(value ?? 0));
  useEffect(() => setDraft(String(value ?? 0)), [value]);
  return (
    <span>
      <input
        className="quantity-input"
        type="number"
        min="0"
        value={draft}
        disabled={disabled}
        onChange={(event) => setDraft(event.target.value)}
        onBlur={(event) => {
          const next = Number(event.target.value);
          if (next !== value) onSave(next);
        }}
      />
    </span>
  );
}
