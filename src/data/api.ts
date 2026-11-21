import type { ActivityFilters } from "./filters";
import type { Category, Month, Transaction, monthSummary } from "./finance";
import { send } from "./transport";

export type WealthHolding = {
  id: string;
  securityId: string;
  name: string;
  ticker: string;
  instrumentType: string;
  sourceUrl: string | null;
  quantity: string;
  price: string;
  value: string;
  currency: string;
  valueCents: number | null;
  asOf: string;
};
export type WealthAccount = {
  id: string;
  name: string;
  type: string;
  classification: string;
  balanceCents: number | null;
  asOf: string | null;
  holdings: WealthHolding[];
};
export type CashFlowSummary = ReturnType<typeof monthSummary> & {
  incomeBreakdown: {
    startDate: string;
    endDate: string;
    sources: IncomeSource[];
  };
  principalCents: number;
  principalBreakdown: { id: string; name: string; cents: number }[];
};
export type IncomeSource = {
  key: string;
  label: string;
  cents: number;
  transactionCount: number;
};
// Spending per day (cents), only for days with spending. Optional until the
// backend that sends it is deployed; the trend line hides without it.
export type DailySpending = { date: string; cents: number }[];
export type Dashboard = {
  month: string;
  today: string;
  months: Month[];
  spendingByDay?: { month: DailySpending; year: DailySpending };
  categories: Category[];
  accounts: string[];
  summary: CashFlowSummary;
  yearlySummary: CashFlowSummary;
  reviewCount: number;
  handoffReviewCount: number;
  stagedPendingCount: number;
  wealth: {
    assets: number;
    debt: number;
    netWorth: number;
    missingCount: number;
    observedAt: string | null;
    accounts: WealthAccount[];
  };
};
export type ActivityPage = {
  transactions: Transaction[];
  total: number;
  page: number;
  hasMore: boolean;
};
export type ConfirmationResult = {
  confirmed: number;
  transactions: Transaction[];
};

export async function confirmTransactionBatches(
  ids: string[],
  onBatch: (result: ConfirmationResult) => void,
  keepalive = false,
) {
  let confirmed = 0;
  for (let offset = 0; offset < ids.length; offset += 100) {
    const result = await request<ConfirmationResult>("/transactions/confirm", {
      method: "POST",
      body: JSON.stringify({ ids: ids.slice(offset, offset + 100) }),
      keepalive,
    });
    confirmed += result.confirmed;
    onBatch(result);
  }
  return confirmed;
}
export async function request<T>(
  path: string,
  options: RequestInit = {},
): Promise<T> {
  const response = await send(path, {
    ...options,
    cache: "no-store",
    headers: { "Content-Type": "application/json", ...options.headers },
  });
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new Error(body.message ?? `Request failed (${response.status})`);
  }
  return response.status === 204 ? (undefined as T) : response.json();
}
export function activityQuery(
  filters: ActivityFilters,
  search: string,
  page = 1,
) {
  const query = new URLSearchParams({ page: String(page), search });
  for (const [key, value] of Object.entries(filters)) {
    if (Array.isArray(value))
      for (const item of value) query.append(`filters[${key}][]`, item);
    else if (value) query.set(`filters[${key}]`, value);
  }
  return `/activity?${query}`;
}

// The same Activity query for another page.
export function queryPage(query: string, page: number) {
  const [path, search = ""] = query.split("?");
  const params = new URLSearchParams(search);
  params.set("page", String(page));
  return `${path}?${params}`;
}
