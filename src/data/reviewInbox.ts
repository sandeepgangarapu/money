import { recentCategoryChoices } from "./categoryChoices";
import { type Transaction, categories } from "./finance";
import { displayName } from "./merchant";
import { reviewSections } from "./review";

export type CategorySuggestion = {
  key: string;
  category: string;
  subcategory: string;
  // The categorizer's (or rule's) current pick for this row.
  current: boolean;
};

const payee = (transaction: Transaction) =>
  displayName(transaction.name).title.toLowerCase();

const known = (category: string | null, subcategory: string) =>
  !!category &&
  category !== "uncategorized" &&
  !!categories
    .find((group) => group.id === category)
    ?.children.includes(subcategory);

// Up to three one-tap categories: the current pick, what this payee was
// confirmed as before, this session's recent picks, then the categories used
// most often (by count, so one large bill does not crowd out everyday ones).
export function categorySuggestions(
  transaction: Transaction,
  pool: Transaction[],
  limit = 3,
): CategorySuggestion[] {
  if (transaction.kind !== "expense") return [];
  const keys: string[] = [];
  const add = (category: string | null, subcategory: string) => {
    const key = `${category}|${subcategory}`;
    if (known(category, subcategory) && !keys.includes(key)) keys.push(key);
  };
  add(transaction.category, transaction.subcategory);
  const name = payee(transaction);
  const history = new Map<string, number>();
  const usage = new Map<string, number>();
  for (const row of pool) {
    if (row.id === transaction.id || row.kind !== "expense") continue;
    const key = `${row.category}|${row.subcategory}`;
    if (row.reviewed && payee(row) === name)
      history.set(key, (history.get(key) ?? 0) + 1);
    usage.set(key, (usage.get(key) ?? 0) + 1);
  }
  const ranked = (counts: Map<string, number>) =>
    [...counts]
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .map(([key]) => key.split("|") as [string, string]);
  for (const [category, subcategory] of ranked(history))
    add(category, subcategory);
  for (const choice of recentCategoryChoices(categories, {
    selected: "",
    allowUncategorized: false,
  }))
    add(choice.category, choice.subcategory);
  for (const [category, subcategory] of ranked(usage))
    add(category, subcategory);
  return keys.slice(0, limit).map((key) => {
    const [category, subcategory] = key.split("|");
    return {
      key,
      category,
      subcategory,
      current:
        category === transaction.category &&
        subcategory === transaction.subcategory,
    };
  });
}

// Confident suggestions first (quick confirms), then the rows that need a call.
export function inboxOrder(rows: Transaction[]) {
  const { ready, needsCall } = reviewSections(rows);
  return { ready, needsCall, order: [...ready, ...needsCall] };
}

// When the focused row leaves the queue, focus the row that followed it.
export function nextFocus(
  order: string[],
  previousOrder: string[],
  focused: string | null,
): string | null {
  if (focused && order.includes(focused)) return focused;
  if (focused) {
    const start = previousOrder.indexOf(focused);
    if (start >= 0) {
      for (const id of previousOrder.slice(start + 1))
        if (order.includes(id)) return id;
      for (const id of previousOrder.slice(0, start).reverse())
        if (order.includes(id)) return id;
    }
  }
  return order[0] ?? null;
}

// Other unreviewed spending from the same payee, for "Also apply to N more".
export function samePayee(transaction: Transaction, rows: Transaction[]) {
  if (transaction.kind !== "expense") return [];
  const name = payee(transaction);
  return rows.filter(
    (row) =>
      row.id !== transaction.id &&
      row.kind === "expense" &&
      !row.reviewed &&
      Math.sign(row.amountCents) === Math.sign(transaction.amountCents) &&
      payee(row) === name,
  );
}

export type ReviewKey =
  | "next"
  | "previous"
  | "confirm"
  | "pick"
  | "exclude"
  | "close"
  | { choose: number };

export function reviewKeyAction(event: {
  key: string;
  metaKey: boolean;
  ctrlKey: boolean;
  altKey: boolean;
}): ReviewKey | null {
  if (event.metaKey || event.ctrlKey || event.altKey) return null;
  switch (event.key) {
    case "j":
    case "ArrowDown":
      return "next";
    case "k":
    case "ArrowUp":
      return "previous";
    case "Enter":
    case "y":
      return "confirm";
    case "e":
    case "c":
      return "pick";
    case "x":
      return "exclude";
    case "Escape":
      return "close";
    case "1":
    case "2":
    case "3":
      return { choose: Number(event.key) - 1 };
    default:
      return null;
  }
}

export function formatElapsed(ms: number) {
  const seconds = Math.max(1, Math.round(ms / 1000));
  if (seconds < 90) return `${seconds} s`;
  return `${Math.round(seconds / 60)} min`;
}
