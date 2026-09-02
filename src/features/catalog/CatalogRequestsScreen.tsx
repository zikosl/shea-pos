import { useEffect, useState } from "react";
import { PackagePlus } from "lucide-react";
import { EmptyState } from "../../components/EmptyState";
import { ErrorState, LoadingState } from "../../components/AsyncState";
import { PageHeader } from "../../components/PageHeader";
import type { Catalog } from "../../types";
import { localizeError, localizeValue, useI18n } from "../../i18n";

export function CatalogRequestsScreen({
  onNotice,
}: {
  onNotice: (message: string) => void;
}) {
  const { t, language } = useI18n();
  const [catalog, setCatalog] = useState<Catalog | null>(null);
  const [rows, setRows] = useState<any[]>([]);
  const [kind, setKind] = useState<"CATEGORY" | "PRODUCT_TYPE">("CATEGORY");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const load = async () => {
    setLoading(true);
    setError("");
    try {
      const [catalogValue, proposals] = await Promise.all([
        window.pos.listCatalog(),
        window.pos.listProposals(),
      ]);
      setCatalog(catalogValue as Catalog);
      setRows(proposals as any[]);
    } catch (value) {
      setError(localizeError(language, value));
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => {
    void load();
  }, []);
  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setSubmitting(true);
    try {
      await window.pos.createProposal({
        entityType: kind,
        name: String(form.get("name")),
        nameAr: String(form.get("nameAr") || ""),
        nicheId: Number(form.get("nicheId")),
        categoryId:
          kind === "PRODUCT_TYPE" ? Number(form.get("categoryId")) : undefined,
      });
      event.currentTarget.reset();
      onNotice(t("requestQueued"));
      await load();
    } catch (error) {
      onNotice(localizeError(language, error));
    } finally {
      setSubmitting(false);
    }
  }
  const localName = (item: any) =>
    language === "ar" && item.name_ar ? item.name_ar : item.name;
  return (
    <div className="page-stack">
      <PageHeader
        eyebrow={t("catalog")}
        title={t("requestAddition")}
        description={t("requestHelp")}
      />
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
        <div className="split">
          <form className="panel form-panel" onSubmit={submit}>
            <div className="segmented">
              <button
                type="button"
                className={kind === "CATEGORY" ? "active" : ""}
                onClick={() => setKind("CATEGORY")}
              >
                {t("category")}
              </button>
              <button
                type="button"
                className={kind === "PRODUCT_TYPE" ? "active" : ""}
                onClick={() => setKind("PRODUCT_TYPE")}
              >
                {t("productType")}
              </button>
            </div>
            <label>
              {t("niche")}
              <select name="nicheId" required>
                <option value="">{t("chooseNiche")}</option>
                {catalog?.niches.map((item) => (
                  <option key={item.id} value={item.id}>
                    {localName(item)}
                  </option>
                ))}
              </select>
            </label>
            {kind === "PRODUCT_TYPE" && (
              <label>
                {t("category")}
                <select name="categoryId" required>
                  <option value="">{t("chooseCategory")}</option>
                  {catalog?.categories.map((item) => (
                    <option key={item.id} value={item.id}>
                      {localName(item)}
                    </option>
                  ))}
                </select>
              </label>
            )}
            <label>
              {t("englishName")}
              <input name="name" required />
            </label>
            <label>
              {t("arabicName")}
              <input name="nameAr" dir="rtl" />
            </label>
            <button className="button primary full" disabled={submitting}>
              <PackagePlus /> {submitting ? t("submitting") : t("submitReview")}
            </button>
          </form>
          <div className="panel">
            <div className="panel-head">
              <div>
                <p className="eyebrow">{t("reviewStatus")}</p>
                <h2>{t("yourRequests")}</h2>
              </div>
            </div>
            {rows.length ? (
              <div className="request-list">
                {rows.map((row) => (
                  <div className="request" key={row.local_id}>
                    <div>
                      <strong>{localName(row)}</strong>
                      <small>{localizeValue(language, row.entity_type)}</small>
                    </div>
                    <em
                      className={
                        row.status === "REJECTED"
                          ? "badge danger"
                          : row.status === "APPROVED" || row.status === "MERGED"
                            ? "badge"
                            : "badge warning"
                      }
                    >
                      {localizeValue(language, row.status)}
                    </em>
                  </div>
                ))}
              </div>
            ) : (
              <EmptyState
                icon={PackagePlus}
                title={t("noRequests")}
                text={t("noRequestsText")}
              />
            )}
          </div>
        </div>
      )}
    </div>
  );
}
