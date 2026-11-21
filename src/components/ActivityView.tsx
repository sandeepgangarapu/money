import { Search, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import s from "../App.module.css";
import {
  type ActivityPage,
  activityQuery,
  queryPage,
  request,
} from "../data/api";
import {
  type ActivityFilters,
  activityDayLabel,
  emptyFilters,
  filterTransactions,
  groupTransactionsByDay,
  groupsByDay,
  normalizeIncomeFilters,
} from "../data/filters";
import type { Transaction } from "../data/finance";
import { confidentTransactionIds } from "../data/review";
import type { MoneyStore } from "../useMoneyStore";
import a from "./Activity.module.css";
import { ActivityFilterBar } from "./ActivityFilters";
import { RulesButton } from "./MoneyRules";
import { Button, Panel } from "./Primitives";
import { type TransactionPatch, TransactionRow } from "./Transactions";

type Loaded = {
  query: string;
  rows: Transaction[];
  total: number;
  hasMore: boolean;
  pages: number;
  fetchedAt: number;
};
const SEARCH_DELAY_MS = 250;

export function ActivityView({
  store,
  reviewCount,
  filters,
  onFilters,
  search,
  onSearch,
  onFilter,
  editingId,
  onEdit,
  onChange,
  resetKey,
}: {
  store: MoneyStore;
  reviewCount: number;
  filters: ActivityFilters;
  onFilters: (filters: ActivityFilters) => void;
  search: string;
  onSearch: (search: string) => void;
  onFilter: (patch: Partial<ActivityFilters>) => void;
  editingId: string | null;
  onEdit: (id: string | null) => void;
  onChange: (transaction: Transaction, patch: TransactionPatch) => void;
  resetKey: number;
}) {
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState("");
  const [retry, setRetry] = useState(0);
  const latest = useRef(loaded);
  latest.current = loaded;
  const previousSearch = useRef(search);
  const query = activityQuery(filters, search);
  // Refreshes keep the rows on screen; a new query previews matches from the
  // rows already loaded until the server answers. Only typing is debounced.
  useEffect(() => {
    void store.version;
    void retry;
    const abort = new AbortController();
    const same = latest.current?.query === query;
    const pages = same ? (latest.current?.pages ?? 1) : 1;
    const typing = previousSearch.current !== search;
    previousSearch.current = search;
    setLoading(true);
    setError("");
    const timer = window.setTimeout(
      async () => {
        const fetchedAt = Date.now();
        try {
          const results = await Promise.all(
            Array.from({ length: pages }, (_, index) =>
              request<ActivityPage>(queryPage(query, index + 1), {
                signal: abort.signal,
              }),
            ),
          );
          const rows = new Map<string, Transaction>();
          for (const result of results)
            for (const row of result.transactions) rows.set(row.id, row);
          const last = results[results.length - 1];
          setLoaded({
            query,
            rows: [...rows.values()],
            total: results[0].total,
            hasMore: last.hasMore,
            pages,
            fetchedAt,
          });
          setLoading(false);
        } catch (cause) {
          if (!abort.signal.aborted) {
            setError(cause instanceof Error ? cause.message : "Could not load");
            setLoading(false);
          }
        }
      },
      typing ? SEARCH_DELAY_MS : 0,
    );
    return () => {
      window.clearTimeout(timer);
      abort.abort();
    };
  }, [query, search, store.version, retry]);
  async function loadMore() {
    const current = latest.current;
    if (!current || loadingMore) return;
    const page = current.pages + 1;
    setLoadingMore(true);
    try {
      const fetchedAt = Date.now();
      const result = await request<ActivityPage>(queryPage(query, page));
      setLoaded((previous) => {
        if (!previous || previous.query !== current.query) return previous;
        const seen = new Set(previous.rows.map((row) => row.id));
        return {
          ...previous,
          rows: [
            ...previous.rows,
            ...result.transactions.filter((row) => !seen.has(row.id)),
          ],
          total: result.total,
          hasMore: result.hasMore,
          pages: page,
          fetchedAt: Math.min(previous.fetchedAt, fetchedAt),
        };
      });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not load");
    } finally {
      setLoadingMore(false);
    }
  }
  const stale = !!loaded && loaded.query !== query;
  const editPosition = useRef(0);
  const transactions = loaded
    ? store.resolve(loaded.rows, loaded.fetchedAt)
    : [];
  const retainedEditor = useRef<Transaction | null>(null);
  const editing =
    transactions.find((t) => t.id === editingId) ??
    (editingId && store.overrides[editingId]?.row) ??
    (retainedEditor.current?.id === editingId ? retainedEditor.current : null);
  retainedEditor.current = editing || null;
  const results = filterTransactions(transactions, filters, search);
  const visible = results;
  const confidentIds = confidentTransactionIds(visible);
  // Keep the editor in place when an edit moves its transaction out of this scope.
  const detached =
    editing && !visible.some((t) => t.id === editing.id) ? editing : null;
  const displayed = [...visible];
  if (detached)
    displayed.splice(
      Math.min(editPosition.current, displayed.length),
      0,
      detached,
    );
  const grouped = groupsByDay(filters);
  const clear = () => {
    onEdit(null);
    onFilters(emptyFilters());
    onSearch("");
  };
  const row = (transaction: Transaction) => (
    <TransactionRow
      key={transaction.id}
      transaction={transaction}
      showDate={!grouped}
      markConfident={
        filters.review === "unreviewed" && confidentIds.includes(transaction.id)
      }
      expanded={editingId === transaction.id}
      onToggle={() => {
        if (editingId !== transaction.id)
          editPosition.current = visible.findIndex(
            (t) => t.id === transaction.id,
          );
        onEdit(editingId === transaction.id ? null : transaction.id);
      }}
      onChange={(patch) => onChange(transaction, patch)}
      onFilter={onFilter}
    />
  );
  return (
    <>
      <div className={a.toolbar}>
        <div className={a.searchRow}>
          <div className={a.search}>
            <Search size={18} aria-hidden="true" />
            <input
              type="search"
              aria-label="Search transactions"
              placeholder="Merchant, category, account"
              value={search}
              onChange={(event) => {
                onEdit(null);
                onSearch(event.target.value);
              }}
            />
            {!!search && (
              <button
                type="button"
                className={s.iconButton}
                aria-label="Clear search"
                onClick={() => onSearch("")}
              >
                <X size={16} />
              </button>
            )}
          </div>
          <RulesButton />
        </div>
        <ActivityFilterBar
          filters={filters}
          reviewCount={reviewCount}
          hasSearch={!!search}
          onChange={(next) => {
            onEdit(null);
            onFilters(normalizeIncomeFilters(next));
          }}
          onClear={clear}
          resetKey={resetKey}
        />
      </div>
      <Panel className={s.activityList}>
        {filters.review === "unreviewed" && confidentIds.length > 0 && (
          <div className={a.batch}>
            <Button
              size="sm"
              onClick={() =>
                store.confirmTransactions(
                  visible.filter((t) => confidentIds.includes(t.id)),
                )
              }
            >
              {`Confirm ${confidentIds.length} confident`}
            </Button>
            <p className={a.caption}>Rows marked ✨ will be confirmed</p>
          </div>
        )}
        <div className={a.count} aria-live="polite">
          {!loaded || stale
            ? loading
              ? "Searching…"
              : ""
            : `${loaded.total} transaction${loaded.total !== 1 ? "s" : ""}`}
          <span>
            {filters.date ||
              (filters.cashFlowPeriod
                ? `${filters.cashFlowPeriod.length === 4 ? filters.cashFlowPeriod : new Date(`${filters.cashFlowPeriod}-01T12:00:00`).toLocaleDateString("en-US", { month: "short", year: "numeric" })} report`
                : "") ||
              (filters.months.length
                ? `${filters.months.length} selected month${filters.months.length === 1 ? "" : "s"}`
                : "All months")}
          </span>
        </div>
        {grouped
          ? groupTransactionsByDay(displayed).map((group) => (
              <section
                key={group.date}
                aria-label={activityDayLabel(group.date)}
              >
                <h2 className={a.day}>{activityDayLabel(group.date)}</h2>
                {group.transactions.map((transaction) => (
                  <div key={transaction.id} className={a.entry}>
                    {row(transaction)}
                    {transaction.id === detached?.id && (
                      <p className={a.caption}>
                        This transaction no longer matches these filters.
                      </p>
                    )}
                  </div>
                ))}
              </section>
            ))
          : displayed.map((transaction) => (
              <div key={transaction.id} className={a.entry}>
                {row(transaction)}
                {transaction.id === detached?.id && (
                  <p className={a.caption}>
                    This transaction no longer matches these filters.
                  </p>
                )}
              </div>
            ))}
        {error && (
          <p role="alert">
            {error}{" "}
            <button
              type="button"
              onClick={() => setRetry((value) => value + 1)}
            >
              Retry
            </button>
          </p>
        )}
        {!loaded && !error && (
          <div className={a.placeholders} aria-hidden="true">
            {[0, 1, 2, 3, 4, 5].map((key) => (
              <span key={key} />
            ))}
          </div>
        )}
        {loaded && !stale && !error && !results.length && !detached && (
          <div className={s.emptyState}>
            <Search size={26} />
            <h2>No matching transactions</h2>
            <button type="button" className={s.textButton} onClick={clear}>
              Clear filters & search
            </button>
          </div>
        )}
        {loaded?.hasMore && !stale && !error && (
          <button
            type="button"
            className={s.loadMore}
            disabled={loadingMore}
            onClick={loadMore}
          >
            {loadingMore
              ? "Loading…"
              : `Show next ${Math.min(100, loaded.total - loaded.rows.length)}`}{" "}
            <span>
              {loaded.rows.length} of {loaded.total}
            </span>
          </button>
        )}
      </Panel>
    </>
  );
}
