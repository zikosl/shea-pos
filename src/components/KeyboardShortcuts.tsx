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

function getTextEntryTarget(target: EventTarget | null): HTMLElement | null {
  if (!(target instanceof HTMLElement)) return null;
  const element = target.closest("input, textarea, [contenteditable='true']");
  if (!(element instanceof HTMLElement)) return null;
  if (element instanceof HTMLInputElement) {
    return ["button", "checkbox", "color", "file", "hidden", "image", "radio", "reset", "submit"]
      .includes(element.type)
      ? null
      : element;
  }
  return element;
}

function hasOpenPopoverForTarget(target: EventTarget | null) {
  if (!(target instanceof HTMLElement)) return false;
  if (target.closest("[role='listbox'], [role='menu'], [aria-expanded='true']"))
    return true;
  const targetId = target.id;
  if (!targetId) return false;
  return Array.from(document.querySelectorAll<HTMLElement>("[aria-expanded='true']"))
    .some((control) => control.getAttribute("aria-controls")?.split(/\s+/).includes(targetId));
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
        document.querySelector(".modal-backdrop, .operator-switch-layer, .operator-menu-popover, .command-backdrop, [role='dialog'], [aria-modal='true']"),
      );
      if (event.key === "Escape" && !overlayOpen && !hasOpenPopoverForTarget(event.target) && !event.defaultPrevented) {
        const textEntry = getTextEntryTarget(event.target);
        if (textEntry) {
          event.preventDefault();
          event.stopPropagation();
          event.stopImmediatePropagation();
          textEntry.blur();
          return;
        }
      }
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
