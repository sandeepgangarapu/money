import type {
  ActivityPage,
  CashFlowSummary,
  DailySpending,
  Dashboard,
  IncomeSource,
} from "../data/api";
import {
  type ActivityFilters,
  emptyFilters,
  filterTransactions,
} from "../data/filters";
import {
  type Month,
  type Transaction,
  type TransactionPatch,
  configureFinance,
} from "../data/finance";
import { applyTransactionPatch } from "../data/review";
import type { MoneyRule, RuleDraft } from "../data/rules";
import { type Household, accountNames, createHousehold } from "./household";

// Answers the dashboard API in memory, following the Rails endpoints' rules
// (app/models/family/money_dashboard.rb, money_rules.rb). Nothing is stored:
// reloading the page starts the fictional household over.

export type DemoResponse = { status: number; body?: unknown };
const ok = (body: unknown): DemoResponse => ({ status: 200, body });
const invalid = (message: string): DemoResponse => ({
  status: 422,
  body: { error: "invalid_query", message },
});
const notFound = (message = "Not available in the demo"): DemoResponse => ({
  status: 404,
  body: { error: "not_found", message },
});
const connectionsOff: DemoResponse = {
  status: 403,
  body: {
    error: "demo",
    message: "Connecting accounts is turned off in this demo.",
  },
};

const PAGE_SIZE = 100;
const arrayFilters = [
  "months",
  "categoryGroups",
  "categories",
  "accounts",
  "kinds",
  "statuses",
] as const;
const scalarFilters = [
  "cashFlowPeriod",
  "incomeSource",
  "date",
  "review",
  "visibility",
  "minAmount",
  "maxAmount",
  "sort",
] as const;
const sorts = ["newest", "oldest", "largest", "smallest", "review"];

export function localToday(now = new Date()) {
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
}

const monthName = (id: string, style: "long" | "short") =>
  new Date(`${id}-01T12:00:00`).toLocaleDateString("en-US", { month: style });
const lastDay = (id: string) =>
  new Date(Number(id.slice(0, 4)), Number(id.slice(5, 7)), 0).getDate();

export function createDemoBackend(today = localToday()) {
  const household: Household = createHousehold(today);
  const rows = new Map(household.transactions.map((row) => [row.id, row]));
  let rules = household.rules;
  const { categories } = household;
  const accounts = household.accounts.map((account) => account.name);
  const firstMonth =
    household.transactions[0]?.date.slice(0, 7) ?? today.slice(0, 7);
  const monthIds: string[] = [];
  let cursor = firstMonth;
  while (cursor <= today.slice(0, 7)) {
    monthIds.push(cursor);
    const [year, month] = cursor.split("-").map(Number);
    cursor =
      month === 12
        ? `${year + 1}-01`
        : `${year}-${String(month + 1).padStart(2, "0")}`;
  }
  // Activity filters read the catalog and report date from finance.ts.
  configureFinance({ categories, months: [], accounts, today });

  const all = () => [...rows.values()];
  const copy = <T>(value: T): T => JSON.parse(JSON.stringify(value));

  function serialize(row: Transaction): Transaction {
    return {
      ...row,
      categorization: row.kind === "expense" ? row.categorization : null,
      incomeSourceKey: row.kind === "income" ? `name:${row.name}` : null,
    };
  }

  // Report rows: posted, included, inside the period and not after today.
  function reportRows(period: string) {
    return all().filter(
      (row) =>
        row.date.startsWith(period) &&
        row.date <= today &&
        !row.pending &&
        !row.excluded,
    );
  }

  function principalFor(row: Transaction) {
    const entry = household.principal.get(row.id);
    return entry &&
      row.kind === "expense" &&
      `${row.category}|${row.subcategory}` === entry.path
      ? entry.cents
      : 0;
  }

  function summary(period: string): CashFlowSummary {
    const report = reportRows(period);
    const expenses = report.filter((row) => row.kind === "expense");
    const income = report.filter((row) => row.kind === "income");
    const sourceMap = new Map<string, IncomeSource>();
    for (const row of income) {
      const key = `name:${row.name}`;
      const source = sourceMap.get(key) ?? {
        key,
        label: row.name || "Unknown source",
        cents: 0,
        transactionCount: 0,
      };
      source.cents += row.amountCents;
      source.transactionCount += 1;
      sourceMap.set(key, source);
    }
    const sources = [...sourceMap.values()].sort(
      (a, b) =>
        b.cents - a.cents ||
        a.label.localeCompare(b.label) ||
        a.key.localeCompare(b.key),
    );
    const principalByPath = new Map<string, number>();
    for (const row of expenses) {
      const cents = principalFor(row);
      if (cents) {
        const path = `${row.category}|${row.subcategory}`;
        principalByPath.set(path, (principalByPath.get(path) ?? 0) + cents);
      }
    }
    const groups = categories.map((group) => {
      const breakdown = group.children.map((name) => {
        const id = `${group.id}|${name}`;
        const cents =
          -expenses
            .filter(
              (row) => row.category === group.id && row.subcategory === name,
            )
            .reduce((sum, row) => sum + row.amountCents, 0) -
          (principalByPath.get(id) ?? 0);
        return { id, name, color: group.color, cents };
      });
      return {
        ...group,
        cents: breakdown.reduce((sum, child) => sum + child.cents, 0),
        breakdown,
      };
    });
    const incomeCents = sources.reduce((sum, source) => sum + source.cents, 0);
    const principalCents = [...principalByPath.values()].reduce(
      (sum, cents) => sum + cents,
      0,
    );
    const spending =
      -expenses.reduce((sum, row) => sum + row.amountCents, 0) - principalCents;
    const start = period.length === 4 ? `${period}-01-01` : `${period}-01`;
    const end =
      period.length === 4
        ? `${period}-12-31`
        : `${period}-${String(lastDay(period)).padStart(2, "0")}`;
    return {
      income: incomeCents,
      spending,
      savings: incomeCents - spending,
      groups,
      incomeBreakdown: {
        startDate: start,
        endDate: end < today ? end : today,
        sources,
      },
      principalCents,
      principalBreakdown: [...principalByPath].map(([id, cents]) => ({
        id,
        name: id.split("|")[1],
        cents,
      })),
    };
  }

  function dailySpending(period: string): DailySpending {
    const byDay = new Map<string, number>();
    for (const row of reportRows(period))
      if (row.kind === "expense")
        byDay.set(
          row.date,
          (byDay.get(row.date) ?? 0) - row.amountCents - principalFor(row),
        );
    return [...byDay]
      .filter(([, cents]) => cents !== 0)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([date, cents]) => ({ date, cents }));
  }

  function months(): Month[] {
    const current = today.slice(0, 7);
    return monthIds.map((id) => ({
      id,
      label: `${monthName(id, "long")} ${id.slice(0, 4)}`,
      short: monthName(id, "long"),
      period: `${monthName(id, "short")} 1–${id === current ? Number(today.slice(8, 10)) : lastDay(id)}`,
      asOf: id === current ? "Month to date" : "Full month",
      spendingCents: summary(id).spending,
    }));
  }

  function dashboard(month: string | null): DemoResponse {
    const selected = month ?? today.slice(0, 7);
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(selected))
      return invalid("Month must be YYYY-MM");
    if (selected > today.slice(0, 7))
      return invalid("Month must not be in the future");
    const year = selected.slice(0, 4);
    const wealth = household.accounts;
    const assets = wealth
      .filter((account) => account.classification === "asset")
      .reduce((sum, account) => sum + (account.balanceCents ?? 0), 0);
    const debt = wealth
      .filter((account) => account.classification === "liability")
      .reduce((sum, account) => sum + (account.balanceCents ?? 0), 0);
    const body: Dashboard = {
      month: selected,
      today,
      months: months(),
      spendingByDay: {
        month: dailySpending(selected),
        year: dailySpending(year),
      },
      categories,
      accounts,
      summary: summary(selected),
      yearlySummary: summary(year),
      reviewCount: all().filter(
        (row) =>
          !row.reviewed && (row.kind === "income" || row.kind === "expense"),
      ).length,
      handoffReviewCount: 0,
      stagedPendingCount: 0,
      wealth: {
        assets,
        debt,
        netWorth: assets - debt,
        missingCount: 0,
        observedAt: household.observedAt,
        accounts: wealth,
      },
    };
    return ok(body);
  }

  function activity(params: URLSearchParams): DemoResponse {
    const page = Number(params.get("page") ?? "1");
    if (!Number.isInteger(page) || page < 1 || page > 100_000)
      return invalid("Invalid page");
    const filters: ActivityFilters = emptyFilters();
    const record = filters as unknown as Record<string, unknown>;
    for (const [key, value] of params) {
      const match = /^filters\[(\w+)\](\[\])?$/.exec(key);
      if (!match) continue;
      const [, name, list] = match;
      if (list && (arrayFilters as readonly string[]).includes(name))
        (record[name] as string[]).push(value);
      else if (!list && (scalarFilters as readonly string[]).includes(name))
        record[name] = value;
    }
    if (!sorts.includes(filters.sort)) return invalid("Invalid sort");
    if (
      filters.incomeSource &&
      (!filters.cashFlowPeriod ||
        filters.kinds.join() !== "income" ||
        !filters.incomeSource.startsWith("name:"))
    )
      return invalid(
        "Income source requires an income report period and a valid source key",
      );
    for (const amount of [filters.minAmount, filters.maxAmount])
      if (amount && !(Number(amount) >= 0)) return invalid("Invalid amount");
    const matches = filterTransactions(
      all().map(serialize),
      filters,
      params.get("search") ?? "",
    );
    const body: ActivityPage = {
      transactions: matches.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE),
      total: matches.length,
      page,
      hasMore: page * PAGE_SIZE < matches.length,
    };
    return ok(body);
  }

  function update(
    id: string,
    patch: TransactionPatch | undefined,
  ): DemoResponse {
    const row = rows.get(id);
    if (!row) return notFound("Transaction not found");
    if (!patch || typeof patch !== "object")
      return invalid("Transaction is required");
    if ("reviewed" in patch && patch.reviewed !== true)
      return invalid("Reviewed must be true");
    if ("transfer" in patch) {
      if (typeof patch.transfer !== "boolean")
        return invalid("Transfer must be boolean");
      if (row.kind === "investment")
        return invalid("Investment activity is outside cash flow");
    }
    if (
      "flow" in patch &&
      (!(patch.flow === "income" || patch.flow === "refund") ||
        row.amountCents <= 0 ||
        !(
          row.kind === "income" ||
          row.kind === "expense" ||
          patch.transfer === false
        ))
    )
      return invalid("Flow requires an income or refund inflow");
    if ("excluded" in patch && typeof patch.excluded !== "boolean")
      return invalid("Excluded must be boolean");
    let next = applyTransactionPatch(row, patch);
    if ("category" in patch || "subcategory" in patch) {
      const group = categories.find((item) => item.id === patch.category);
      if (!group || !(String(patch.subcategory) in group.childIds))
        return invalid("Unknown category");
    }
    next = { ...next, reviewed: true };
    rows.set(id, next);
    return ok(serialize(next));
  }

  function confirm(ids: unknown): DemoResponse {
    if (
      !Array.isArray(ids) ||
      ids.length < 1 ||
      ids.length > 100 ||
      !ids.every((id) => typeof id === "string")
    )
      return invalid("IDs must contain 1 to 100 UUIDs");
    if (!ids.every((id) => rows.has(id)))
      return notFound("Transaction not found");
    const confirmed: Transaction[] = [];
    for (const id of new Set(ids as string[])) {
      const row = rows.get(id) as Transaction;
      if (row.kind !== "income" && row.kind !== "expense") continue;
      const next = { ...row, reviewed: true };
      rows.set(id, next);
      confirmed.push(serialize(next));
    }
    return ok({ confirmed: confirmed.length, transactions: confirmed });
  }

  // Rules: the same matching as the Rails preview, over all expense history.
  function categoryFor(categoryId: string) {
    for (const group of categories)
      for (const [name, id] of Object.entries(group.childIds))
        if (id === categoryId) return { group, name };
    return null;
  }
  function validRule(
    draft: Partial<RuleDraft> | undefined,
    base?: MoneyRule,
  ): RuleDraft | string {
    const value = { ...base, ...draft } as Partial<RuleDraft>;
    const pattern = String(value.pattern ?? "").trim();
    if (!pattern) return "Enter text to match";
    if (value.matchType !== "contains" && value.matchType !== "exact")
      return "Choose how to match";
    if (!value.categoryId || !categoryFor(value.categoryId))
      return "Choose a category";
    return {
      matchType: value.matchType,
      pattern,
      categoryId: value.categoryId,
      active: value.active !== false,
    };
  }
  function ruleMatches(rule: RuleDraft) {
    const needle = rule.pattern.toLowerCase();
    return all()
      .filter((row) => row.kind === "expense")
      .filter((row) =>
        rule.matchType === "exact"
          ? row.name.toLowerCase() === needle
          : row.name.toLowerCase().includes(needle),
      )
      .sort((a, b) => b.date.localeCompare(a.date) || a.id.localeCompare(b.id));
  }
  function applyRule(rule: RuleDraft) {
    const target = categoryFor(rule.categoryId);
    if (!target) return 0;
    const matches = ruleMatches(rule);
    for (const row of matches)
      rows.set(row.id, {
        ...row,
        category: target.group.id,
        subcategory: target.name,
        reviewed: true,
        categorization: {
          source: "rule",
          confidence: null,
          reviewRequired: false,
          confident: true,
        },
      });
    return matches.length;
  }
  let ruleCount = 0;
  function rulesRequest(
    method: string,
    parts: string[],
    body: Record<string, unknown> | undefined,
  ): DemoResponse {
    const [id, action] = parts;
    const draft = body?.rule as Partial<RuleDraft> | undefined;
    if (method === "GET" && !id) return ok({ rules });
    if (method === "POST" && id === "preview") {
      const base = rules.find((rule) => rule.id === body?.id);
      const rule = validRule(draft, base);
      if (typeof rule === "string") return invalid(rule);
      const matches = ruleMatches(rule);
      return ok({
        matchCount: matches.length,
        samples: matches.slice(0, 10).map((row) => ({
          id: row.id,
          name: row.name,
          date: row.date,
          amountCents: row.amountCents,
          account: row.account,
          categoryName:
            row.category === "uncategorized" ? null : row.subcategory,
        })),
        previewToken: `demo-${Date.now()}`,
      });
    }
    if (method === "POST" && !id) {
      const rule = validRule(draft);
      if (typeof rule === "string") return invalid(rule);
      ruleCount += 1;
      const saved: MoneyRule = {
        ...rule,
        id: `demo-rule-${ruleCount}`,
        createdAt: new Date().toISOString(),
      };
      rules = [...rules, saved];
      return {
        status: 201,
        body: {
          rule: saved,
          appliedCount: body?.applyExisting ? applyRule(saved) : 0,
        },
      };
    }
    const existing = rules.find((rule) => rule.id === id);
    if (!existing) return notFound("Rule not found");
    if (method === "DELETE") {
      rules = rules.filter((rule) => rule.id !== id);
      return { status: 204 };
    }
    if (method === "PATCH" || (method === "POST" && action === "apply")) {
      const rule = action === "apply" ? existing : validRule(draft, existing);
      if (typeof rule === "string") return invalid(rule);
      const saved: MoneyRule = { ...existing, ...rule };
      rules = rules.map((item) => (item.id === id ? saved : item));
      const apply = action === "apply" || body?.applyExisting === true;
      return ok({ rule: saved, appliedCount: apply ? applyRule(saved) : 0 });
    }
    return notFound();
  }

  function plaid(): DemoResponse {
    const linked = [
      accountNames.checking,
      accountNames.savings,
      accountNames.cashback,
      accountNames.travel,
    ];
    return ok({
      configured: true,
      canConfigure: false,
      environment: "sandbox",
      linkUrl: null,
      expiresAt: null,
      connections: [
        {
          id: "demo-bank",
          name: "Northwind Bank",
          needsUpdate: false,
          accounts: linked.map((name) => {
            const account = household.accounts.find(
              (item) => item.name === name,
            );
            return {
              id: `demo-${account?.id}`,
              name,
              type: account?.type ?? "Depository",
              subtype: null,
              currency: "USD",
              accountId: account?.id ?? null,
              reviewCount: 0,
            };
          }),
        },
      ],
      existingAccounts: household.accounts.map(({ id, name, type }) => ({
        id,
        name,
        type,
        currency: "USD",
      })),
    });
  }

  function properties(): DemoResponse {
    const home = household.accounts.find(
      (account) => account.type === "Property",
    );
    return ok({
      canConfigure: false,
      configured: true,
      properties: home
        ? [
            {
              id: home.id,
              connected: true,
              canConnect: false,
              valueCents: home.balanceCents,
            },
          ]
        : [],
    });
  }

  function handle(method: string, path: string, body?: unknown): DemoResponse {
    const url = new URL(path, "https://demo.invalid/");
    const parts = url.pathname.split("/").filter(Boolean);
    const data =
      body && typeof body === "object"
        ? (body as Record<string, unknown>)
        : undefined;
    const verb = method.toUpperCase();
    const [resource, ...rest] = parts;
    let response: DemoResponse;
    if (!resource && verb === "GET")
      response = dashboard(url.searchParams.get("month"));
    else if (resource === "activity" && verb === "GET")
      response = activity(url.searchParams);
    else if (
      resource === "transactions" &&
      rest[0] === "confirm" &&
      verb === "POST"
    )
      response = confirm(data?.ids);
    else if (
      resource === "transactions" &&
      rest.length === 1 &&
      verb === "PATCH"
    )
      response = update(
        rest[0],
        data?.transaction as TransactionPatch | undefined,
      );
    else if (resource === "rules") response = rulesRequest(verb, rest, data);
    else if (resource === "plaid")
      response = verb === "GET" && !rest.length ? plaid() : connectionsOff;
    else if (resource === "properties")
      response = verb === "GET" && !rest.length ? properties() : connectionsOff;
    else response = notFound();
    return response.body === undefined
      ? response
      : { ...response, body: copy(response.body) };
  }

  return { handle, today };
}
