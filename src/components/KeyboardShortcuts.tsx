import { useEffect } from "react";

export type KeyboardShortcut = {
  id: string;
  key: string;
  alt?: boolean;
  primary?: boolean;
  shift?: boolean;
  enabled?: boolean;
  allowInField?: boolean;
  run: () => void;
};

function isEditableTarget(target: EventTarget | null) {
  if (!(target instanceof HTMLElement)) return false;
  return Boolean(
    target.closest("input, textarea, select, [contenteditable='true']"),
  );
}

export function KeyboardShortcuts({
  shortcuts,
  active = true,
}: {
  shortcuts: KeyboardShortcut[];
  active?: boolean;
}) {
  useEffect(() => {
    if (!active) return;

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.repeat) return;
      const overlayOpen = Boolean(
        document.querySelector(".modal-backdrop, .operator-switch-layer"),
      );
      const editable = isEditableTarget(event.target);
      const pressedKey = event.key.toLowerCase();
      const shortcut = shortcuts.find((item) => {
        if (item.enabled === false || item.key.toLowerCase() !== pressedKey)
          return false;
        if (Boolean(item.alt) !== event.altKey) return false;
        if (Boolean(item.shift) !== event.shiftKey) return false;
        if (item.primary && !(event.ctrlKey || event.metaKey)) return false;
        if (!item.primary && (event.ctrlKey || event.metaKey)) return false;
        return true;
      });

      if (!shortcut) return;
      if (overlayOpen) return;
      if (editable && !shortcut.allowInField) return;

      event.preventDefault();
      shortcut.run();
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [active, shortcuts]);

  return null;
}
