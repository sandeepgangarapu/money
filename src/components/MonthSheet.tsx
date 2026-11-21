import type { CSSProperties } from "react";
import type { Month } from "../data/finance";
import { Sheet, useSheet } from "./Primitives";
import s from "./Shell.module.css";

const compact = (cents: number) =>
  new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    notation: "compact",
    maximumFractionDigits: 1,
  }).format(cents / 100);

export function MonthSheet({
  months,
  selected,
  today,
  onChange,
  onClose,
}: {
  months: Month[];
  selected: string;
  today: string;
  onChange: (index: number) => void;
  onClose: () => void;
}) {
  const years = [...new Set(months.map((month) => month.id.slice(0, 4)))]
    .sort()
    .reverse();
  const most = Math.max(1, ...months.map((month) => month.spendingCents ?? 0));
  return (
    <Sheet title="Choose month" onClose={onClose}>
      <div className={s.monthYears}>
        {years.map((year) => (
          <section key={year} aria-label={year}>
            <h3>{year}</h3>
            <div className={s.monthGrid}>
              {Array.from({ length: 12 }, (_, offset) => {
                const id = `${year}-${String(offset + 1).padStart(2, "0")}`;
                const index = months.findIndex((month) => month.id === id);
                return (
                  <MonthCell
                    key={id}
                    id={id}
                    month={months[index]}
                    selected={id === selected}
                    current={id === today.slice(0, 7)}
                    most={most}
                    onSelect={() => onChange(index)}
                  />
                );
              })}
            </div>
          </section>
        ))}
      </div>
    </Sheet>
  );
}

function MonthCell({
  id,
  month,
  selected,
  current,
  most,
  onSelect,
}: {
  id: string;
  month: Month | undefined;
  selected: boolean;
  current: boolean;
  most: number;
  onSelect: () => void;
}) {
  const sheet = useSheet();
  const name = new Date(`${id}-01T12:00:00`).toLocaleDateString("en-US", {
    month: "short",
  });
  if (!month)
    return (
      <span className={s.monthCell} data-empty aria-hidden="true">
        {name}
      </span>
    );
  const spending = month.spendingCents;
  return (
    <button
      type="button"
      className={s.monthCell}
      aria-current={selected ? "date" : undefined}
      data-current={current || undefined}
      aria-label={`${month.label}${current ? ", current month" : ""}${spending !== undefined ? `, ${compact(spending)} spent` : ""}`}
      onClick={() => {
        onSelect();
        sheet?.close();
      }}
    >
      <span className={s.monthName}>{name}</span>
      {spending !== undefined && (
        <span className={s.monthSpend}>
          {compact(spending)}
          {current ? " so far" : ""}
        </span>
      )}
      {spending !== undefined && (
        <span
          className={s.monthBar}
          style={
            {
              "--share": Math.max(0.04, Math.max(0, spending) / most),
            } as CSSProperties
          }
          aria-hidden="true"
        />
      )}
    </button>
  );
}
