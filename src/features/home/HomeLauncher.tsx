import type { LucideIcon } from "lucide-react";
import { ArrowUpRight } from "lucide-react";

export type LauncherPage = "pos" | "stock" | "barcodes" | "entries" | "gifts" | "orders" | "sales" | "reports" | "requests" | "team" | "settings";

export type LauncherItem = {
  id: LauncherPage;
  label: string;
  description: string;
  icon: LucideIcon;
  badge?: string;
};

export type LauncherGroup = {
  id: string;
  label: string;
  items: LauncherItem[];
};

export function HomeLauncher({
  greeting,
  storeName,
  intro,
  groups,
  onNavigate,
}: {
  greeting: string;
  storeName: string;
  intro: string;
  groups: LauncherGroup[];
  onNavigate: (page: LauncherPage) => void;
}) {
  return (
    <div className="home-launcher">
      <header className="launcher-welcome">
        <p className="eyebrow">{storeName}</p>
        <h2>{greeting}</h2>
        <p className="launcher-intro">{intro}</p>
      </header>
      <div className="launcher-grid">
        {groups.flatMap((group) => group.items).map(({ id, label, description, icon: Icon, badge }) => (
          <button
            className={`launcher-tile ${id === "pos" ? "launcher-tile-primary" : ""}`}
            type="button"
            key={id}
            onClick={() => onNavigate(id)}
          >
            <span className={`launcher-tile-icon launcher-icon-${id}`}><Icon /></span>
            <span className="launcher-tile-copy">
              <strong>{label}</strong>
              <small>{description}</small>
            </span>
            {badge ? <span className="launcher-tile-badge">{badge}</span> : null}
            <ArrowUpRight className="launcher-tile-open" aria-hidden="true" />
          </button>
        ))}
      </div>
    </div>
  );
}
