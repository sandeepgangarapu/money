import { X } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";
import s from "../App.module.css";
import { accountNickname } from "../data/accounts";
import {
  type ActivityFilters,
  activeFilters,
  emptyFilters,
  reviewFilters,
} from "../data/filters";
import {
  accounts,
  categories,
  months,
  transactionKindLabels,
} from "../data/finance";
import { PickerButton } from "./Primitives";

type Picker =
  | "months"
  | "categoryGroups"
  | "categories"
  | "kinds"
  | "accounts"
  | "date"
  | "amount"
  | "statuses"
  | "visibility"
  | "sort";
const pickers: { key: Picker; title: string }[] = [
  { key: "months", title: "Months" },
  { key: "categoryGroups", title: "Categories" },
  { key: "categories", title: "Subcategories" },
  { key: "kinds", title: "Types" },
  { key: "accounts", title: "Accounts" },
  { key: "date", title: "Date" },
  { key: "amount", title: "Amount" },
  { key: "statuses", title: "Status" },
  { key: "visibility", title: "Cash flow" },
  { key: "sort", title: "Sort" },
];
const sortLabels = {
  newest: "Newest first",
  oldest: "Oldest first",
  largest: "Largest amount",
  smallest: "Smallest amount",
  review: "Least certain first",
};
function Options({
  items,
  selected,
  onToggle,
  columns = false,
}: {
  items: { value: string; label: string }[];
  selected: string[];
  onToggle: (value: string) => void;
  columns?: boolean;
}) {
  return (
    <div className={columns ? s.filterOptionGrid : undefined}>
      {items.map(({ value, label }) => (
        <label className={s.filterOption} key={value}>
          <input
            type="checkbox"
            checked={selected.includes(value)}
            onChange={() => onToggle(value)}
          />
          <span>{label}</span>
        </label>
      ))}
    </div>
  );
}
export function ActivityFilterBar({
  filters,
  reviewCount,
  hasSearch,
  onChange,
  onClear,
  resetKey,
}: {
  filters: ActivityFilters;
  reviewCount: number;
  hasSearch: boolean;
  onChange: (filters: ActivityFilters) => void;
  onClear: () => void;
  resetKey: number;
}) {
  const [open, setOpen] = useState<Picker | null>(null);
  const [amounts, setAmounts] = useState({
    min: filters.minAmount,
    max: filters.maxAmount,
  });
  const [error, setError] = useState("");
  const root = useRef<HTMLDivElement>(null);
  const carousel = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement | null>(null);
  const keyboardOpen = useRef(false);
  const id = useId();
  const chips = activeFilters(filters);
  const hasFilters = chips.length > 0 || hasSearch || filters.sort !== "newest";
  useEffect(() => {
    void resetKey;
    setOpen(null);
    carousel.current?.scrollTo({ left: 0 });
  }, [resetKey]);
  useEffect(() => {
    if (!open) return;
    setAmounts({ min: filters.minAmount, max: filters.maxAmount });
    setError("");
    function outside(event: PointerEvent) {
      if (event.target instanceof Node && !root.current?.contains(event.target))
        setOpen(null);
    }
    document.addEventListener("pointerdown", outside);
    return () => document.removeEventListener("pointerdown", outside);
  }, [open, filters.minAmount, filters.maxAmount]);
  useEffect(() => {
    if (open && keyboardOpen.current)
      root.current
        ?.querySelector<HTMLElement>("[data-filter-options] input")
        ?.focus({ preventScroll: true });
  }, [open]);
  function toggle(
    key:
      | "months"
      | "categoryGroups"
      | "categories"
      | "kinds"
      | "accounts"
      | "statuses",
    value: string,
  ) {
    const values = filters[key] as string[];
    onChange({
      ...filters,
      [key]: values.includes(value)
        ? values.filter((v) => v !== value)
        : [...values, value],
    });
  }
  function labelFor(key: Picker) {
    if (key === "sort")
      return filters.sort === "newest" ? "Sort" : sortLabels[filters.sort];
    if (
      key === "statuses" &&
      filters.review === "reviewed" &&
      !filters.statuses.length
    )
      return "Reviewed";
    return chips.find(
      (chip) => chip.key === (key === "amount" ? "minAmount" : key),
    )?.label;
  }
  function clearPicker() {
    if (!open) return;
    const defaults = emptyFilters();
    if (open === "amount") {
      onChange({ ...filters, minAmount: "", maxAmount: "" });
      setAmounts({ min: "", max: "" });
      setError("");
    } else if (open === "statuses")
      onChange(reviewFilters({ ...filters, statuses: [] }, "all"));
    else onChange({ ...filters, [open]: defaults[open] });
  }
  function changeAmount(key: "min" | "max", value: string) {
    const next = { ...amounts, [key]: value };
    setAmounts(next);
    if (
      (next.min && Number(next.min) < 0) ||
      (next.max && Number(next.max) < 0)
    ) {
      setError("Amounts must be zero or more.");
      return;
    }
    if (next.min && next.max && Number(next.min) > Number(next.max)) {
      setError("Minimum must be less than or equal to maximum.");
      return;
    }
    setError("");
    onChange({ ...filters, minAmount: next.min, maxAmount: next.max });
  }
  const sortedPickers = [...pickers].sort(
    (a, b) =>
      Number(
        !!labelFor(b.key) && !(b.key === "sort" && filters.sort === "newest"),
      ) -
      Number(
        !!labelFor(a.key) && !(a.key === "sort" && filters.sort === "newest"),
      ),
  );
  return (
    <div
      ref={root}
      className={s.filterBar}
      onKeyDown={(event) => {
        if (event.key === "Escape" && open) {
          event.preventDefault();
          setOpen(null);
          trigger.current?.focus({ preventScroll: true });
        }
      }}
      onBlur={(event) => {
        if (
          event.relatedTarget &&
          !event.currentTarget.contains(event.relatedTarget)
        )
          setOpen(null);
      }}
    >
      <div className={s.filterStrip}>
        <div
          ref={carousel}
          className={s.filterCarousel}
          aria-label="Activity filters"
        >
          <PickerButton
            className={s.filterPill}
            showChevron={false}
            aria-pressed={filters.review === "unreviewed"}
            onClick={() => {
              setOpen(null);
              onChange(
                reviewFilters(
                  filters,
                  filters.review === "unreviewed" ? "all" : "unreviewed",
                ),
              );
            }}
          >
            Needs review <span className={s.filterCount}>{reviewCount}</span>
          </PickerButton>
          {chips
            .filter((chip) =>
              ["cashFlowPeriod", "incomeSource"].includes(chip.key),
            )
            .map((chip) => (
              <PickerButton
                key={chip.key}
                className={s.filterPill}
                showChevron={false}
                trailing={<X size={14} aria-hidden="true" />}
                data-active
                aria-label={`Remove ${chip.label} filter`}
                title={chip.label}
                onClick={() => {
                  setOpen(null);
                  onChange({
                    ...filters,
                    [chip.key]: "",
                    ...(chip.key === "cashFlowPeriod"
                      ? { incomeSource: "" }
                      : {}),
                  });
                }}
              >
                {chip.label}
              </PickerButton>
            ))}
          {sortedPickers.map(({ key, title }) => {
            const selected = labelFor(key);
            const active =
              !!selected && !(key === "sort" && filters.sort === "newest");
            return (
              <PickerButton
                key={key}
                className={s.filterPill}
                data-active={active}
                aria-label={`${title}${active ? `: ${selected}` : ""}`}
                aria-expanded={open === key}
                aria-controls={id}
                onKeyDown={(event) => {
                  if (event.key === "ArrowDown") {
                    event.preventDefault();
                    keyboardOpen.current = true;
                    trigger.current = event.currentTarget;
                    setOpen(key);
                  }
                }}
                onClick={(event) => {
                  keyboardOpen.current = event.detail === 0;
                  trigger.current = event.currentTarget;
                  setOpen(open === key ? null : key);
                }}
              >
                {active ? selected : title}
              </PickerButton>
            );
          })}
        </div>
        {hasFilters && (
          <button
            type="button"
            className={s.clearFilters}
            data-active={hasFilters}
            aria-label="Clear all filters and search"
            title="Clear all filters and search"
            onClick={() => {
              setOpen(null);
              carousel.current?.scrollTo({ left: 0 });
              onClear();
            }}
          >
            Clear
          </button>
        )}
      </div>
      <section
        id={id}
        className={s.filterPicker}
        hidden={!open}
        aria-label={`Filter by ${pickers.find((p) => p.key === open)?.title ?? "selection"}`}
      >
        <header>
          <h2>{pickers.find((p) => p.key === open)?.title}</h2>
          <button type="button" className={s.textButton} onClick={clearPicker}>
            Reset
          </button>
          <button
            type="button"
            className={s.iconButton}
            aria-label="Close filter picker"
            onClick={() => {
              setOpen(null);
              trigger.current?.focus({ preventScroll: true });
            }}
          >
            <X size={17} />
          </button>
        </header>
        <div className={s.pickerOptions} data-filter-options>
          {open === "months" && (
            <Options
              columns
              items={[...months]
                .reverse()
                .map((m) => ({ value: m.id, label: m.label }))}
              selected={filters.months}
              onToggle={(v) => toggle("months", v)}
            />
          )}
          {open === "categoryGroups" && (
            <Options
              items={categories.map((c) => ({ value: c.id, label: c.name }))}
              selected={filters.categoryGroups}
              onToggle={(v) => toggle("categoryGroups", v)}
            />
          )}
          {open === "categories" &&
            categories.map((c) => (
              <fieldset className={s.pickerGroup} key={c.id}>
                <legend>{c.name}</legend>
                <Options
                  items={c.children.map((child) => ({
                    value: `${c.id}|${child}`,
                    label: child,
                  }))}
                  selected={filters.categories}
                  onToggle={(v) => toggle("categories", v)}
                />
              </fieldset>
            ))}
          {open === "kinds" && (
            <Options
              items={Object.entries(transactionKindLabels).map(
                ([value, label]) => ({
                  value,
                  label,
                }),
              )}
              selected={filters.kinds}
              onToggle={(v) => toggle("kinds", v)}
            />
          )}
          {open === "accounts" && (
            <Options
              items={[...accounts]
                .sort()
                .map((v) => ({ value: v, label: accountNickname(v) }))}
              selected={filters.accounts}
              onToggle={(v) => toggle("accounts", v)}
            />
          )}
          {open === "date" && (
            <label className={s.pickerField}>
              On this day
              <input
                type="date"
                value={filters.date}
                onChange={(event) =>
                  onChange({ ...filters, date: event.target.value })
                }
              />
            </label>
          )}
          {open === "amount" && (
            <>
              <div className={s.amountRange}>
                <label>
                  Minimum ($)
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    inputMode="decimal"
                    placeholder="0"
                    value={amounts.min}
                    onChange={(e) => changeAmount("min", e.target.value)}
                  />
                </label>
                <span>to</span>
                <label>
                  Maximum ($)
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    inputMode="decimal"
                    placeholder="Any"
                    value={amounts.max}
                    onChange={(e) => changeAmount("max", e.target.value)}
                  />
                </label>
              </div>
              {error && (
                <p role="alert" className={s.filterError}>
                  {error}
                </p>
              )}
            </>
          )}
          {open === "statuses" && (
            <>
              <Options
                columns
                items={[
                  { value: "posted", label: "Posted" },
                  { value: "pending", label: "Pending" },
                ]}
                selected={filters.statuses}
                onToggle={(v) => toggle("statuses", v)}
              />
              <fieldset className={s.pickerGroup}>
                <legend>Review status</legend>
                {(["all", "unreviewed", "reviewed"] as const).map((v) => (
                  <label className={s.filterOption} key={v}>
                    <input
                      type="radio"
                      name={`${id}-review`}
                      checked={filters.review === v}
                      onChange={() => onChange(reviewFilters(filters, v))}
                    />
                    {v === "all"
                      ? "All"
                      : v === "unreviewed"
                        ? "Needs review"
                        : "Reviewed"}
                  </label>
                ))}
              </fieldset>
            </>
          )}
          {open === "visibility" &&
            (["all", "included", "excluded"] as const).map((v) => (
              <label className={s.filterOption} key={v}>
                <input
                  type="radio"
                  name={`${id}-visibility`}
                  checked={filters.visibility === v}
                  onChange={() => onChange({ ...filters, visibility: v })}
                />
                {v === "all"
                  ? "Included & excluded"
                  : v === "included"
                    ? "Included only"
                    : "Excluded only"}
              </label>
            ))}
          {open === "sort" &&
            (Object.keys(sortLabels) as (keyof typeof sortLabels)[]).map(
              (v) => (
                <label className={s.filterOption} key={v}>
                  <input
                    type="radio"
                    name={`${id}-sort`}
                    checked={filters.sort === v}
                    onChange={() => onChange({ ...filters, sort: v })}
                  />
                  {sortLabels[v]}
                </label>
              ),
            )}
        </div>
      </section>
    </div>
  );
}
