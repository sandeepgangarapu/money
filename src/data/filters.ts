import { accountNickname } from "./accounts";
import {
  type Transaction,
  categories,
  reportToday,
  transactionKindLabels,
} from "./finance";

export type ActivityFilters = {
  cashFlowPeriod: string;
  incomeSource: string;
  months: string[];
  date: string;
  categoryGroups: string[];
  categories: string[];
  accounts: string[];
  kinds: Transaction["kind"][];
  statuses: string[];
  review: "all" | "reviewed" | "unreviewed";
  visibility: "all" | "included" | "excluded";
  minAmount: string;
  maxAmount: string;
  sort: "newest" | "oldest" | "largest" | "smallest" | "review";
};
export const emptyFilters = (): ActivityFilters => ({
  cashFlowPeriod: "",
  incomeSource: "",
  months: [],
  date: "",
  categoryGroups: [],
  categories: [],
  accounts: [],
  kinds: [],
  statuses: [],
  review: "all",
  visibility: "all",
  minAmount: "",
  maxAmount: "",
  sort: "newest",
});

export function cashFlowPeriodDates(period: string) {
  const year = Number(period.slice(0, 4));
  const month = period.length === 4 ? 12 : Number(period.slice(5, 7));
  const last = new Date(Date.UTC(year, month, 0)).toISOString().slice(0, 10);
  return {
    start: period.length === 4 ? `${period}-01-01` : `${period}-01`,
    end: reportToday && reportToday < last ? reportToday : last,
  };
}

export function normalizeIncomeFilters(
  filters: ActivityFilters,
): ActivityFilters {
  if (filters.kinds.length !== 1 || filters.kinds[0] !== "income")
    return { ...filters, cashFlowPeriod: "", incomeSource: "" };
  if (!filters.cashFlowPeriod) return { ...filters, incomeSource: "" };
  return filters;
}
export const categoryKey = (transaction: Transaction) =>
  `${transaction.category ?? transaction.kind}|${transaction.subcategory}`;
export function filterTransactions(
  transactions: Transaction[],
  filters: ActivityFilters,
  search = "",
) {
  const needle = search.trim().toLowerCase();
  const report = filters.cashFlowPeriod
    ? cashFlowPeriodDates(filters.cashFlowPeriod)
    : null;
  const result = transactions.filter((t) => {
    const category = categories.find((c) => c.id === t.category);
    const amount = Math.abs(t.amountCents);
    return (
      (!report ||
        (t.kind === "income" &&
          !t.excluded &&
          !t.pending &&
          t.date >= report.start &&
          t.date <= report.end)) &&
      (!filters.incomeSource || t.incomeSourceKey === filters.incomeSource) &&
      (!filters.months.length || filters.months.includes(t.date.slice(0, 7))) &&
      (!filters.date || filters.date === t.date) &&
      (!filters.categoryGroups.length ||
        filters.categoryGroups.includes(t.category ?? t.kind)) &&
      (!filters.categories.length ||
        filters.categories.includes(categoryKey(t))) &&
      (!filters.accounts.length || filters.accounts.includes(t.account)) &&
      (!filters.kinds.length || filters.kinds.includes(t.kind)) &&
      (!filters.statuses.length ||
        filters.statuses.includes(t.pending ? "pending" : "posted")) &&
      (filters.review === "all" ||
        (filters.review === "reviewed"
          ? t.reviewed
          : !t.reviewed && (t.kind === "income" || t.kind === "expense"))) &&
      (filters.visibility === "all" ||
        (filters.visibility === "excluded" ? !!t.excluded : !t.excluded)) &&
      (!filters.minAmount ||
        amount >= Math.round(Number(filters.minAmount) * 100)) &&
      (!filters.maxAmount ||
        amount <= Math.round(Number(filters.maxAmount) * 100)) &&
      (!needle ||
        `${t.name} ${category?.name ?? ""} ${t.subcategory} ${t.date} ${t.account} ${t.notes ?? ""}`
          .toLowerCase()
          .includes(needle))
    );
  });
  return result.sort((a, b) => {
    if (filters.sort === "review") {
      const priority = (t: Transaction) =>
        t.categorization?.reviewRequired
          ? 0
          : !t.category || t.category === "uncategorized"
            ? 1
            : 2;
      return (
        priority(a) - priority(b) ||
        (a.categorization?.confidence ?? -1) -
          (b.categorization?.confidence ?? -1) ||
        b.date.localeCompare(a.date) ||
        a.id.localeCompare(b.id)
      );
    }
    if (filters.sort === "largest")
      return (
        Math.abs(b.amountCents) - Math.abs(a.amountCents) ||
        b.date.localeCompare(a.date)
      );
    if (filters.sort === "smallest")
      return (
        Math.abs(a.amountCents) - Math.abs(b.amountCents) ||
        b.date.localeCompare(a.date)
      );
    return (
      (filters.sort === "oldest"
        ? a.date.localeCompare(b.date)
        : b.date.localeCompare(a.date)) || a.id.localeCompare(b.id)
    );
  });
}
export function activeFilters(
  filters: ActivityFilters,
): { key: keyof ActivityFilters; label: string }[] {
  const result: { key: keyof ActivityFilters; label: string }[] = [];
  if (filters.cashFlowPeriod) {
    const dates = cashFlowPeriodDates(filters.cashFlowPeriod);
    const format = (date: string) =>
      new Date(`${date}T12:00:00`).toLocaleDateString("en-US", {
        month: "short",
        day: "numeric",
        year: "numeric",
      });
    result.push({
      key: "cashFlowPeriod",
      label: `Cash flow · ${format(dates.start)}–${format(dates.end)}`,
    });
  }
  if (filters.incomeSource)
    result.push({
      key: "incomeSource",
      label: filters.incomeSource.slice("name:".length) || "Unknown source",
    });
  if (filters.date)
    result.push({
      key: "date",
      label: new Date(`${filters.date}T12:00:00`).toLocaleDateString("en-US", {
        month: "short",
        day: "numeric",
        year: "numeric",
      }),
    });
  if (filters.categoryGroups.length)
    result.push({
      key: "categoryGroups",
      label:
        filters.categoryGroups.length === 1
          ? (categories.find((c) => c.id === filters.categoryGroups[0])?.name ??
            filters.categoryGroups[0])
          : `${filters.categoryGroups.length} categories`,
    });
  if (filters.months.length)
    result.push({
      key: "months",
      label:
        filters.months.length === 1
          ? new Date(`${filters.months[0]}-01T12:00:00`).toLocaleDateString(
              "en-US",
              { month: "short", year: "numeric" },
            )
          : `${filters.months.length} months`,
    });
  if (filters.categories.length)
    result.push({
      key: "categories",
      label:
        filters.categories.length === 1
          ? filters.categories[0].split("|")[1]
          : `${filters.categories.length} subcategories`,
    });
  if (filters.accounts.length)
    result.push({
      key: "accounts",
      label:
        filters.accounts.length === 1
          ? accountNickname(filters.accounts[0])
          : `${filters.accounts.length} accounts`,
    });
  if (filters.kinds.length)
    result.push({
      key: "kinds",
      label: filters.kinds.map((k) => transactionKindLabels[k]).join(", "),
    });
  if (filters.statuses.length)
    result.push({ key: "statuses", label: filters.statuses.join(", ") });
  if (filters.review !== "all")
    result.push({
      key: "review",
      label: filters.review === "unreviewed" ? "Needs review" : "Reviewed",
    });
  if (filters.visibility !== "all")
    result.push({
      key: "visibility",
      label: filters.visibility === "excluded" ? "Excluded" : "Included",
    });
  if (filters.minAmount || filters.maxAmount)
    result.push({
      key: "minAmount",
      label: `$${filters.minAmount || "0"}–${filters.maxAmount ? `$${filters.maxAmount}` : "any"}`,
    });
  return result;
}

export function reviewFilters(
  filters: ActivityFilters,
  review: ActivityFilters["review"],
): ActivityFilters {
  return {
    ...filters,
    review,
    sort:
      review === "unreviewed" && filters.sort === "newest"
        ? "review"
        : review !== "unreviewed" && filters.sort === "review"
          ? "newest"
          : filters.sort,
  };
}

// Label shortcuts replace the current scope; the review queue starts least certain first.
export function shortcutFilters(
  patch: Partial<ActivityFilters>,
): ActivityFilters {
  return reviewFilters(
    { ...emptyFilters(), ...patch, sort: "newest" },
    patch.review ?? "all",
  );
}

export function groupsByDay(filters: ActivityFilters) {
  return (
    filters.review !== "unreviewed" &&
    (filters.sort === "newest" || filters.sort === "oldest")
  );
}

export function groupTransactionsByDay(transactions: Transaction[]) {
  const groups = new Map<string, Transaction[]>();
  for (const transaction of transactions) {
    const group = groups.get(transaction.date) ?? [];
    group.push(transaction);
    groups.set(transaction.date, group);
  }
  return Array.from(groups, ([date, rows]) => ({ date, transactions: rows }));
}

export function activityDayLabel(date: string, today = new Date()) {
  const day = new Date(`${date}T12:00:00`);
  const localDate = (value: Date) =>
    `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, "0")}-${String(value.getDate()).padStart(2, "0")}`;
  if (date === localDate(today)) return "Today";
  const yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1);
  if (date === localDate(yesterday)) return "Yesterday";
  return day.toLocaleDateString("en-US", {
    ...(day.getFullYear() === today.getFullYear()
      ? { weekday: "long" as const }
      : { year: "numeric" as const }),
    month: "short",
    day: "numeric",
  });
}
