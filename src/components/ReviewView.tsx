import { Check, EyeOff, X } from "lucide-react";
import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { accountNickname } from "../data/accounts";
import { type ActivityPage, activityQuery, request } from "../data/api";
import { categoryAppearance, transactionAppearance } from "../data/appearance";
import { rememberCategory } from "../data/categoryChoices";
import { type ActivityFilters, emptyFilters } from "../data/filters";
import {
  type Transaction,
  type TransactionPatch,
  categories,
  shortDate,
  signedMoney,
} from "../data/finance";
import { displayName } from "../data/merchant";
import {
  confidentTransactionIds,
  isCashFlowTransaction,
  isRefund,
  needsCategory,
  suggestionLabel,
  transactionType,
  transactionTypeOptions,
  transactionTypePatch,
} from "../data/review";
import {
  type CategorySuggestion,
  categorySuggestions,
  formatElapsed,
  inboxOrder,
  nextFocus,
  reviewKeyAction,
  samePayee,
} from "../data/reviewInbox";
import type { MoneyStore } from "../useMoneyStore";
import { CategoryPickerSheet } from "./CategoryPicker";
import { Button, EmojiTile, SegmentedControl, useTopSheet } from "./Primitives";
import s from "./Review.module.css";
import { SwipeToExclude } from "./TransactionActions";
import { TransactionEditor } from "./Transactions";

type ReviewProps = {
  active: boolean;
  store: MoneyStore;
  reviewCount: number;
  onFilter: (patch: Partial<ActivityFilters>) => void;
  onClose: () => void;
};
type Queue = {
  rows: Transaction[];
  total: number;
  hasMore: boolean;
  pages: number;
  fetchedAt: number;
};

const reviewFilters = () => ({
  ...emptyFilters(),
  review: "unreviewed" as const,
  sort: "review" as const,
});
// The queue survives closing Review, so reopening it is instant.
let cachedQueue: Queue | null = null;
let nextGroup = 1;

async function fetchQueue(pages: number, signal?: AbortSignal) {
  const fetchedAt = Date.now();
  const results = await Promise.all(
    Array.from({ length: pages }, (_, index) =>
      request<ActivityPage>(activityQuery(reviewFilters(), "", index + 1), {
        signal,
      }),
    ),
  );
  const rows = new Map<string, Transaction>();
  for (const result of results)
    for (const row of result.transactions) rows.set(row.id, row);
  cachedQueue = {
    rows: [...rows.values()],
    total: results[0].total,
    hasMore: results[results.length - 1].hasMore,
    pages,
    fetchedAt,
  };
  return cachedQueue;
}

// Loaded in the background after start-up so the first open has no wait.
export function prefetchReviewQueue() {
  if (!cachedQueue) fetchQueue(1).catch(() => {});
}

export function ReviewView(props: ReviewProps) {
  return props.active ? <ReviewSession {...props} /> : null;
}

function ReviewSession({ store, reviewCount, onFilter, onClose }: ReviewProps) {
  const [queue, setQueue] = useState<Queue | null>(cachedQueue);
  const [pages, setPages] = useState(cachedQueue?.pages ?? 1);
  const [loading, setLoading] = useState(!cachedQueue);
  const [error, setError] = useState("");
  const [retry, setRetry] = useState(0);
  const [focusId, setFocusId] = useState<string | null>(null);
  const [picker, setPicker] = useState<{ refund: boolean } | null>(null);
  const [details, setDetails] = useState(false);
  const [applySimilar, setApplySimilar] = useState(false);
  const started = useRef(Date.now());
  const lastAction = useRef(Date.now());
  const seen = useRef(new Set<string>());
  const previousOrder = useRef<string[]>([]);
  // Rows this screen just acted on; Undo (or a refused save) brings them back.
  const acted = useRef<string[]>([]);
  const topSheet = useTopSheet();
  useEffect(() => {
    void store.version;
    void retry;
    const abort = new AbortController();
    setLoading(true);
    setError("");
    fetchQueue(pages, abort.signal)
      .then((result) => {
        setQueue(result);
        setLoading(false);
      })
      .catch((cause) => {
        if (!abort.signal.aborted) {
          setError(
            cause instanceof Error
              ? cause.message
              : "Could not load review queue",
          );
          setLoading(false);
        }
      });
    return () => abort.abort();
  }, [store.version, retry, pages]);

  const rows = queue ? store.resolve(queue.rows, queue.fetchedAt) : [];
  for (const row of queue?.rows ?? [])
    if (!row.reviewed) seen.current.add(row.id);
  const { ready, order } = inboxOrder(rows);
  const ids = order.map((row) => row.id);
  const focusedId = nextFocus(ids, previousOrder.current, focusId);
  const focused = order.find((row) => row.id === focusedId) ?? null;
  useLayoutEffect(() => {
    const restored = ids.find(
      (id) => acted.current.includes(id) && !previousOrder.current.includes(id),
    );
    if (restored) {
      acted.current = acted.current.filter((id) => id !== restored);
      setFocusId(restored);
    } else if (focusedId !== focusId) setFocusId(focusedId);
    previousOrder.current = ids;
  });
  useEffect(() => {
    void focusedId;
    setDetails(false);
    setApplySimilar(false);
  }, [focusedId]);
  const done = [...seen.current].filter(
    (id) => !rows.find((row) => row.id === id && !row.reviewed),
  ).length;
  const left = queue?.hasMore ? reviewCount : order.length;
  const confidentRows = ready.filter((row) =>
    confidentTransactionIds([row]).includes(row.id),
  );
  const similar = focused ? samePayee(focused, rows) : [];
  const suggestions = focused
    ? categorySuggestions(focused, [...rows, ...store.transactions])
    : [];

  function act(patch: TransactionPatch, row = focused, group?: number) {
    if (!row) return;
    lastAction.current = Date.now();
    acted.current = [row.id, ...acted.current].slice(0, 20);
    store.updateTransaction(row, patch, group);
  }
  // Confirming or categorizing the focused row can carry its category to the
  // same payee's other rows ("Also apply to N more").
  function decide(patch: TransactionPatch) {
    if (!focused) return;
    const category = patch.category ?? focused.category;
    const others =
      applySimilar && focused.kind === "expense" && category
        ? samePayee(focused, rows)
        : [];
    const group = others.length ? nextGroup++ : undefined;
    for (const other of others)
      act(
        { category, subcategory: patch.subcategory ?? focused.subcategory },
        other,
        group,
      );
    // The focused row goes last so the toast names it.
    act(patch, focused, group);
  }
  function confirm(row = focused) {
    if (!row || (row.kind === "expense" && needsCategory(row))) return;
    if (row === focused) decide({ reviewed: true });
    else act({ reviewed: true }, row);
  }
  function choose(choice: CategorySuggestion) {
    if (!focused) return;
    if (choice.current) return confirm();
    rememberCategory(choice.category, choice.subcategory);
    decide({ category: choice.category, subcategory: choice.subcategory });
  }
  function move(step: number) {
    if (!ids.length) return;
    const index = Math.max(0, ids.indexOf(focusedId ?? ""));
    setFocusId(ids[(index + step + ids.length) % ids.length]);
  }

  // Desktop shortcuts, ignored while typing or when a sheet is open.
  const keys = useRef({ confirm, choose, move, act, onClose, suggestions });
  keys.current = { confirm, choose, move, act, onClose, suggestions };
  useEffect(() => {
    if (topSheet) return;
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target?.closest("input, textarea, select, [contenteditable='true']"))
        return;
      const action = reviewKeyAction(event);
      if (!action) return;
      // Enter on a focused control activates that control instead.
      if (
        action === "confirm" &&
        event.key === "Enter" &&
        target?.closest("button, a")
      )
        return;
      event.preventDefault();
      const handlers = keys.current;
      if (action === "next") handlers.move(1);
      else if (action === "previous") handlers.move(-1);
      else if (action === "confirm") handlers.confirm();
      else if (action === "pick") setPicker({ refund: false });
      else if (action === "exclude") handlers.act({ excluded: true });
      else if (action === "close") handlers.onClose();
      else {
        const choice = handlers.suggestions[action.choose];
        if (choice) handlers.choose(choice);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [topSheet]);

  const finished = !!queue && !loading && !error && left === 0;
  return (
    <section className={s.screen} aria-label="Review transactions">
      <header className={s.header}>
        <div>
          <h1>Review</h1>
          <p aria-live="polite">
            {left} left{done > 0 ? ` · ${done} done` : ""}
          </p>
        </div>
        <button
          type="button"
          className={s.close}
          aria-label="Close review"
          onClick={onClose}
        >
          <X size={22} aria-hidden="true" />
        </button>
      </header>
      <div
        className={s.progress}
        role="progressbar"
        tabIndex={0}
        aria-label="Review progress"
        aria-valuemin={0}
        aria-valuemax={done + left || 1}
        aria-valuenow={done + left ? done : 1}
      >
        <span
          style={{
            width: `${done + left ? (done / (done + left)) * 100 : 100}%`,
          }}
        />
      </div>
      {!queue && loading && (
        <output className={s.placeholder} aria-label="Loading review queue">
          <span />
          <span />
          <span />
        </output>
      )}
      {error && (
        <div className={s.error} role="alert">
          <p>{error}</p>
          <Button
            variant="secondary"
            onClick={() => setRetry((value) => value + 1)}
          >
            Retry
          </Button>
        </div>
      )}
      {focused && (
        <ReviewCard
          key={focused.id}
          transaction={focused}
          suggestions={suggestions}
          similar={similar.length}
          applySimilar={applySimilar}
          onApplySimilar={setApplySimilar}
          details={details}
          onDetails={() => setDetails((value) => !value)}
          onChoose={choose}
          onConfirm={() => confirm()}
          onPick={(refund) => setPicker({ refund })}
          onChange={(patch) => act(patch)}
          onFilter={onFilter}
        />
      )}
      {focused && picker && (
        <CategoryPickerSheet
          open
          onClose={() => setPicker(null)}
          category={focused.category}
          subcategory={focused.subcategory}
          allowUncategorized={false}
          onChange={(patch) =>
            decide(picker.refund ? { ...patch, flow: "refund" } : patch)
          }
        />
      )}
      {order.length > 1 && (
        <section aria-labelledby="review-next">
          <div className={s.sectionHeading}>
            <h2 id="review-next">Up next · {order.length - 1}</h2>
            {confidentRows.length > 1 && (
              <Button
                size="sm"
                variant="secondary"
                onClick={() => {
                  lastAction.current = Date.now();
                  store.confirmTransactions(confidentRows);
                }}
              >
                Confirm {confidentRows.length} confident
              </Button>
            )}
          </div>
          <div className={s.card}>
            {order
              .filter((row) => row.id !== focusedId)
              .map((row) => (
                <QueueRow
                  key={row.id}
                  transaction={row}
                  onFocus={() => {
                    setFocusId(row.id);
                    window.scrollTo({ top: 0, behavior: "smooth" });
                  }}
                  onConfirm={() => confirm(row)}
                  onChange={(patch) => act(patch, row)}
                />
              ))}
          </div>
        </section>
      )}
      {queue?.hasMore && (
        <Button
          className={s.more}
          variant="secondary"
          disabled={loading}
          onClick={() => setPages((value) => value + 1)}
        >
          {loading ? "Loading…" : "Load more"}
        </Button>
      )}
      {focused && (
        <p className={s.keys}>
          <kbd>J</kbd> <kbd>K</kbd> move · <kbd>↵</kbd> confirm · <kbd>1</kbd>–
          <kbd>3</kbd> category · <kbd>E</kbd> more · <kbd>X</kbd> exclude ·{" "}
          <kbd>⌘Z</kbd> undo
        </p>
      )}
      {finished && (
        <div className={s.empty} data-celebrate={done > 0 || undefined}>
          <span className={s.doneBadge} aria-hidden="true">
            <Check size={30} strokeWidth={2.6} />
          </span>
          <h2>All caught up</h2>
          <p>
            {done > 0
              ? `${done} reviewed in ${formatElapsed(lastAction.current - started.current)}`
              : "New transactions will show up here"}
          </p>
          <Button onClick={onClose}>Done</Button>
        </div>
      )}
    </section>
  );
}

function ReviewCard({
  transaction: t,
  suggestions,
  similar,
  applySimilar,
  onApplySimilar,
  details,
  onDetails,
  onChoose,
  onConfirm,
  onPick,
  onChange,
  onFilter,
}: {
  transaction: Transaction;
  suggestions: CategorySuggestion[];
  similar: number;
  applySimilar: boolean;
  onApplySimilar: (value: boolean) => void;
  details: boolean;
  onDetails: () => void;
  onChoose: (choice: CategorySuggestion) => void;
  onConfirm: () => void;
  onPick: (refund: boolean) => void;
  onChange: (patch: TransactionPatch) => void;
  onFilter: (patch: Partial<ActivityFilters>) => void;
}) {
  const { title, detail } = displayName(t.name);
  const appearance = transactionAppearance(t);
  const uncategorized = needsCategory(t);
  const inflow = isCashFlowTransaction(t) && t.amountCents > 0;
  const editorId = useId();
  return (
    <article className={s.focus} aria-label={`Reviewing ${title}`}>
      <SwipeToExclude
        transaction={t}
        disabled={details}
        onChange={onChange}
        onConfirm={uncategorized ? undefined : onConfirm}
      >
        <div className={s.focusHead} data-swipe-handle>
          <EmojiTile {...appearance} size={56} />
          <div className={s.description}>
            <span className={s.focusTitle}>{title}</span>
            <span className={s.subtitle}>
              {shortDate(t.date)} · {accountNickname(t.account)}
              {t.pending ? " · Pending" : ""}
            </span>
            {detail && <span className={s.detail}>{detail}</span>}
          </div>
          <strong className={s.focusAmount} data-positive={inflow}>
            {signedMoney(t.amountCents)}
          </strong>
        </div>
      </SwipeToExclude>
      {t.kind !== "investment" && (
        <SegmentedControl
          size="sm"
          label={`Type of ${title}`}
          value={transactionType(t)}
          options={transactionTypeOptions(t)}
          onChange={(type) => {
            if (type === "refund" && t.kind === "income") onPick(true);
            else onChange(transactionTypePatch(t, type));
          }}
        />
      )}
      {t.kind === "expense" && (
        <div className={s.suggestions}>
          <div className={s.chips}>
            {suggestions.map((choice, index) => {
              const look = categoryAppearance(
                choiceGroupName(choice),
                choice.subcategory,
              );
              return (
                <button
                  key={choice.key}
                  type="button"
                  className={s.choice}
                  data-current={choice.current}
                  aria-label={`${choice.current ? "Confirm" : "Change to"} ${choice.subcategory}`}
                  aria-keyshortcuts={String(index + 1)}
                  onClick={() => onChoose(choice)}
                >
                  <span aria-hidden="true">{look.emoji}</span>
                  {choice.subcategory}
                </button>
              );
            })}
            <button
              type="button"
              className={s.choice}
              data-more
              aria-haspopup="dialog"
              aria-keyshortcuts="E"
              onClick={() => onPick(false)}
            >
              {uncategorized ? "Choose category" : "More…"}
            </button>
          </div>
          <p className={s.source}>{suggestionLabel(t.categorization)}</p>
        </div>
      )}
      {similar > 0 && (
        <label className={s.similar}>
          <input
            type="checkbox"
            checked={applySimilar}
            onChange={(event) => onApplySimilar(event.target.checked)}
          />
          Also apply to {similar} more from {title}
        </label>
      )}
      <Button
        className={s.confirmButton}
        disabled={uncategorized}
        aria-keyshortcuts="Enter"
        onClick={onConfirm}
      >
        <Check size={18} aria-hidden="true" />
        {uncategorized ? "Choose a category first" : "Confirm"}
      </Button>
      <div className={s.secondary}>
        <Button
          variant="ghost"
          size="sm"
          aria-keyshortcuts="X"
          onClick={() => onChange({ excluded: true })}
        >
          <EyeOff size={16} aria-hidden="true" />
          Exclude
        </Button>
        <Button
          variant="ghost"
          size="sm"
          aria-expanded={details}
          aria-controls={editorId}
          onClick={onDetails}
        >
          {details ? "Hide details" : "Details & rules"}
        </Button>
      </div>
      <div id={editorId} hidden={!details}>
        {details && (
          <TransactionEditor
            transaction={t}
            onChange={onChange}
            onFilter={onFilter}
            onClose={onDetails}
          />
        )}
      </div>
    </article>
  );
}

function choiceGroupName(choice: CategorySuggestion) {
  return (
    categories.find((group) => group.id === choice.category)?.name ??
    choice.subcategory
  );
}

function QueueRow({
  transaction: t,
  onFocus,
  onConfirm,
  onChange,
}: {
  transaction: Transaction;
  onFocus: () => void;
  onConfirm: () => void;
  onChange: (patch: TransactionPatch) => void;
}) {
  const { title } = displayName(t.name);
  const uncategorized = needsCategory(t);
  const detail =
    t.kind === "expense"
      ? uncategorized
        ? "Needs a category"
        : t.subcategory
      : isRefund(t)
        ? "Refund"
        : "Income";
  return (
    <div className={s.queueRow}>
      <SwipeToExclude
        transaction={t}
        disabled={false}
        onChange={onChange}
        onConfirm={uncategorized ? undefined : onConfirm}
      >
        <button
          type="button"
          className={s.row}
          data-swipe-handle
          onClick={onFocus}
          aria-label={`Review ${title}, ${signedMoney(t.amountCents)}`}
        >
          <EmojiTile
            {...transactionAppearance(t)}
            size={36}
            dot={t.categorization?.confident}
          />
          <span className={s.description}>
            <span className={s.title}>{title}</span>
            <span className={s.subtitle}>
              {detail} · {accountNickname(t.account)} · {shortDate(t.date)}
            </span>
          </span>
          <strong
            className={s.amount}
            data-positive={isCashFlowTransaction(t) && t.amountCents > 0}
          >
            {signedMoney(t.amountCents)}
          </strong>
        </button>
      </SwipeToExclude>
    </div>
  );
}
