import { ChevronLeft, ChevronRight } from "lucide-react";
import { useI18n } from "../i18n";

type PaginationProps = {
  page: number;
  pageSize: number;
  total?: number;
  hasNext?: boolean;
  onPageChange: (page: number) => void;
  className?: string;
};

export function Pagination({
  page,
  pageSize,
  total,
  hasNext,
  onPageChange,
  className = "",
}: PaginationProps) {
  const { t, language } = useI18n();
  const start = total === 0 ? 0 : page * pageSize + 1;
  const end = total == null ? page * pageSize + pageSize : Math.min((page + 1) * pageSize, total);
  const canGoNext = hasNext ?? (total != null && end < total);
  const PreviousIcon = language === "ar" ? ChevronRight : ChevronLeft;
  const NextIcon = language === "ar" ? ChevronLeft : ChevronRight;

  return (
    <nav className={`pagination ${className}`} aria-label={t("pagination")}>
      <button type="button" aria-label={t("previousPage")} title={t("previousPage")} disabled={page === 0} onClick={() => onPageChange(page - 1)}>
        <PreviousIcon />
      </button>
      <span aria-live="polite">
        {total == null ? `${t("page")} ${page + 1}` : `${t("showing")} ${start}–${end} ${t("of")} ${total}`}
      </span>
      <button type="button" aria-label={t("nextPage")} title={t("nextPage")} disabled={!canGoNext} onClick={() => onPageChange(page + 1)}>
        <NextIcon />
      </button>
    </nav>
  );
}
