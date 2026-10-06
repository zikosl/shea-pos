import { useEffect, useState } from "react";
import {
  ArrowDownRight,
  ArrowUpRight,
  BarChart3,
  CreditCard,
  LoaderCircle,
  PackageCheck,
  ReceiptText,
  UsersRound,
  WalletCards,
} from "lucide-react";
import { localeFor, localizeValue, useI18n } from "../../i18n";
import { money } from "../../shared/format";
import { ErrorState, LoadingState } from "../../components/AsyncState";
import { PageHeader } from "../../components/PageHeader";
import { DatePicker } from "../../components/DateTimePicker";
import { localizeError } from "../../i18n";

type Report = any;

type WorkerActivity = {
  sales: Array<{
    operator_id: string | null;
    operator_name: string | null;
    sale_count: number;
    sales_total: number;
  }>;
  refunds: Array<{
    operator_id: string | null;
    operator_name: string | null;
    refund_count: number;
    refunds_total: number;
  }>;
};

type WorkerInsight = {
  id: string;
  name: string;
  sales: number;
  refunds: number;
  gross: number;
  refunded: number;
};

export function ReportsScreen({
  onNotice,
  canViewTeam,
}: {
  onNotice: (message: string) => void;
  canViewTeam: boolean;
}) {
  const { t, language } = useI18n();
  const [range, setRange] = useState("today");
  const [report, setReport] = useState<Report>();
  const [custom, setCustom] = useState({ from: "", to: "" });
  const [cash, setCash] = useState<any>(null);
  const [sessions, setSessions] = useState<any[]>([]);
  const [team, setTeam] = useState<WorkerActivity | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [registerBusy, setRegisterBusy] = useState(false);
  function dates() {
    const to = new Date(),
      from = new Date();
    if (range === "week") from.setDate(from.getDate() - 6);
    else if (range === "month") from.setDate(from.getDate() - 29);
    else if (range === "today") from.setHours(0, 0, 0, 0);
    else
      return {
        from: new Date(`${custom.from}T00:00:00`).toISOString(),
        to: new Date(`${custom.to}T23:59:59`).toISOString(),
      };
    return { from: from.toISOString(), to: to.toISOString() };
  }
  const load = async () => {
    setLoading(true);
    setError("");
    try {
      const [overview, cashSession, cashSessions, workerActivity] = await Promise.all([
        window.pos.getOverview(dates()),
        window.pos.getCashSession(),
        window.pos.listCashSessions(),
        canViewTeam ? window.pos.workerActivity(dates()) : Promise.resolve(null),
      ]);
      setReport(overview);
      setCash(cashSession);
      setSessions(cashSessions as any[]);
      setTeam(workerActivity as WorkerActivity | null);
    } catch (value) {
      setError(localizeError(language, value));
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => {
    if (range !== "custom") void load();
  }, [range, canViewTeam]);
  const summary = report?.summary ?? {};
  const workers = mergeWorkerInsights(team);
  return (
    <div className="report-stack">
      <PageHeader
        eyebrow={t("performance")}
        title={t("reports")}
        actions={
          <div className="segmented report-range">
            {(["today", "week", "month", "custom"] as const).map((item) => (
              <button
                key={item}
                className={range === item ? "active" : ""}
                onClick={() => setRange(item)}
              >
                {t(item)}
              </button>
            ))}
          </div>
        }
      />
      {range === "custom" && (
        <div className="date-range">
          <label>
            {t("from")}
            <DatePicker
              value={custom.from}
              onChange={(from) => setCustom({ ...custom, from })}
              max={custom.to || undefined}
            />
          </label>
          <label>
            {t("to")}
            <DatePicker
              value={custom.to}
              onChange={(to) => setCustom({ ...custom, to })}
              min={custom.from || undefined}
            />
          </label>
          <button
            className="button primary"
            disabled={!custom.from || !custom.to}
            onClick={load}
          >
            {t("apply")}
          </button>
        </div>
      )}
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
        <>
          <div className="metric-grid">
            <Metric
              icon={WalletCards}
              label={t("revenue")}
              value={money(summary.revenue)}
            />
            <Metric
              icon={ArrowUpRight}
              label={t("grossProfit")}
              value={money(summary.gross_profit)}
            />
            <Metric
              icon={ArrowDownRight}
              label={t("fees")}
              value={money(summary.partner_fee)}
            />
            <Metric
              featured
              icon={BarChart3}
              label={t("netProfit")}
              value={money(summary.net_profit)}
            />
            <Metric
              icon={ReceiptText}
              label={t("ordersCount")}
              value={String(summary.sale_count ?? 0)}
            />
            <Metric
              icon={CreditCard}
              label={t("averageSale")}
              value={money(summary.average_sale)}
            />
            <Metric
              icon={PackageCheck}
              label={t("lowStock")}
              value={String(report?.stock?.low ?? 0)}
            />
          </div>
          <section className="panel trend-panel">
            <div className="section-title">
              <div>
                <p className="eyebrow">{t("salesTrend")}</p>
                <h3>{t("revenueOverTime")}</h3>
              </div>
              <strong>{money(summary.revenue)}</strong>
            </div>
            <TrendChart
              rows={report?.trend ?? []}
              language={language}
              empty={t("noData")}
            />
          </section>
          <div className="report-grid">
            <section className="panel">
              <h3>{t("topProducts")}</h3>
              {report?.topProducts?.length ? (
                <div className="rank-list">
                  {report.topProducts.map((row: any, index: number) => (
                    <div key={`${row.product_name}-${row.variant_name}`}>
                      <i>{index + 1}</i>
                      <span>
                        <strong>{row.product_name}</strong>
                        <small>
                          {row.variant_name ? `${row.variant_name} · ` : ""}
                          {row.quantity} {t("sold")}
                        </small>
                      </span>
                      <b>{money(row.revenue)}</b>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="muted">{t("noData")}</p>
              )}
            </section>
            <section className="panel">
              <h3>{t("paymentMix")}</h3>
              {report?.payments?.length ? (
                <div className="payment-list">
                  {report.payments.map((row: any) => (
                    <div key={row.method}>
                      <span>{localizeValue(language, row.method)}</span>
                      <progress value={row.total} max={summary.revenue || 1} />
                      <b>{money(row.total)}</b>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="muted">{t("noData")}</p>
              )}
            </section>
          </div>
          {canViewTeam && (
            <section className="panel team-insights-panel">
              <div className="section-title">
                <div>
                  <p className="eyebrow">{t("team")}</p>
                  <h3>{t("teamInsights")}</h3>
                  <p className="team-insights-help">{t("teamInsightsText")}</p>
                </div>
                <span className="team-insights-icon" aria-hidden="true">
                  <UsersRound />
                </span>
              </div>
              {workers.length ? (
                <div className="team-insights-list">
                  {workers.map((worker) => {
                    const net = worker.gross - worker.refunded;
                    const average = worker.sales ? worker.gross / worker.sales : 0;
                    return (
                      <div className="team-insight-row" key={worker.id}>
                        <div className="team-insight-name">
                          <strong>{worker.name}</strong>
                          <small>
                            {worker.sales} {t("completedSales").toLowerCase()}
                            {worker.refunds ? ` · ${worker.refunds} ${t("refunds").toLowerCase()}` : ""}
                          </small>
                        </div>
                        <div>
                          <small>{t("averageTicket")}</small>
                          <b>{money(average)}</b>
                        </div>
                        <div className="team-insight-net">
                          <small>{t("netSales")}</small>
                          <b>{money(net)}</b>
                        </div>
                      </div>
                    );
                  })}
                </div>
              ) : (
                <p className="muted team-insights-empty">{t("noData")}</p>
              )}
            </section>
          )}
          <section className="panel register-panel">
            <div>
              <p className="eyebrow">{t("register")}</p>
              <h3>{cash ? t("registerOpen") : t("registerClosed")}</h3>
              {cash && (
                <div className="register-metrics">
                  <span>
                    <small>{t("openingCash")}</small>
                    <b>{money(cash.opening_amount)}</b>
                  </span>
                  <span>
                    <small>{t("expectedCash")}</small>
                    <b>{money(cash.expected_cash)}</b>
                  </span>
                </div>
              )}
            </div>
            {cash ? (
              <form
                onSubmit={async (event) => {
                  event.preventDefault();
                  const form = new FormData(event.currentTarget);
                  setRegisterBusy(true);
                  try {
                    await window.pos.closeCashSession({
                      countedCash: Number(form.get("counted")),
                    });
                    await load();
                  } catch (value) {
                    onNotice(localizeError(language, value));
                  } finally {
                    setRegisterBusy(false);
                  }
                }}
              >
                <label>
                  {t("countedCash")}
                  <input name="counted" type="number" min="0" required />
                </label>
                <button className="button primary" disabled={registerBusy}>
                  {registerBusy && <LoaderCircle className="spin" />}
                  {registerBusy ? t("saving") : t("closeRegister")}
                </button>
              </form>
            ) : (
              <form
                onSubmit={async (event) => {
                  event.preventDefault();
                  const form = new FormData(event.currentTarget);
                  setRegisterBusy(true);
                  try {
                    await window.pos.openCashSession({
                      openingAmount: Number(form.get("opening")),
                    });
                    await load();
                  } catch (value) {
                    onNotice(localizeError(language, value));
                  } finally {
                    setRegisterBusy(false);
                  }
                }}
              >
                <label>
                  {t("openingCash")}
                  <input
                    name="opening"
                    type="number"
                    min="0"
                    defaultValue="0"
                    required
                  />
                </label>
                <button className="button primary" disabled={registerBusy}>
                  {registerBusy && <LoaderCircle className="spin" />}
                  {registerBusy ? t("saving") : t("openRegister")}
                </button>
              </form>
            )}
            <div className="session-summary">
              <small>
                {sessions.length} {t("sessionsStored")}
              </small>
              {sessions.slice(0, 3).map((row) => (
                <span key={row.local_id}>
                  {new Date(row.opened_at).toLocaleDateString(
                    localeFor(language),
                  )}{" "}
                  · {localizeValue(language, row.status)}
                  {row.difference != null
                    ? ` · ${t("difference")} ${money(row.difference)}`
                    : ""}
                </span>
              ))}
            </div>
          </section>
        </>
      )}
    </div>
  );
}

function mergeWorkerInsights(activity: WorkerActivity | null): WorkerInsight[] {
  if (!activity) return [];
  const workers = new Map<string, WorkerInsight>();
  const add = (
    id: string | null,
    name: string | null,
    values: Partial<Pick<WorkerInsight, "sales" | "refunds" | "gross" | "refunded">>,
  ) => {
    const key = id ?? "unassigned";
    const current = workers.get(key) ?? {
      id: key,
      name: name || "—",
      sales: 0,
      refunds: 0,
      gross: 0,
      refunded: 0,
    };
    current.name = current.name === "—" && name ? name : current.name;
    current.sales += Number(values.sales ?? 0);
    current.refunds += Number(values.refunds ?? 0);
    current.gross += Number(values.gross ?? 0);
    current.refunded += Number(values.refunded ?? 0);
    workers.set(key, current);
  };
  activity.sales.forEach((row) =>
    add(row.operator_id, row.operator_name, {
      sales: row.sale_count,
      gross: row.sales_total,
    }),
  );
  activity.refunds.forEach((row) =>
    add(row.operator_id, row.operator_name, {
      refunds: row.refund_count,
      refunded: row.refunds_total,
    }),
  );
  return [...workers.values()].sort(
    (left, right) => right.gross - right.refunded - (left.gross - left.refunded),
  );
}

function Metric({
  icon: Icon,
  label,
  value,
  featured = false,
}: {
  icon: any;
  label: string;
  value: string;
  featured?: boolean;
}) {
  return (
    <div className={`metric ${featured ? "featured" : ""}`}>
      <span>
        <Icon />
      </span>
      <small>{label}</small>
      <strong>{value}</strong>
    </div>
  );
}

function TrendChart({
  rows,
  language,
  empty,
}: {
  rows: any[];
  language: "en" | "ar";
  empty: string;
}) {
  if (!rows.length) return <div className="chart-empty">{empty}</div>;
  const width = 900;
  const height = 220;
  const padding = 18;
  const values = rows.map((row) => Number(row.revenue || 0));
  const max = Math.max(...values, 1);
  const points = rows.map((row, index) => ({
    x:
      rows.length === 1
        ? width / 2
        : padding + (index / (rows.length - 1)) * (width - padding * 2),
    y:
      height -
      padding -
      (Number(row.revenue || 0) / max) * (height - padding * 2),
    row,
  }));
  const line = points.map((point) => `${point.x},${point.y}`).join(" ");
  const area = `${padding},${height - padding} ${line} ${width - padding},${height - padding}`;

  return (
    <div className="trend-chart">
      <svg
        viewBox={`0 0 ${width} ${height}`}
        role="img"
        aria-label={empty}
        preserveAspectRatio="none"
      >
        <defs>
          <linearGradient id="reportArea" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="var(--primary)" stopOpacity=".22" />
            <stop offset="1" stopColor="var(--primary)" stopOpacity="0" />
          </linearGradient>
        </defs>
        {[0.25, 0.5, 0.75].map((value) => (
          <line
            key={value}
            x1={padding}
            x2={width - padding}
            y1={height * value}
            y2={height * value}
            className="chart-gridline"
          />
        ))}
        <polygon points={area} fill="url(#reportArea)" />
        <polyline points={line} className="chart-line" />
        {points.map((point) => (
          <circle key={point.row.day} cx={point.x} cy={point.y} r="4">
            <title>
              {new Date(point.row.day).toLocaleDateString(localeFor(language))}:{" "}
              {money(point.row.revenue)}
            </title>
          </circle>
        ))}
      </svg>
      <div className="chart-labels">
        {points.map((point) => (
          <span key={point.row.day}>
            {new Date(point.row.day).toLocaleDateString(localeFor(language), {
              day: "numeric",
              month: "short",
            })}
          </span>
        ))}
      </div>
    </div>
  );
}
