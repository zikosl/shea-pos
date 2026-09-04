import { useEffect, useRef, useState, type ComponentType } from "react";
import { ArrowRight, Search } from "lucide-react";

export type CommandItem = {
  id: string;
  label: string;
  group: string;
  icon: ComponentType<{ size?: number }>;
  shortcut?: string;
  run: () => void;
};

export function CommandPalette({ open, onClose, commands, placeholder, emptyText, navigateText, selectText }: {
  open: boolean;
  onClose: () => void;
  commands: CommandItem[];
  placeholder: string;
  emptyText: string;
  navigateText: string;
  selectText: string;
}) {
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const filtered = commands.filter((command) => `${command.label} ${command.group}`.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()));

  useEffect(() => {
    if (!open) return;
    setQuery("");
    setActiveIndex(0);
    requestAnimationFrame(() => inputRef.current?.focus());
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") { event.preventDefault(); onClose(); }
      else if (event.key === "ArrowDown") { event.preventDefault(); setActiveIndex((index) => Math.min(index + 1, Math.max(filtered.length - 1, 0))); }
      else if (event.key === "ArrowUp") { event.preventDefault(); setActiveIndex((index) => Math.max(index - 1, 0)); }
      else if (event.key === "Enter" && filtered[activeIndex]) { event.preventDefault(); filtered[activeIndex].run(); onClose(); }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open, onClose, filtered, activeIndex]);

  useEffect(() => setActiveIndex(0), [query]);
  if (!open) return null;
  let renderedGroup = "";
  return (
    <div className="command-backdrop" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <section className="command-palette" role="dialog" aria-modal="true" aria-label={placeholder}>
        <div className="command-search"><Search aria-hidden="true" /><input ref={inputRef} value={query} onChange={(event) => setQuery(event.target.value)} placeholder={placeholder} /><kbd>Esc</kbd></div>
        <div className="command-list" role="listbox">
          {filtered.length ? filtered.map((command, index) => {
            const showGroup = command.group !== renderedGroup;
            renderedGroup = command.group;
            return <div key={command.id}>
              {showGroup ? <p className="command-group">{command.group}</p> : null}
              <button className={`command-item ${index === activeIndex ? "active" : ""}`} type="button" role="option" aria-selected={index === activeIndex} onMouseEnter={() => setActiveIndex(index)} onClick={() => { command.run(); onClose(); }}>
                <command.icon size={17} /><span>{command.label}</span>{command.shortcut ? <kbd>{command.shortcut}</kbd> : <ArrowRight size={15} />}
              </button>
            </div>;
          }) : <p className="command-empty">{emptyText}</p>}
        </div>
        <footer className="command-footer"><span><kbd>↑</kbd><kbd>↓</kbd> {navigateText}</span><span><kbd>Enter</kbd> {selectText}</span></footer>
      </section>
    </div>
  );
}
