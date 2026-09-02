import { AlertTriangle, LoaderCircle, RefreshCw } from "lucide-react";

export function LoadingState({
  label,
  compact = false,
}: {
  label: string;
  compact?: boolean;
}) {
  return (
    <div
      className={`loading-state ${compact ? "compact" : ""}`}
      role="status"
      aria-live="polite"
    >
      <div className="loading-state-title">
        <LoaderCircle className="spin" />
        <span>{label}</span>
      </div>
      <div className="skeleton-grid" aria-hidden="true">
        {Array.from({ length: compact ? 3 : 6 }).map((_, index) => (
          <i key={index} />
        ))}
      </div>
    </div>
  );
}

export function ErrorState({
  title,
  text,
  retryLabel,
  onRetry,
}: {
  title: string;
  text: string;
  retryLabel: string;
  onRetry: () => void;
}) {
  return (
    <div className="error-state" role="alert">
      <span>
        <AlertTriangle />
      </span>
      <div>
        <strong>{title}</strong>
        <p>{text}</p>
      </div>
      <button className="button secondary" onClick={onRetry}>
        <RefreshCw />
        {retryLabel}
      </button>
    </div>
  );
}
