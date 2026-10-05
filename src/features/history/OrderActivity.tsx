import { useEffect, useState } from "react";
import { localeFor, localizeError, localizeValue, useI18n } from "../../i18n";

type Entry = {
  id: string;
  action: string;
  from_status: string | null;
  to_status: string | null;
  operator_name: string;
  created_at: string;
  sync_state: string;
  last_error: string | null;
};

export function OrderActivity({ orderType, orderId }: { orderType: "ONLINE" | "GIFT"; orderId: string }) {
  const { t, language } = useI18n();
  const [entries, setEntries] = useState<Entry[]>([]);
  const [error, setError] = useState("");
  useEffect(() => {
    let active = true;
    const load = () => void window.pos.orderActivity({ orderType, orderId }).then((rows) => {
      if (active) { setEntries(rows as Entry[]); setError(""); }
    }).catch((value) => { if (active) setError(localizeError(language, value)); });
    load();
    const timer = window.setInterval(load, 15_000);
    return () => { active = false; window.clearInterval(timer); };
  }, [orderType, orderId, language]);
  return <section className="order-activity"><h3>{t("orderActivity")}</h3>
    {error ? <p className="form-error">{error}</p> : !entries.length ? <p className="order-activity-empty">{t("noOrderActivity")}</p> : <div className="order-activity-list">
      {entries.map((entry) => <div className="order-activity-entry" key={entry.id}>
        <div><strong>{entry.to_status ? localizeValue(language, entry.to_status) : localizeValue(language, entry.action)}</strong><small>{entry.operator_name} · {new Date(entry.created_at).toLocaleString(localeFor(language))}</small></div>
        <em className="badge">{localizeValue(language, entry.sync_state)}</em>
        {entry.last_error ? <small className="order-activity-error">{entry.last_error}</small> : null}
      </div>)}
    </div>}
  </section>;
}
