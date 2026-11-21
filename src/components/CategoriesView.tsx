import { ChevronDown } from "lucide-react";
import {
  type CSSProperties,
  Fragment,
  type ReactNode,
  useEffect,
  useId,
  useState,
} from "react";
import type { CashFlowSummary } from "../data/api";
import { categoryAppearance } from "../data/appearance";
import {
  type CategorySelection,
  categoryRows,
  categorySpendingSegments,
  formatShare,
  splitByActivity,
} from "../data/categories";
import type { ActivityFilters } from "../data/filters";
import { type Transaction, money, months } from "../data/finance";
import type { MoneyStore } from "../useMoneyStore";
import c from "./Categories.module.css";
import { CategoryDetail } from "./CategoryDetail";
import { EmojiTile, Panel } from "./Primitives";
import type { TransactionPatch } from "./Transactions";

export function CategoriesView({
  active,
  month,
  summary,
  yearlySummary,
  store,
  onFilter,
  onChange,
}: {
  active: boolean;
  month: string;
  summary: CashFlowSummary;
  yearlySummary: CashFlowSummary;
  store: MoneyStore;
  onFilter: (patch: Partial<ActivityFilters>) => void;
  onChange: (transaction: Transaction, patch: TransactionPatch) => void;
}) {
  const [collapsed, setCollapsed] = useState<string[]>([]);
  const [showInactive, setShowInactive] = useState(false);
  const [selected, setSelected] = useState<CategorySelection | null>(null);
  const id = useId();
  const rows = categoryRows(summary);
  const { active: spending, inactive } = splitByActivity(rows);
  const segments = categorySpendingSegments(rows);
  const monthName = months.find((item) => item.id === month)?.short ?? month;
  // A modal sheet inside a hidden tab would leave the page inert.
  useEffect(() => {
    if (!active) setSelected(null);
  }, [active]);
  const row = (
    selection: CategorySelection,
    item: { name: string; cents: number; share: number },
    marker: ReactNode,
  ) => (
    <button
      type="button"
      className={c.open}
      onClick={() => setSelected(selection)}
      aria-label={`${item.name}, ${money(item.cents)}, ${formatShare(item.share)} of spending. Show details`}
    >
      <span className={c.marker}>{marker}</span>
      <span className={c.label}>
        <span className={c.name}>{item.name}</span>
        <span className={c.share}>{formatShare(item.share)}</span>
      </span>
      <strong className={c.amount}>{money(item.cents)}</strong>
      <span className={c.bar} aria-hidden="true">
        <span style={{ width: `${Math.min(item.share, 1) * 100}%` }} />
      </span>
    </button>
  );
  return (
    <>
      <Panel className={c.header}>
        <span className={c.headerCaption}>Spent in {monthName}</span>
        <strong className={c.total}>{money(summary.spending)}</strong>
        <div className={c.stackedBar} aria-hidden="true">
          {segments.map((segment) => (
            <span
              key={segment.id}
              style={
                {
                  flexGrow: segment.cents,
                  "--category-color": segment.name
                    ? categoryAppearance(segment.name).color
                    : "var(--faint)",
                } as CSSProperties
              }
            />
          ))}
        </div>
      </Panel>
      <Panel>
        <div className={c.list}>
          {spending.map((group) => {
            const hasParent = group.cents !== 0;
            const open = !hasParent || !collapsed.includes(group.id);
            const color = {
              "--category-color": categoryAppearance(group.name).color,
            } as CSSProperties;
            const childIds = group.subcategories.map(
              (child) => `${id}-${encodeURIComponent(child.id)}`,
            );
            return (
              <Fragment key={group.id}>
                {hasParent && (
                  <div className={c.row} style={color}>
                    {row(
                      { group: group.id },
                      group,
                      <EmojiTile
                        {...categoryAppearance(group.name)}
                        size={36}
                      />,
                    )}
                    {group.subcategories.length > 0 && (
                      <button
                        type="button"
                        className={c.toggle}
                        aria-expanded={open}
                        aria-controls={childIds.join(" ")}
                        aria-label={`${open ? "Collapse" : "Expand"} ${group.name} subcategories`}
                        onClick={() =>
                          setCollapsed((current) =>
                            open
                              ? [...current, group.id]
                              : current.filter((value) => value !== group.id),
                          )
                        }
                      >
                        <ChevronDown size={16} aria-hidden="true" />
                      </button>
                    )}
                  </div>
                )}
                {group.subcategories.map((child, index) => (
                  <div
                    key={child.id}
                    id={childIds[index]}
                    className={c.row}
                    data-depth="1"
                    style={
                      {
                        "--category-color": categoryAppearance(
                          group.name,
                          child.name,
                        ).color,
                      } as CSSProperties
                    }
                    hidden={!open}
                  >
                    {row(
                      { group: group.id, child: child.id },
                      child,
                      <span className={c.dot} aria-hidden="true" />,
                    )}
                  </div>
                ))}
              </Fragment>
            );
          })}
          {inactive.length > 0 && (
            <div className={c.inactive}>
              <button
                type="button"
                className={c.disclosure}
                aria-expanded={showInactive}
                aria-controls={`${id}-inactive`}
                onClick={() => setShowInactive((current) => !current)}
              >
                <span>
                  {inactive.length}{" "}
                  {inactive.length === 1 ? "category" : "categories"} with no
                  spending
                </span>
                <ChevronDown size={16} aria-hidden="true" />
              </button>
              <div id={`${id}-inactive`} hidden={!showInactive}>
                {inactive.map((item) => (
                  <div
                    key={`${item.selection.group}/${item.selection.child ?? ""}`}
                    className={c.row}
                    data-depth={item.selection.child ? "1" : undefined}
                    data-inactive="true"
                    style={
                      {
                        "--category-color": categoryAppearance(
                          item.groupName,
                          item.name,
                        ).color,
                      } as CSSProperties
                    }
                  >
                    {row(
                      item.selection,
                      item,
                      item.selection.child ? (
                        <span className={c.dot} aria-hidden="true" />
                      ) : (
                        <EmojiTile
                          {...categoryAppearance(item.groupName)}
                          size={36}
                        />
                      ),
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </Panel>
      {active && selected && (
        <CategoryDetail
          key={`${selected.group}/${selected.child ?? ""}`}
          selection={selected}
          month={month}
          summary={summary}
          yearlySummary={yearlySummary}
          store={store}
          onClose={() => setSelected(null)}
          onFilter={(patch) => {
            setSelected(null);
            onFilter(patch);
          }}
          onChange={onChange}
        />
      )}
    </>
  );
}
