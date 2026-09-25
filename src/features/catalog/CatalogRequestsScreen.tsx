import { useEffect, useMemo, useState } from "react";
import { ChevronDown, ChevronUp, Cloud, ImagePlus, PackagePlus, Plus, RefreshCw, X } from "lucide-react";
import { EmptyState } from "../../components/EmptyState";
import { ErrorState, LoadingState } from "../../components/AsyncState";
import { PageHeader } from "../../components/PageHeader";
import type { Catalog } from "../../types";
import { localizeError, localizeValue, useI18n } from "../../i18n";

type WorkspaceMode = "PRODUCT" | "STRUCTURE";
type ProposalKind = "CATEGORY" | "PRODUCT_TYPE";
type DraftImage = { ref: string; previewUrl: string; filename: string; mimeType: string };
type VariantDraft = { id: string; name: string; tags: string; sku: string; skuEdited: boolean; image?: DraftImage; price: string; stock: string };

const skuPart = (value: string) => value.normalize("NFKD").toUpperCase().replace(/[^\p{L}\p{N}]+/gu, "-").replace(/^-|-$/g, "").slice(0, 18);
const generatedSku = (productName: string, tags: string, index: number) =>
  [skuPart(productName), ...tags.split(",").map(skuPart).filter(Boolean), String(index + 1).padStart(2, "0")].filter(Boolean).join("-").slice(0, 80);

const newVariant = (index: number): VariantDraft => ({
  id: crypto.randomUUID(),
  name: index ? `Variant ${index + 1}` : "Default",
  tags: "",
  sku: "",
  skuEdited: false,
  price: "",
  stock: "0",
});

export function CatalogRequestsScreen({ onNotice }: { onNotice: (message: string) => void }) {
  const { t, language } = useI18n();
  const [catalog, setCatalog] = useState<Catalog | null>(null);
  const [rows, setRows] = useState<any[]>([]);
  const [mode, setMode] = useState<WorkspaceMode>("PRODUCT");
  const [dialogKind, setDialogKind] = useState<ProposalKind | null>(null);
  const [nicheId, setNicheId] = useState("");
  const [categoryId, setCategoryId] = useState("");
  const [expandedCategoryId, setExpandedCategoryId] = useState<number | null>(null);
  const [variants, setVariants] = useState<VariantDraft[]>([newVariant(0)]);
  const [productName, setProductName] = useState("");
  const [templateImages, setTemplateImages] = useState<DraftImage[]>([]);
  const [syncState, setSyncState] = useState<{ pendingChanges: number; lastSyncAt?: string | null; lastSyncError?: string | null }>({ pendingChanges: 0 });
  const [syncing, setSyncing] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const localName = (item: any) => language === "ar" && item.name_ar ? item.name_ar : item.name;
  const categories = useMemo(
    () => catalog?.categories.filter((item) => !nicheId || String(item.niche_id) === nicheId) ?? [],
    [catalog, nicheId],
  );
  const productTypes = useMemo(
    () => catalog?.productTypes.filter((item) => !categoryId || String(item.category_id) === categoryId) ?? [],
    [catalog, categoryId],
  );

  const load = async () => {
    setLoading(true);
    setError("");
    try {
      const [catalogValue, proposals, state] = await Promise.all([window.pos.listCatalog(), window.pos.listProposals(), window.pos.getState()]);
      setCatalog(catalogValue as Catalog);
      setRows(proposals as any[]);
      setSyncState(state as typeof syncState);
    } catch (value) {
      setError(localizeError(language, value));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void load(); }, []);

  const selectNiche = (value: string) => {
    setNicheId(value);
    setCategoryId("");
    setExpandedCategoryId(null);
  };

  async function submitStructure(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!dialogKind) return;
    const form = new FormData(event.currentTarget);
    setSubmitting(true);
    try {
      await window.pos.createProposal({
        entityType: dialogKind,
        name: String(form.get("name")),
        nameAr: String(form.get("nameAr") || ""),
        nicheId: Number(form.get("nicheId")),
        categoryId: dialogKind === "PRODUCT_TYPE" ? Number(form.get("categoryId")) : undefined,
      });
      event.currentTarget.reset();
      setDialogKind(null);
      onNotice(t("requestQueued"));
      await load();
    } catch (value) {
      onNotice(localizeError(language, value));
    } finally {
      setSubmitting(false);
    }
  }

  async function submitProduct(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const cleanVariants = variants.map((variant) => ({
      name: variant.name.trim(),
      tags: [...new Set(variant.tags.split(",").map((tag) => tag.trim()).filter(Boolean))],
      sku: variant.sku.trim(),
      image: variant.image?.ref,
      price: Number(variant.price),
      stock: Number(variant.stock || 0),
    }));
    if (cleanVariants.some((variant) =>
      !variant.name || !variant.tags.length || !variant.sku || !Number.isFinite(variant.price) || variant.price < 0
      || !Number.isInteger(variant.stock) || variant.stock < 0)) {
      onNotice(t("invalidVariants"));
      return;
    }
    if (!templateImages.length) {
      onNotice(t("templateImageRequired"));
      return;
    }
    setSubmitting(true);
    try {
      await window.pos.createLocalProductBundle({
        name: productName,
        nameAr: String(form.get("nameAr") || ""),
        description: String(form.get("description") || ""),
        categoryId: Number(categoryId),
        productTypeId: form.get("productTypeId") ? Number(form.get("productTypeId")) : undefined,
        brandId: form.get("brandId") ? Number(form.get("brandId")) : undefined,
        trackInventory: true,
        images: templateImages.map((image) => image.ref),
        variants: cleanVariants,
      });
      event.currentTarget.reset();
      setVariants([newVariant(0)]);
      setProductName("");
      setTemplateImages([]);
      onNotice(t("productAvailableLocally"));
      await load();
    } catch (value) {
      onNotice(localizeError(language, value));
    } finally {
      setSubmitting(false);
    }
  }

  const updateVariant = (id: string, key: "name" | "tags" | "sku" | "price" | "stock", value: string) => {
    setVariants((current) => current.map((item, index) => {
      if (item.id !== id) return item;
      if (key === "tags") return { ...item, tags: value, sku: item.skuEdited ? item.sku : generatedSku(productName, value, index) };
      if (key === "sku") return { ...item, sku: value, skuEdited: true };
      return { ...item, [key]: value };
    }));
  };

  const changeProductName = (value: string) => {
    setProductName(value);
    setVariants((current) => current.map((variant, index) => variant.skuEdited ? variant : { ...variant, sku: generatedSku(value, variant.tags, index) }));
  };

  const pickImage = async (variantId?: string) => {
    const image = await window.pos.selectCatalogImage();
    if (!image) return;
    if (variantId) setVariants((current) => current.map((variant) => variant.id === variantId ? { ...variant, image } : variant));
    else setTemplateImages((current) => current.some((item) => item.ref === image.ref) ? current : [...current, image]);
  };

  const syncNow = async () => {
    setSyncing(true);
    try {
      const result = await window.pos.sync({ forceRetry: true }) as typeof syncState;
      await load();
      onNotice(result.pendingChanges ? t("syncPending") : t("syncComplete"));
    } catch (value) {
      onNotice(localizeError(language, value));
      const state = await window.pos.getState();
      setSyncState(state as typeof syncState);
    } finally {
      setSyncing(false);
    }
  };

  const startProductType = (nextCategoryId: number, nextNicheId: number) => {
    setNicheId(String(nextNicheId));
    setCategoryId(String(nextCategoryId));
    setDialogKind("PRODUCT_TYPE");
  };

  return (
    <div className="page-stack catalog-workspace">
      <PageHeader eyebrow={t("catalog")} title={t("catalogWorkspace")} description={t("catalogWorkspaceHelp")} />
      <section className={`catalog-sync-strip ${syncState.lastSyncError ? "has-error" : ""}`} aria-live="polite">
        <div className="catalog-sync-copy">
          <span className="catalog-sync-icon"><Cloud /></span>
          <div>
            <strong>{syncState.lastSyncError ? t("syncNeedsAttention") : syncState.pendingChanges ? t("pendingSynchronization") : t("catalogSynchronized")}</strong>
            <small>
              {syncState.pendingChanges
                ? `${syncState.pendingChanges} ${t("changesWaiting")}`
                : syncState.lastSyncError || t("catalogSynchronizedHelp")}
            </small>
          </div>
        </div>
        <button type="button" className="button secondary compact" disabled={syncing} onClick={() => void syncNow()}>
          <RefreshCw className={syncing ? "spinning" : ""} />
          {syncing ? t("synchronizing") : t("synchronize")}
        </button>
      </section>
      <div className="segmented catalog-mode-switch">
        <button type="button" className={mode === "PRODUCT" ? "active" : ""} onClick={() => setMode("PRODUCT")}>{t("createCatalogProduct")}</button>
        <button type="button" className={mode === "STRUCTURE" ? "active" : ""} onClick={() => setMode("STRUCTURE")}>{t("manageStructure")}</button>
      </div>

      {loading ? <div className="panel"><LoadingState label={t("loadingData")} /></div> : error ? (
        <div className="panel"><ErrorState title={t("unableToLoad")} text={error || t("tryAgainText")} retryLabel={t("retry")} onRetry={() => void load()} /></div>
      ) : mode === "PRODUCT" ? (
        <form className="panel form-panel" onSubmit={submitProduct}>
          <div className="panel-head"><div><p className="eyebrow">{t("newProduct")}</p><h2>{t("productAndVariants")}</h2></div></div>
          <div className="form-grid">
            <label>{t("niche")}<select required value={nicheId} onChange={(event) => selectNiche(event.target.value)}><option value="">{t("chooseNiche")}</option>{catalog?.niches.map((item) => <option key={item.id} value={item.id}>{localName(item)}</option>)}</select></label>
            <label>{t("category")}<select required value={categoryId} onChange={(event) => setCategoryId(event.target.value)}><option value="">{t("chooseCategory")}</option>{categories.map((item) => <option key={item.id} value={item.id}>{localName(item)}</option>)}</select></label>
            <label>{t("productType")}<select name="productTypeId" disabled={!categoryId}><option value="">{t("optional")}</option>{productTypes.map((item) => <option key={item.id} value={item.id}>{localName(item)}</option>)}</select></label>
            <label>{t("brand")}<select name="brandId" disabled={!nicheId}><option value="">{t("optional")}</option>{catalog?.brands.filter((item) => String(item.niche_id) === nicheId).map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
            <label>{t("englishName")}<input name="name" required minLength={2} value={productName} onChange={(event) => changeProductName(event.target.value)} /></label>
            <label>{t("arabicName")}<input name="nameAr" dir="rtl" /></label>
            <label className="wide">{t("description")}<textarea name="description" /></label>
          </div>
          <section className="template-image-section">
            <div className="section-heading-inline">
              <div><strong>{t("productImages")}</strong><small>{t("templateImagesHelp")}</small></div>
              <button type="button" className="button ghost compact" onClick={() => void pickImage()}><ImagePlus />{t("addImage")}</button>
            </div>
            <div className="template-image-grid">
              {templateImages.map((image) => (
                <figure className="catalog-image-card" key={image.ref}>
                  <img src={image.previewUrl} alt={image.filename} />
                  <button type="button" aria-label={t("remove")} onClick={() => setTemplateImages((current) => current.filter((item) => item.ref !== image.ref))}><X /></button>
                </figure>
              ))}
              {!templateImages.length ? (
                <button type="button" className="catalog-image-empty" onClick={() => void pickImage()}><ImagePlus /><span>{t("addTemplateImage")}</span></button>
              ) : null}
            </div>
          </section>
          <div className="variant-editor">
            <div className="panel-head"><div><p className="eyebrow">{t("variants")}</p><h3>{t("sellableOptions")}</h3></div><button type="button" className="button ghost" onClick={() => setVariants((current) => [...current, newVariant(current.length)])}><Plus />{t("addVariant")}</button></div>
            {variants.map((variant) => <article className="variant-card" key={variant.id}>
              <div className="variant-image-cell">
                <button type="button" className="variant-image-picker" onClick={() => void pickImage(variant.id)}>
                  {variant.image ? <img src={variant.image.previewUrl} alt={variant.image.filename} /> : <><ImagePlus /><span>{t("optionalImage")}</span></>}
                </button>
                {variant.image ? <button type="button" className="variant-image-remove" aria-label={t("remove")} onClick={() => setVariants((current) => current.map((item) => item.id === variant.id ? { ...item, image: undefined } : item))}><X /></button> : null}
              </div>
              <div className="variant-fields">
                <label>{t("variant")}<input required value={variant.name} onChange={(event) => updateVariant(variant.id, "name", event.target.value)} /></label>
                <label>{t("tags")}<input required placeholder={t("tagsPlaceholder")} value={variant.tags} onChange={(event) => updateVariant(variant.id, "tags", event.target.value)} /><small>{t("tagsHelp")}</small></label>
                <label>{t("sku")}<input required value={variant.sku} onChange={(event) => updateVariant(variant.id, "sku", event.target.value)} /></label>
                <label>{t("price")}<input type="number" min="0" step="0.01" required value={variant.price} onChange={(event) => updateVariant(variant.id, "price", event.target.value)} /></label>
                <label>{t("stock")}<input type="number" min="0" step="1" required value={variant.stock} onChange={(event) => updateVariant(variant.id, "stock", event.target.value)} /></label>
              </div>
              <button type="button" className="icon-button variant-remove" aria-label={t("remove")} disabled={variants.length === 1} onClick={() => setVariants((current) => current.filter((item) => item.id !== variant.id))}><X /></button>
            </article>)}
          </div>
          <button className="button primary full" disabled={submitting || !categoryId}><PackagePlus />{submitting ? t("submitting") : t("createAndSubmit")}</button>
        </form>
      ) : (
        <div className="panel catalog-structure-panel">
            <div className="panel-head catalog-structure-head">
              <div><p className="eyebrow">{t("catalogStructure")}</p><h2>{t("categories")}</h2></div>
              <button type="button" className="button primary compact" onClick={() => setDialogKind("CATEGORY")}><Plus />{t("addCategory")}</button>
            </div>
            <div className="niche-filter">{catalog?.niches.map((item) => <button type="button" key={item.id} className={String(item.id) === nicheId ? "active" : ""} onClick={() => selectNiche(String(item.id))}>{localName(item)}</button>)}</div>
            {categories.length ? <div className="catalog-tree">{categories.map((category) => {
              const open = expandedCategoryId === category.id;
              const children = catalog?.productTypes.filter((item) => item.category_id === category.id) ?? [];
              return <div className="catalog-tree-item" key={category.id}>
                <button type="button" className="catalog-tree-heading" onClick={() => setExpandedCategoryId(open ? null : category.id)}><span><strong>{localName(category)}</strong><small>{children.length} {t("productTypes")}</small></span>{open ? <ChevronUp /> : <ChevronDown />}</button>
                {open && <div className="catalog-tree-children">{children.map((item) => <span key={item.id}>{localName(item)}</span>)}<button type="button" onClick={() => startProductType(category.id, category.niche_id)}><Plus />{t("addProductType")}</button></div>}
              </div>;
            })}</div> : <EmptyState icon={PackagePlus} title={t("noCategories")} text={t("chooseNiche")} />}
        </div>
      )}

      {rows.length ? <div className="panel"><div className="panel-head"><div><p className="eyebrow">{t("reviewStatus")}</p><h2>{t("yourRequests")}</h2></div></div><div className="request-list">{rows.map((row) => <div className="request" key={row.local_id}><div><strong>{localName(row)}</strong><small>{localizeValue(language, row.entity_type)}</small></div><em className={row.status === "REJECTED" ? "badge danger" : row.status === "APPROVED" || row.status === "MERGED" ? "badge" : "badge warning"}>{localizeValue(language, row.status)}</em></div>)}</div></div> : null}
      {dialogKind ? (
        <div className="modal-backdrop" onMouseDown={(event) => event.target === event.currentTarget && !submitting && setDialogKind(null)}>
          <form className="modal-card catalog-create-dialog form-panel" onSubmit={submitStructure} role="dialog" aria-modal="true" aria-labelledby="catalog-create-title">
            <div className="dialog-heading">
              <div>
                <p className="eyebrow">{t("catalogStructure")}</p>
                <h2 id="catalog-create-title">{dialogKind === "CATEGORY" ? t("addCategory") : t("addProductType")}</h2>
                <p>{dialogKind === "CATEGORY" ? t("addCategoryHelp") : t("addProductTypeHelp")}</p>
              </div>
              <button type="button" className="icon-button" aria-label={t("close")} disabled={submitting} onClick={() => setDialogKind(null)}><X /></button>
            </div>
            <div className="form-grid">
              <label>{t("niche")}<select name="nicheId" required value={nicheId} onChange={(event) => selectNiche(event.target.value)}><option value="">{t("chooseNiche")}</option>{catalog?.niches.map((item) => <option key={item.id} value={item.id}>{localName(item)}</option>)}</select></label>
              {dialogKind === "PRODUCT_TYPE" && <label>{t("category")}<select name="categoryId" required value={categoryId} onChange={(event) => setCategoryId(event.target.value)}><option value="">{t("chooseCategory")}</option>{categories.map((item) => <option key={item.id} value={item.id}>{localName(item)}</option>)}</select></label>}
              <label>{t("englishName")}<input name="name" required autoFocus /></label>
              <label>{t("arabicName")}<input name="nameAr" dir="rtl" /></label>
            </div>
            <div className="dialog-actions">
              <button type="button" className="button secondary" disabled={submitting} onClick={() => setDialogKind(null)}>{t("cancel")}</button>
              <button className="button primary" disabled={submitting}><PackagePlus />{submitting ? t("submitting") : t("submitReview")}</button>
            </div>
          </form>
        </div>
      ) : null}
    </div>
  );
}
