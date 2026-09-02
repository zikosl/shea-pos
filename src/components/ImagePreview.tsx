import { useEffect, useRef, useState } from "react";
import { ImageOff, RotateCcw, X, ZoomIn, ZoomOut } from "lucide-react";
import { useI18n } from "../i18n";

export type ImagePreviewItem = {
  src: string;
  title: string;
  subtitle?: string;
};

export function ImagePreview({
  item,
  onClose,
}: {
  item: ImagePreviewItem;
  onClose: () => void;
}) {
  const { t } = useI18n();
  const [zoom, setZoom] = useState(1);
  const [failed, setFailed] = useState(false);
  const closeButton = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    const previouslyFocused = document.activeElement as HTMLElement | null;
    document.body.style.overflow = "hidden";
    closeButton.current?.focus();

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
      if (event.key === "+" || event.key === "=")
        setZoom((value) => Math.min(2.5, value + 0.25));
      if (event.key === "-")
        setZoom((value) => Math.max(0.75, value - 0.25));
      if (event.key === "0") setZoom(1);
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", handleKeyDown);
      previouslyFocused?.focus();
    };
  }, [onClose]);

  return (
    <div
      className="image-preview-backdrop"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <section
        className="image-preview-dialog"
        role="dialog"
        aria-modal="true"
        aria-label={t("imagePreview")}
      >
        <header className="image-preview-header">
          <div>
            <p className="eyebrow">{t("imagePreview")}</p>
            <h2>{item.title}</h2>
            {item.subtitle ? <p>{item.subtitle}</p> : null}
          </div>
          <button
            ref={closeButton}
            type="button"
            className="image-preview-close"
            aria-label={t("close")}
            onClick={onClose}
          >
            <X />
          </button>
        </header>

        <div className="image-preview-stage">
          {failed ? (
            <div className="image-preview-unavailable">
              <ImageOff />
              <strong>{t("imageUnavailable")}</strong>
            </div>
          ) : (
            <img
              src={item.src}
              alt={item.title}
              draggable={false}
              style={{ transform: `scale(${zoom})` }}
              onError={() => setFailed(true)}
            />
          )}
        </div>

        {!failed ? (
          <footer className="image-preview-tools">
            <button
              type="button"
              aria-label={t("zoomOut")}
              title={t("zoomOut")}
              disabled={zoom <= 0.75}
              onClick={() => setZoom((value) => Math.max(0.75, value - 0.25))}
            >
              <ZoomOut />
            </button>
            <output aria-live="polite">{Math.round(zoom * 100)}%</output>
            <button
              type="button"
              aria-label={t("zoomIn")}
              title={t("zoomIn")}
              disabled={zoom >= 2.5}
              onClick={() => setZoom((value) => Math.min(2.5, value + 0.25))}
            >
              <ZoomIn />
            </button>
            <span />
            <button
              type="button"
              aria-label={t("resetZoom")}
              title={t("resetZoom")}
              disabled={zoom === 1}
              onClick={() => setZoom(1)}
            >
              <RotateCcw />
            </button>
          </footer>
        ) : null}
      </section>
    </div>
  );
}
