import { categories } from "./finance";
import type { Transaction, TransactionPatch } from "./finance";

// Edits apply on screen at once and reach the server after a short undo window.
// The server cannot mark a row unreviewed, so holding the write is the only way
// an Undo can restore the queue exactly.
export const UNDO_WINDOW_MS = 4000;

export type EditRequest = {
  ids: string[];
  // A single-transaction PATCH; confirm batches have no patch.
  patch?: TransactionPatch;
  label: string;
  // Edits made by one action (e.g. "Also apply to N more") undo together.
  group?: number;
};
type Timers = {
  set: (callback: () => void, ms: number) => unknown;
  clear: (handle: unknown) => void;
};
export type KeyedEdit = EditRequest & { key: number };
type Entry = KeyedEdit & { timer: unknown };

export class PendingEdits {
  private entries = new Map<number, Entry>();
  private nextKey = 1;
  private chain: Promise<void> = Promise.resolve();
  private inFlight = 0;
  private readonly timers: Timers;

  constructor(
    private readonly options: {
      delay?: number;
      commit: (edit: KeyedEdit, keepalive: boolean) => Promise<void>;
      onChange: () => void;
      timers?: Timers;
    },
  ) {
    this.timers = options.timers ?? {
      set: (callback, ms) => setTimeout(callback, ms),
      clear: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
    };
  }

  // Returns the entry key. A second change to the same row merges into its
  // pending PATCH so Undo restores the row as it was before either change.
  add(request: EditRequest): number {
    const single = request.patch && request.ids.length === 1;
    if (single) {
      const existing = [...this.entries.values()].find(
        (entry) => entry.patch && entry.ids[0] === request.ids[0],
      );
      if (existing) {
        this.timers.clear(existing.timer);
        this.entries.delete(existing.key);
        const merged: Entry = {
          ...existing,
          patch: { ...existing.patch, ...request.patch },
          label: request.label,
          timer: null,
        };
        this.entries.set(existing.key, merged);
        this.arm(merged);
        this.options.onChange();
        return existing.key;
      }
    } else {
      // A batch confirm must reach the server after any pending category change.
      for (const entry of [...this.entries.values()])
        if (entry.patch && request.ids.includes(entry.ids[0]))
          this.flush(entry.key);
    }
    const entry: Entry = { ...request, key: this.nextKey++, timer: null };
    this.entries.set(entry.key, entry);
    this.arm(entry);
    this.options.onChange();
    return entry.key;
  }

  // Cancels the most recent pending action (every edit in its group) before
  // anything is sent.
  undo(): KeyedEdit[] {
    const last = [...this.entries.values()].at(-1);
    if (!last) return [];
    const undone = [...this.entries.values()].filter(
      (entry) =>
        entry.key === last.key ||
        (last.group !== undefined && entry.group === last.group),
    );
    for (const entry of undone) {
      this.timers.clear(entry.timer);
      this.entries.delete(entry.key);
    }
    this.options.onChange();
    return undone.map(({ timer: _, ...edit }) => edit);
  }

  flush(key: number, keepalive = false) {
    const entry = this.entries.get(key);
    if (!entry) return;
    this.timers.clear(entry.timer);
    this.entries.delete(key);
    this.inFlight++;
    const edit = {
      key,
      ids: entry.ids,
      patch: entry.patch,
      label: entry.label,
    };
    // Reporting failures is the commit's job; the queue only keeps going.
    const run = () =>
      this.options
        .commit(edit, keepalive)
        .catch(() => {})
        .finally(() => {
          this.inFlight--;
          this.options.onChange();
        });
    // A closing page cannot wait for earlier writes; keepalive sends at once.
    if (keepalive) void run();
    else this.chain = this.chain.then(run, run);
    this.options.onChange();
  }

  flushAll(keepalive = false) {
    for (const key of [...this.entries.keys()]) this.flush(key, keepalive);
  }

  latest(): { key: number; label: string; count: number } | null {
    const entries = [...this.entries.values()];
    const last = entries.at(-1);
    if (!last) return null;
    const group = entries.filter(
      (entry) =>
        entry.key === last.key ||
        (last.group !== undefined && entry.group === last.group),
    );
    const count = group.reduce((sum, entry) => sum + entry.ids.length, 0);
    return {
      key: last.key,
      label:
        group.length > 1 ? `${last.label} · ${count} transactions` : last.label,
      count,
    };
  }

  pendingIds(): Set<string> {
    return new Set([...this.entries.values()].flatMap((entry) => entry.ids));
  }

  // Edits not yet acknowledged by the server, whether waiting or sending.
  get busy() {
    return this.entries.size + this.inFlight;
  }

  private arm(entry: Entry) {
    entry.timer = this.timers.set(
      () => this.flush(entry.key),
      this.options.delay ?? UNDO_WINDOW_MS,
    );
  }
}

export function editLabel(transaction: Transaction, patch: TransactionPatch) {
  if (patch.excluded === true) return "Excluded from cash flow";
  if (patch.excluded === false) return "Included in cash flow";
  if (patch.transfer) return "Marked as transfer";
  if (patch.flow === "income") return "Marked as income";
  if (patch.category !== undefined) {
    const group = categories.find((item) => item.id === patch.category);
    const name =
      patch.subcategory && patch.subcategory !== group?.name
        ? patch.subcategory
        : (group?.name ?? patch.subcategory ?? "category");
    return patch.flow === "refund" ? `Refund · ${name}` : `Moved to ${name}`;
  }
  if (patch.flow === "refund") return "Marked as refund";
  if (patch.transfer === false) return "Marked as spending";
  if (patch.reviewed) return `Confirmed ${shortName(transaction.name)}`;
  return "Saved";
}

const shortName = (name: string) => {
  const payee = name.split(" - ")[0].trim() || name;
  return payee.length > 28 ? `${payee.slice(0, 27)}…` : payee;
};

// Saved rows replace fetched rows only until a fetch that started after the
// save completed. Pending (unsent) rows always win.
export type Override = { row: Transaction; at: number };
export function resolveRows(
  rows: Transaction[],
  overrides: Record<string, Override>,
  fetchedAt: number,
): Transaction[] {
  return rows.map((row) => {
    const override = overrides[row.id];
    return override && override.at >= fetchedAt ? override.row : row;
  });
}
