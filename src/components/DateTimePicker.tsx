import { useEffect, useId, useMemo, useRef, useState } from "react";
import {
  CalendarDays,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Clock3,
} from "lucide-react";
import { localeFor, useI18n } from "../i18n";

type PickerProps = {
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
};

function usePopoverDismiss(
  open: boolean,
  close: () => void,
  ref: React.RefObject<HTMLDivElement | null>,
) {
  useEffect(() => {
    if (!open) return;
    const dismiss = (event: PointerEvent) => {
      if (!ref.current?.contains(event.target as Node)) close();
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") close();
    };
    document.addEventListener("pointerdown", dismiss);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("pointerdown", dismiss);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [close, open, ref]);
}

function dateFromValue(value: string) {
  const [year, month, day] = value.split("-").map(Number);
  return year && month && day
    ? new Date(year, month - 1, day, 12)
    : new Date();
}

function dateValue(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function DatePicker({
  value,
  onChange,
  disabled,
  min,
  max,
}: PickerProps & { min?: string; max?: string }) {
  const { t, language } = useI18n();
  const [open, setOpen] = useState(false);
  const [month, setMonth] = useState(() => {
    const selected = dateFromValue(value);
    return new Date(selected.getFullYear(), selected.getMonth(), 1);
  });
  const rootRef = useRef<HTMLDivElement>(null);
  const labelId = useId();
  usePopoverDismiss(open, () => setOpen(false), rootRef);

  useEffect(() => {
    if (!value) return;
    const selected = dateFromValue(value);
    setMonth(new Date(selected.getFullYear(), selected.getMonth(), 1));
  }, [value]);

  const days = useMemo(() => {
    const startOffset = (month.getDay() + 6) % 7;
    const start = new Date(month.getFullYear(), month.getMonth(), 1 - startOffset, 12);
    return Array.from({ length: 42 }, (_, index) => {
      const day = new Date(start);
      day.setDate(start.getDate() + index);
      return day;
    });
  }, [month]);
  const weekdays = useMemo(
    () =>
      Array.from({ length: 7 }, (_, index) => {
        const day = new Date(2024, 0, 1 + index, 12);
        return new Intl.DateTimeFormat(localeFor(language), {
          weekday: "narrow",
        }).format(day);
      }),
    [language],
  );
  const selected = value ? dateFromValue(value) : null;
  const formatted = selected
    ? new Intl.DateTimeFormat(localeFor(language), {
        day: "numeric",
        month: "short",
        year: "numeric",
      }).format(selected)
    : t("selectDate");

  return (
    <div className="date-picker" ref={rootRef}>
      <button
        type="button"
        className={`picker-trigger ${open ? "open" : ""}`}
        disabled={disabled}
        aria-expanded={open}
        aria-controls={labelId}
        onClick={() => setOpen((current) => !current)}
      >
        <CalendarDays />
        <span>{formatted}</span>
        <ChevronDown />
      </button>
      {open ? (
        <div className="calendar-popover" id={labelId} role="dialog">
          <div className="calendar-heading">
            <button
              type="button"
              className="icon-button"
              aria-label={t("previousMonth")}
              onClick={() =>
                setMonth(
                  new Date(month.getFullYear(), month.getMonth() - 1, 1),
                )
              }
            >
              <ChevronLeft />
            </button>
            <strong>
              {month.toLocaleDateString(localeFor(language), {
                month: "long",
                year: "numeric",
              })}
            </strong>
            <button
              type="button"
              className="icon-button"
              aria-label={t("nextMonth")}
              onClick={() =>
                setMonth(
                  new Date(month.getFullYear(), month.getMonth() + 1, 1),
                )
              }
            >
              <ChevronRight />
            </button>
          </div>
          <div className="calendar-weekdays" aria-hidden="true">
            {weekdays.map((weekday, index) => (
              <span key={`${weekday}-${index}`}>{weekday}</span>
            ))}
          </div>
          <div className="calendar-days">
            {days.map((day) => {
              const nextValue = dateValue(day);
              const unavailable = Boolean(
                (min && nextValue < min) || (max && nextValue > max),
              );
              return (
                <button
                  type="button"
                  key={nextValue}
                  className={[
                    day.getMonth() !== month.getMonth() ? "outside" : "",
                    nextValue === value ? "selected" : "",
                    nextValue === dateValue(new Date()) ? "today" : "",
                  ].join(" ")}
                  disabled={unavailable}
                  aria-pressed={nextValue === value}
                  onClick={() => {
                    onChange(nextValue);
                    setOpen(false);
                  }}
                >
                  {day.getDate()}
                </button>
              );
            })}
          </div>
          <button
            type="button"
            className="calendar-today"
            onClick={() => {
              const today = dateValue(new Date());
              if ((!min || today >= min) && (!max || today <= max)) {
                onChange(today);
                setOpen(false);
              }
            }}
          >
            {t("today")}
          </button>
        </div>
      ) : null}
    </div>
  );
}

export function TimePicker({ value, onChange, disabled }: PickerProps) {
  const { t, language } = useI18n();
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const [hour = "09", minute = "00"] = (value || "09:00").split(":");
  usePopoverDismiss(open, () => setOpen(false), rootRef);

  const formatted = value
    ? new Intl.DateTimeFormat(localeFor(language), {
        hour: "2-digit",
        minute: "2-digit",
      }).format(new Date(2024, 0, 1, Number(hour), Number(minute)))
    : t("selectTime");

  return (
    <div className="time-picker" ref={rootRef}>
      <button
        type="button"
        className={`picker-trigger ${open ? "open" : ""}`}
        disabled={disabled}
        aria-expanded={open}
        onClick={() => setOpen((current) => !current)}
      >
        <Clock3 />
        <span>{formatted}</span>
        <ChevronDown />
      </button>
      {open ? (
        <div className="time-popover">
          <p>{t("selectTime")}</p>
          <div className="time-selectors">
            <label>
              <span>{t("hour")}</span>
              <select
                value={hour}
                onChange={(event) =>
                  onChange(`${event.target.value}:${minute}`)
                }
              >
                {Array.from({ length: 24 }, (_, index) =>
                  String(index).padStart(2, "0"),
                ).map((item) => (
                  <option key={item}>{item}</option>
                ))}
              </select>
            </label>
            <b>:</b>
            <label>
              <span>{t("minute")}</span>
              <select
                value={minute}
                onChange={(event) =>
                  onChange(`${hour}:${event.target.value}`)
                }
              >
                {Array.from({ length: 60 }, (_, index) =>
                  String(index).padStart(2, "0"),
                ).map((item) => (
                  <option key={item}>{item}</option>
                ))}
              </select>
            </label>
          </div>
        </div>
      ) : null}
    </div>
  );
}

export function DateTimePicker({
  value,
  onChange,
  name,
  disabled,
  min,
}: PickerProps & { name?: string; min?: string }) {
  const [date = "", time = ""] = value.split("T");
  const updateDate = (nextDate: string) =>
    onChange(`${nextDate}T${time || "09:00"}`);
  const updateTime = (nextTime: string) =>
    onChange(`${date || dateValue(new Date())}T${nextTime}`);

  return (
    <div className="date-time-picker">
      {name ? <input type="hidden" name={name} value={value} /> : null}
      <DatePicker value={date} onChange={updateDate} disabled={disabled} min={min} />
      <TimePicker value={time} onChange={updateTime} disabled={disabled} />
    </div>
  );
}
