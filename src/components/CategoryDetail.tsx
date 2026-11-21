import { ChevronRight } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import s from "../App.module.css";
import {
  type ActivityPage,
  type CashFlowSummary,
  activityQuery,
  queryPage,
  request,
} from "../data/api";
import { categoryAppearance } from "../data/appearance";
import {
  type CategorySelection,
  categoryActivityFilters,
  categoryMetrics,
  categoryShortcut,
  formatShare,
  transactionsByMonth,
} from "../data/categories";
import { type ActivityFilters, filterTransactions } from "../data/filters";
import { type Transaction, money, months, reportToday } from "../data/finance";
import type { MoneyStore } from "../useMoneyStore";
import c from "./Categories.module.css";
import { Button, EmojiTile, Sheet } from "./Primitives";
import { type TransactionPatch, TransactionRow } from "./Transactions";

export function CategoryDetail({
  selection,
  month,
  summary,
  yearlySummary,
  store,
  onClose,
  onFilter,
  onChange,
}: {
  selection: CategorySelection;
  month: string;
  summary: CashFlowSummary;
  yearlySummary: CashFlowSummary;
  store: MoneyStore;
  onClose: () => void;
  onFilter: (patch: Partial<ActivityFilters>) => void;
  onChange: (transaction: Transaction, patch: TransactionPatch) => void;
}) {
  const filters = categoryActivityFilters(selection, month);
  const query = activityQuery(filters, "");
  // The month's rows are already in memory, so the sheet opens with them and
  // fills in older months when the server answers.
  const [loaded, setLoaded] = useState<{
    rows: Transaction[];
    total: number;
    hasMore: boolean;
    pages: number;
    fetchedAt: number;
  } | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [retry, setRetry] = useState(0);
  const [editingId, setEditingId] = useState<string | null>(null);
  const editPosition = useRef(0);
  const retainedEditor = useRef<Transaction | null>(null);
  const pages = useRef(1);
  useEffect(() => {
    void store.version;
    void retry;
    const abort = new AbortController();
    setLoading(true);
    setError("");
    const fetchedAt = Date.now();
    Promise.all(
      Array.from({ length: pages.current }, (_, index) =>
        request<ActivityPage>(queryPage(query, index + 1), {
          signal: abort.signal,
        }),
      ),
    )
      .then((results) => {
        const rows = new Map<string, Transaction>();
        for (const result of results)
          for (const row of result.transactions) rows.set(row.id, row);
        setLoaded({
          rows: [...rows.values()],
          total: results[0].total,
          hasMore: results[results.length - 1].hasMore,
          pages: pages.current,
          fetchedAt,
        });
        setLoading(false);
      })
      .catch((cause) => {
        if (!abort.signal.aborted) {
          setError(cause.message);
          setLoading(false);
        }
      });
    return () => abort.abort();
  }, [query, store.version, retry]);
  async function loadMore() {
    pages.current += 1;
    setRetry((value) => value + 1);
  }

  const metrics = categoryMetrics(month, summary, yearlySummary, selection);
  if (!metrics) return null;
  const monthInfo = months.find((item) => item.id === month);
  const appearance = categoryAppearance(metrics.group.name, metrics.name);
  const subtitle = [
    selection.child ? metrics.group.name : null,
    monthInfo?.period,
  ]
    .filter(Boolean)
    .join(" · ");
  const thisYear = metrics.year === reportToday.slice(0, 4);
  const rows = loaded
    ? store.resolve(loaded.rows, loaded.fetchedAt)
    : filterTransactions(store.transactions, filters);
  const visible = filterTransactions(rows, filters);
  const editing =
    (editingId &&
      (rows.find((t) => t.id === editingId) ??
        store.overrides[editingId]?.row ??
        (retainedEditor.current?.id === editingId
          ? retainedEditor.current
          : null))) ||
    null;
  retainedEditor.current = editing;
  // Keep the editor in place when an edit moves its transaction elsewhere.
  const detached =
    editing && !visible.some((t) => t.id === editing.id) ? editing : null;
  const displayed = [...visible];
  if (detached)
    displayed.splice(
      Math.min(editPosition.current, displayed.length),
      0,
      detached,
    );
  return (
    <Sheet
      title={metrics.name}
      icon={<EmojiTile {...appearance} size={36} />}
      subtitle={subtitle}
      onClose={onClose}
    >
      <div className={c.summary}>
        <strong className={c.spent}>{money(metrics.cents, true)}</strong>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => onFilter(categoryShortcut(selection))}
          aria-label={`View all ${metrics.name} transactions`}
        >
          View all <ChevronRight size={15} aria-hidden="true" />
        </Button>
      </div>
      <section aria-label={`Key metrics for ${metrics.year}`}>
        <dl className={c.metrics}>
          <div>
            <dt>{thisYear ? "This year" : metrics.year}</dt>
            <dd title={money(metrics.yearCents, true)}>
              {money(metrics.yearCents)}
            </dd>
          </div>
          <div>
            <dt>Monthly avg</dt>
            <dd title={money(metrics.monthlyAverageCents, true)}>
              {money(metrics.monthlyAverageCents)}
            </dd>
          </div>
          <div>
            <dt>Share of {monthInfo?.short.slice(0, 3) ?? month}</dt>
            <dd>{formatShare(metrics.share)}</dd>
          </div>
        </dl>
      </section>
      <section aria-label="Transactions">
        {transactionsByMonth(displayed).map((section) => {
          const info = months.find((item) => item.id === section.month);
          return (
            <div key={section.month}>
              <h4 className={c.monthHeading}>
                {section.month.startsWith(metrics.year)
                  ? (info?.short ?? section.month)
                  : (info?.label ?? section.month)}
              </h4>
              {section.transactions.map((transaction) => (
                <div key={transaction.id} className={s.transactionEntry}>
                  <TransactionRow
                    transaction={transaction}
                    expanded={editingId === transaction.id}
                    onToggle={() => {
                      if (editingId !== transaction.id)
                        editPosition.current = visible.findIndex(
                          (t) => t.id === transaction.id,
                        );
                      setEditingId(
                        editingId === transaction.id ? null : transaction.id,
                      );
                    }}
                    onChange={(patch) => onChange(transaction, patch)}
                    // The sheet already names the category; keep other subcategories visible.
                    hideCategory={
                      transaction.category === selection.group &&
                      transaction.subcategory === metrics?.name
                    }
                    onFilter={onFilter}
                  />
                  {transaction.id === detached?.id && (
                    <p className={s.caption}>
                      {transaction.kind === "expense"
                        ? `This transaction is now in ${transaction.subcategory}.`
                        : "This transaction is no longer spending."}
                    </p>
                  )}
                </div>
              ))}
            </div>
          );
        })}
        {loading && !loaded && (
          <output className={s.caption}>Loading earlier months…</output>
        )}
        {error && (
          <p role="alert">
            {error}{" "}
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setRetry((value) => value + 1)}
            >
              Retry
            </Button>
          </p>
        )}
        {!loading && !error && !displayed.length && (
          <p className={s.caption}>No spending in this category yet.</p>
        )}
        {loaded?.hasMore && !error && (
          <button
            type="button"
            className={s.loadMore}
            disabled={loading}
            onClick={loadMore}
          >
            {loading ? "Loading…" : "Show more"}
            <span>
              {loaded.rows.length} of {loaded.total}
            </span>
          </button>
        )}
      </section>
    </Sheet>
  );
}
