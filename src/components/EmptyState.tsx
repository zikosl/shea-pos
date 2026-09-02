import type { LucideIcon } from "lucide-react";

export function EmptyState({
  icon: Icon,
  title,
  text,
}: {
  icon: LucideIcon;
  title: string;
  text: string;
}) {
  return (
    <div className="empty">
      <span>
        <Icon />
      </span>
      <strong>{title}</strong>
      <p>{text}</p>
    </div>
  );
}
