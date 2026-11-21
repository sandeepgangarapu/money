export type CategoryId = string;
export type Tab = "flow" | "wealth" | "activity" | "categories";
export const transactionKindLabels = {
  income: "Income",
  expense: "Spending",
  transfer: "Transfer",
  investment: "Investment activity",
};
export type Transaction = {
  id: string;
  name: string;
  date: string;
  amountCents: number;
  kind: keyof typeof transactionKindLabels;
  category: CategoryId | null;
  subcategory: string;
  account: string;
  reviewed: boolean;
  categorization: {
    source:
      | "rule"
      | "history"
      | "copilot_history"
      | "ollama"
      | "provider"
      | "uncategorized";
    confidence: number | null;
    reviewRequired: boolean;
    confident: boolean;
  } | null;
  pending?: boolean;
  excluded?: boolean;
  notes?: string;
  incomeSourceKey?: string | null;
};
export type TransactionPatch = Partial<
  Pick<Transaction, "category" | "subcategory" | "excluded">
> & { reviewed?: true; flow?: "income" | "refund"; transfer?: boolean };

export type Category = {
  id: string;
  name: string;
  icon: "house" | "utensils" | "zap" | "car" | "shopping-bag";
  color: string;
  children: string[];
  childIds: Record<string, string | null>;
};
export type Month = {
  id: string;
  label: string;
  short: string;
  period: string;
  asOf: string;
  // Month spending in cents, when the backend sends it (month picker bars).
  spendingCents?: number;
};
// Loaded before the dashboard mounts; metadata contains no credential or fixtures.
export const categories: Category[] = [];
export const months: Month[] = [];
export const accounts: string[] = [];
export let reportToday = "";
export function configureFinance(data: {
  categories: Category[];
  months: Month[];
  accounts: string[];
  today?: string;
}) {
  categories.splice(0, categories.length, ...data.categories);
  months.splice(0, months.length, ...data.months);
  accounts.splice(0, accounts.length, ...data.accounts);
  reportToday = data.today ?? "";
}
export function monthSummary(transactions: Transaction[], month: string) {
  const rows = transactions.filter(
    (t) =>
      t.date.startsWith(month) &&
      !t.pending &&
      !t.excluded &&
      t.kind !== "transfer",
  );
  const income = rows
    .filter((t) => t.kind === "income")
    .reduce((sum, t) => sum + t.amountCents, 0);
  const spending = -rows
    .filter((t) => t.kind === "expense")
    .reduce((sum, t) => sum + t.amountCents, 0);
  const groups = categories.map((category) => ({
    ...category,
    cents: -rows
      .filter((t) => t.category === category.id && t.kind === "expense")
      .reduce((sum, t) => sum + t.amountCents, 0),
    breakdown: category.children.map((name) => ({
      id: `${category.id}|${name}`,
      name,
      color: category.color,
      cents: -rows
        .filter(
          (t) =>
            t.category === category.id &&
            t.subcategory === name &&
            t.kind === "expense",
        )
        .reduce((sum, t) => sum + t.amountCents, 0),
    })),
  }));
  return { income, spending, savings: income - spending, groups };
}

export const bySpending = (
  a: { cents: number; name: string },
  b: { cents: number; name: string },
) => b.cents - a.cents || a.name.localeCompare(b.name);

export const money = (cents: number, decimals = false) =>
  new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: decimals ? 2 : 0,
    maximumFractionDigits: decimals ? 2 : 0,
  }).format(cents / 100);
export const signedMoney = (cents: number) =>
  `${cents < 0 ? "−" : "+"}${money(Math.abs(cents), true)}`;
export const shortDate = (date: string) =>
  new Date(`${date}T12:00:00`).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
  });
