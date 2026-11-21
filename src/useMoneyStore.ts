import {
  useCallback,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
} from "react";
import {
  type ActivityPage,
  type Dashboard,
  activityQuery,
  confirmTransactionBatches,
  request,
} from "./data/api";
import { emptyFilters } from "./data/filters";
import {
  type Transaction,
  type TransactionPatch,
  configureFinance,
} from "./data/finance";
import {
  type KeyedEdit,
  type Override,
  PendingEdits,
  editLabel,
  resolveRows,
} from "./data/pendingEdits";
import { applyTransactionPatch, isCashFlowTransaction } from "./data/review";
import {
  adjacentMonths,
  localMonth,
  pageNumbers,
  parseRoute,
} from "./data/route";

type MonthData = {
  dashboard: Dashboard;
  transactions: Transaction[];
  // When the requests started: saved edits newer than this still win.
  fetchedAt: number;
};
// Visited months stay in memory only (never browser storage) and are shown
// instantly, then refreshed in the background when older than this.
const FRESH_MS = 60_000;
const REVALIDATE_DELAY_MS = 500;
const cache = new Map<string, MonthData & { stale: boolean }>();
const inflight = new Map<string, Promise<MonthData>>();
let initialLoad: Promise<MonthData> | null = null;

const errorMessage = (cause: unknown, fallback: string) =>
  cause instanceof Error ? cause.message : fallback;

async function fetchMonth(month: string | null): Promise<MonthData> {
  const fetchedAt = Date.now();
  const guess = month ?? localMonth();
  const page = (id: string, number: number) =>
    request<ActivityPage>(
      activityQuery({ ...emptyFilters(), months: [id] }, "", number),
    );
  // The month's rows start alongside the dashboard instead of after it.
  const dashboardRequest = request<Dashboard>(month ? `?month=${month}` : "");
  const guessed = page(guess, 1);
  guessed.catch(() => {});
  const dashboard = await dashboardRequest;
  const first =
    dashboard.month === guess ? await guessed : await page(dashboard.month, 1);
  const rest = await Promise.all(
    pageNumbers(first.total).map((number) => page(dashboard.month, number)),
  );
  const rows = new Map<string, Transaction>();
  for (const batch of [first, ...rest])
    for (const row of batch.transactions) rows.set(row.id, row);
  const data = { dashboard, transactions: [...rows.values()], fetchedAt };
  cache.set(dashboard.month, { ...data, stale: false });
  return data;
}

function loadMonth(month: string | null): Promise<MonthData> {
  const key = month ?? "current";
  const running = inflight.get(key);
  if (running) return running;
  const promise = fetchMonth(month).finally(() => inflight.delete(key));
  inflight.set(key, promise);
  return promise;
}

// Called before React mounts so the first requests overlap with script start-up.
export function prefetchInitial() {
  if (!initialLoad) {
    const month = parseRoute(location.hash).month;
    initialLoad = month
      ? loadMonth(month).catch(() => loadMonth(null))
      : loadMonth(null);
  }
  return initialLoad;
}

function prefetchMonth(month: string) {
  const cached = cache.get(month);
  if (cached && !cached.stale && Date.now() - cached.fetchedAt < FRESH_MS)
    return;
  loadMonth(month).catch(() => {});
}

const whenIdle = (callback: () => void) => {
  if (typeof window.requestIdleCallback === "function") {
    const handle = window.requestIdleCallback(callback, { timeout: 2000 });
    return () => window.cancelIdleCallback(handle);
  }
  const handle = window.setTimeout(callback, 300);
  return () => window.clearTimeout(handle);
};

export function useMoneyStore() {
  const [current, setCurrent] = useState<MonthData | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [overrides, setOverrides] = useState<Record<string, Override>>({});
  // Rows this session moved out of review, and when the server saved them
  // (Infinity while pending), so the review count drops at once.
  const [reviewedIds, setReviewedIds] = useState<Record<string, number>>({});
  const [version, setVersion] = useState(0);
  const [error, setError] = useState("");
  const [refreshing, setRefreshing] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [, queueChanged] = useReducer((value: number) => value + 1, 0);
  const overridesRef = useRef(overrides);
  overridesRef.current = overrides;
  const shownMonth = useRef<string | null>(null);
  const snapshots = useRef(
    new Map<number, Record<string, Override | undefined>>(),
  );
  const needsRevalidate = useRef(false);
  const revalidateTimer = useRef<number | undefined>(undefined);

  const show = useCallback((data: MonthData) => {
    configureFinance(data.dashboard);
    shownMonth.current = data.dashboard.month;
    setCurrent(data);
  }, []);

  // Refreshes the shown month without hiding it, then lets open lists
  // (Activity, Review, category sheets) refresh their rows in place.
  const revalidate = useCallback(async () => {
    const month = shownMonth.current;
    if (!month) return;
    for (const [id, entry] of cache) if (id !== month) entry.stale = true;
    setRefreshing(true);
    try {
      const data = await fetchMonth(month);
      if (shownMonth.current === month) show(data);
      setVersion((value) => value + 1);
    } catch (cause) {
      setError(errorMessage(cause, "Could not refresh"));
    } finally {
      setRefreshing(false);
    }
  }, [show]);

  const [queue] = useState(
    () =>
      new PendingEdits({
        onChange: () => {
          queueChanged();
          if (!needsRevalidate.current || queue.busy > 0) return;
          window.clearTimeout(revalidateTimer.current);
          revalidateTimer.current = window.setTimeout(() => {
            if (queue.busy > 0) return;
            needsRevalidate.current = false;
            void revalidate();
          }, REVALIDATE_DELAY_MS);
        },
        commit: async (edit: KeyedEdit, keepalive) => {
          snapshots.current.delete(edit.key);
          let saved: Transaction[] = [];
          try {
            if (edit.patch) {
              saved = [
                await request<Transaction>(`/transactions/${edit.ids[0]}`, {
                  method: "PATCH",
                  body: JSON.stringify({ transaction: edit.patch }),
                  keepalive,
                }),
              ];
            } else {
              await confirmTransactionBatches(
                edit.ids,
                (result) => saved.push(...result.transactions),
                keepalive,
              );
            }
          } catch (cause) {
            setError(errorMessage(cause, "Could not save your change"));
          } finally {
            const at = Date.now();
            const pending = queue.pendingIds();
            setOverrides((overrides) => {
              const next = { ...overrides };
              for (const row of saved)
                if (!pending.has(row.id)) next[row.id] = { row, at };
              // Rows the server did not save fall back to its version.
              for (const id of edit.ids)
                if (
                  !pending.has(id) &&
                  next[id]?.at === Number.POSITIVE_INFINITY
                )
                  delete next[id];
              return next;
            });
            const savedIds = new Set(saved.map((row) => row.id));
            setReviewedIds((reviewed) => {
              const next = { ...reviewed };
              for (const id of edit.ids) {
                if (!(id in next) || pending.has(id)) continue;
                if (savedIds.has(id)) next[id] = at;
                else delete next[id];
              }
              return next;
            });
            needsRevalidate.current = true;
          }
        },
      }),
  );

  useEffect(() => {
    void attempt;
    let live = true;
    setError("");
    prefetchInitial()
      .then((data) => {
        if (!live) return;
        show(data);
        setSelected((month) => month ?? data.dashboard.month);
      })
      .catch((cause) => {
        initialLoad = null;
        if (live) setError(errorMessage(cause, "Could not load your data"));
      });
    return () => {
      live = false;
    };
  }, [attempt, show]);

  // Month changes show a cached month at once; others load while the
  // previous month stays on screen.
  useEffect(() => {
    if (!selected || selected === shownMonth.current) return;
    let live = true;
    const cached = cache.get(selected);
    if (cached) {
      show(cached);
      if (cached.stale || Date.now() - cached.fetchedAt > FRESH_MS)
        void revalidate();
      return;
    }
    loadMonth(selected)
      .then((data) => {
        if (live) show(data);
      })
      .catch((cause) => {
        if (live) setError(errorMessage(cause, "Could not load that month"));
      });
    return () => {
      live = false;
    };
  }, [selected, show, revalidate]);

  // Warm the neighbouring months so the arrows switch without waiting.
  useEffect(() => {
    if (!current) return;
    const ids = current.dashboard.months.map((month) => month.id);
    return whenIdle(() => {
      if (queue.busy === 0)
        for (const id of adjacentMonths(ids, current.dashboard.month))
          prefetchMonth(id);
    });
  }, [current, queue]);

  // Leaving the page sends pending edits instead of waiting out the undo window.
  useEffect(() => {
    const flush = () => queue.flushAll(true);
    const hidden = () => {
      if (document.visibilityState === "hidden") flush();
    };
    window.addEventListener("pagehide", flush);
    document.addEventListener("visibilitychange", hidden);
    return () => {
      window.removeEventListener("pagehide", flush);
      document.removeEventListener("visibilitychange", hidden);
    };
  }, [queue]);

  const updateTransaction = useCallback(
    (original: Transaction, patch: TransactionPatch, group?: number) => {
      setError("");
      const before = overridesRef.current[original.id];
      setOverrides((overrides) => ({
        ...overrides,
        [original.id]: {
          row: applyTransactionPatch(original, patch),
          at: Number.POSITIVE_INFINITY,
        },
      }));
      if (isCashFlowTransaction(original) && !original.reviewed)
        setReviewedIds((reviewed) => ({
          ...reviewed,
          [original.id]: Number.POSITIVE_INFINITY,
        }));
      const key = queue.add({
        ids: [original.id],
        patch,
        label: editLabel(original, patch),
        group,
      });
      if (!snapshots.current.has(key))
        snapshots.current.set(key, { [original.id]: before });
    },
    [queue],
  );

  const confirmTransactions = useCallback(
    (rows: Transaction[]) => {
      if (!rows.length) return 0;
      setError("");
      const snapshot = Object.fromEntries(
        rows.map((row) => [row.id, overridesRef.current[row.id]]),
      );
      setOverrides((overrides) => ({
        ...overrides,
        ...Object.fromEntries(
          rows.map((row) => [
            row.id,
            { row: { ...row, reviewed: true }, at: Number.POSITIVE_INFINITY },
          ]),
        ),
      }));
      setReviewedIds((reviewed) => ({
        ...reviewed,
        ...Object.fromEntries(
          rows
            .filter((row) => isCashFlowTransaction(row) && !row.reviewed)
            .map((row) => [row.id, Number.POSITIVE_INFINITY]),
        ),
      }));
      const key = queue.add({
        ids: rows.map((row) => row.id),
        label: `Confirmed ${rows.length} transaction${rows.length === 1 ? "" : "s"}`,
      });
      snapshots.current.set(key, snapshot);
      return rows.length;
    },
    [queue],
  );

  const undoLast = useCallback(() => {
    const edits = queue.undo();
    if (!edits.length) return;
    // Later edits restore first so a row edited twice returns to its start.
    const restore = [...edits].reverse().map((edit) => {
      const snapshot = snapshots.current.get(edit.key) ?? {};
      snapshots.current.delete(edit.key);
      return { ids: edit.ids, snapshot };
    });
    setOverrides((overrides) => {
      const next = { ...overrides };
      for (const { ids, snapshot } of restore)
        for (const id of ids) {
          const previous = snapshot[id];
          if (previous) next[id] = previous;
          else delete next[id];
        }
      return next;
    });
    setReviewedIds((reviewed) => {
      const next = { ...reviewed };
      for (const edit of edits)
        for (const id of edit.ids)
          if (next[id] === Number.POSITIVE_INFINITY) delete next[id];
      return next;
    });
  }, [queue]);

  const retry = useCallback(() => {
    setError("");
    if (shownMonth.current) void revalidate();
    else setAttempt((value) => value + 1);
  }, [revalidate]);

  const transactions = useMemo(
    () =>
      current
        ? resolveRows(current.transactions, overrides, current.fetchedAt)
        : [],
    [current, overrides],
  );
  const resolve = useCallback(
    (rows: Transaction[], fetchedAt: number) =>
      resolveRows(rows, overrides, fetchedAt),
    [overrides],
  );
  const month = selected ?? current?.dashboard.month ?? null;
  const fetchedAt = current?.fetchedAt ?? 0;
  const reviewCount = Math.max(
    0,
    (current?.dashboard.reviewCount ?? 0) -
      Object.values(reviewedIds).filter((at) => at >= fetchedAt).length,
  );
  return {
    reviewCount,
    data: current?.dashboard ?? null,
    month,
    switching: !!current && month !== current.dashboard.month,
    transactions,
    resolve,
    overrides,
    updateTransaction,
    confirmTransactions,
    undo: queue.latest(),
    undoLast,
    setMonth: setSelected,
    version,
    error,
    dismissError: () => setError(""),
    loading: !current,
    refreshing,
    saving: queue.busy,
    retry,
  };
}
export type MoneyStore = ReturnType<typeof useMoneyStore>;
