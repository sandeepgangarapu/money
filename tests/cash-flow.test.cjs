const assert = require("node:assert/strict");
const { execFileSync } = require("node:child_process");
const { mkdtempSync, rmSync } = require("node:fs");
const { tmpdir } = require("node:os");
const path = require("node:path");
const { after, test } = require("node:test");

const output = mkdtempSync(path.join(tmpdir(), "money-cash-flow-"));
after(() => rmSync(output, { recursive: true, force: true }));
execFileSync(
  process.execPath,
  [
    path.resolve(__dirname, "../node_modules/typescript/bin/tsc"),
    "--ignoreConfig",
    "--target",
    "es2022",
    "--module",
    "commonjs",
    "--skipLibCheck",
    "--outDir",
    output,
    "src/data/cashFlow.ts",
  ],
  { cwd: path.resolve(__dirname, ".."), stdio: "pipe" },
);
const {
  incomeActivityFilters,
  incomeFlow,
  overviewGroups,
  sankeyGroups,
} = require(path.join(output, "cashFlow.js"));
const {
  activeFilters,
  cashFlowPeriodDates,
  emptyFilters,
  filterTransactions,
  normalizeIncomeFilters,
  shortcutFilters,
} = require(path.join(output, "filters.js"));
const { activityQuery } = require(path.join(output, "api.js"));
const { categoryAppearance, everythingElseAppearance } = require(
  path.join(output, "appearance.js"),
);
const { configureFinance, monthSummary } = require(
  path.join(output, "finance.js"),
);

function group(name, children) {
  return {
    id: name,
    name,
    icon: "house",
    color: "blue",
    children: Object.keys(children),
    childIds: Object.fromEntries(
      Object.keys(children).map((key) => [key, key]),
    ),
    cents: Object.values(children).reduce((sum, value) => sum + value, 0),
    breakdown: Object.entries(children).map(([child, cents]) => ({
      id: `${name}|${child}`,
      name: child,
      color: "blue",
      cents,
    })),
  };
}

test("mortgage and car loan are separate Sankey branches without counting them again in Loans", () => {
  const source = [
    group("Loans", {
      Loans: 0,
      Mortgage: 500000,
      CarLoan: 100000,
      Other: 25000,
    }),
    group("Groceries", { Groceries: 50000 }),
  ];
  const result = sankeyGroups(source);
  const amounts = Object.fromEntries(
    result.map((item) => [item.name, item.cents]),
  );
  assert.deepEqual(amounts, {
    Mortgage: 500000,
    "Car loan": 100000,
    Loans: 25000,
    Groceries: 50000,
  });
  assert.equal(
    result.reduce((sum, item) => sum + item.cents, 0),
    675000,
  );
  assert.equal(new Set(result.map((item) => item.id)).size, result.length);
  assert.equal(source[0].cents, 625000);
});

test("loan refunds remain negative and reduce net spending rather than disappearing", () => {
  const result = sankeyGroups([
    group("Loans", { Mortgage: -5000, CarLoan: 100000 }),
  ]);
  assert.equal(result.find((item) => item.name === "Mortgage").cents, -5000);
  assert.equal(
    result.reduce((sum, item) => sum + item.cents, 0),
    95000,
  );
});

test("standalone loan categories appear once and ordinary categories retain their children", () => {
  const food = group("Food", { Groceries: 10000, Restaurants: 20000 });
  const result = sankeyGroups([group("Mortgage", { Mortgage: 500000 }), food]);
  assert.equal(result.filter((item) => item.name === "Mortgage").length, 1);
  assert.deepEqual(
    result.find((item) => item.name === "Food"),
    {
      ...food,
      color: categoryAppearance("Food").color,
      breakdown: food.breakdown.map((child) => ({
        ...child,
        color: categoryAppearance("Food", child.name).color,
      })),
      activityFilter: { categoryGroups: ["Food"] },
    },
  );
});

test("overview and detailed cash-flow colors agree with category appearances", () => {
  const groups = [
    group("Loans", { Mortgage: 10000, CarLoan: 5000 }),
    group("Utilities", { Utilities: 1000 }),
    group("Shopping", { Amazon: 2000, Clothing: 1000 }),
  ];
  const detailed = sankeyGroups(groups);
  assert.equal(
    detailed.find((item) => item.name === "Mortgage").color,
    categoryAppearance("Loans", "Mortgage").color,
  );
  assert.equal(
    detailed.find((item) => item.name === "Car loan").color,
    categoryAppearance("Loans", "CarLoan").color,
  );
  const shopping = detailed.find((item) => item.name === "Shopping");
  assert.equal(shopping.color, categoryAppearance("Shopping").color);
  assert.equal(
    shopping.breakdown[0].color,
    categoryAppearance("Shopping", "Amazon").color,
  );
  assert.deepEqual(
    overviewGroups(groups).map((item) => item.color),
    [
      categoryAppearance("Loans", "Mortgage").color,
      categoryAppearance("Loans", "CarLoan").color,
      categoryAppearance("Utilities").color,
      everythingElseAppearance.color,
    ],
  );
  assert.equal(groups[0].color, "blue");
});

function transaction(id, category, subcategory, date, kind = "expense") {
  return {
    id,
    category,
    subcategory,
    date,
    kind,
    name: id,
    amountCents: -10000,
    account: "Checking",
    reviewed: true,
  };
}

test("contributions and investment activity stay outside spendable income and spending", () => {
  const rows = [
    {
      ...transaction("Payroll", null, "", "2026-10-09", "income"),
      amountCents: 100000,
    },
    {
      ...transaction("Cash interest", null, "", "2026-10-09", "income"),
      amountCents: 188,
    },
    {
      ...transaction("401k contribution", null, "", "2026-10-09", "transfer"),
      amountCents: 20000,
    },
    {
      ...transaction("Invest savings", null, "", "2026-10-09", "transfer"),
      amountCents: -10000,
    },
    {
      ...transaction("Retained dividend", null, "", "2026-10-09", "investment"),
      amountCents: 3000,
    },
    {
      ...transaction("Reinvestment", null, "", "2026-10-09", "investment"),
      amountCents: -3000,
    },
    { ...transaction("Groceries", null, "", "2026-10-09"), amountCents: -2000 },
  ];
  const result = monthSummary(rows, "2026-10");
  assert.equal(result.income, 100188);
  assert.equal(result.spending, 2000);
  assert.equal(result.savings, 98188);
  const filters = shortcutFilters({ kinds: ["investment"] });
  assert.deepEqual(
    filterTransactions(rows, filters)
      .map((row) => row.id)
      .sort(),
    ["Reinvestment", "Retained dividend"],
  );
  assert.equal(
    activeFilters(filters).find((item) => item.key === "kinds").label,
    "Investment activity",
  );
  assert.equal(
    new URLSearchParams(activityQuery(filters, "").split("?")[1]).get(
      "filters[kinds][]",
    ),
    "investment",
  );
  const income = filterTransactions(rows, {
    ...emptyFilters(),
    ...incomeActivityFilters("2026-10"),
  });
  assert.deepEqual(income.map((row) => row.id).sort(), [
    "Cash interest",
    "Payroll",
  ]);
});

test("a final Sankey category opens only its transactions across all months", () => {
  const leaf = sankeyGroups([
    group("HomeImprovement", { HomeImprovement: 10000 }),
  ])[0];
  const rows = [
    transaction(
      "old repair",
      "HomeImprovement",
      "HomeImprovement",
      "2025-01-01",
    ),
    transaction(
      "new repair",
      "HomeImprovement",
      "HomeImprovement",
      "2026-10-17",
    ),
    transaction("shopping", "Shopping", "Shopping", "2026-10-18"),
  ];
  const filters = shortcutFilters(leaf.activityFilter);
  assert.deepEqual(filters.categoryGroups, ["HomeImprovement"]);
  assert.deepEqual(filters.months, []);
  assert.deepEqual(
    filterTransactions(rows, filters).map((row) => row.id),
    ["new repair", "old repair"],
  );
});

test("loan shortcuts retain original subcategory keys and isolate the remaining loan costs", () => {
  const groups = sankeyGroups([
    group("Loans", { Mortgage: 500000, CarLoan: 100000, Other: 10000 }),
  ]);
  const rows = [
    transaction("mortgage", "Loans", "Mortgage", "2026-10-01"),
    transaction("car", "Loans", "CarLoan", "2026-10-02"),
    transaction("other", "Loans", "Other", "2026-10-03"),
  ];
  for (const [name, expected] of [
    ["Mortgage", "mortgage"],
    ["Car loan", "car"],
    ["Loans", "other"],
  ]) {
    const leaf = groups.find((group) => group.name === name);
    assert.deepEqual(
      filterTransactions(rows, shortcutFilters(leaf.activityFilter)).map(
        (row) => row.id,
      ),
      [expected],
    );
  }
});

test("overview shortcuts use real categories and Everything else excludes income and fixed costs", () => {
  const groups = overviewGroups([
    group("Loans", { Mortgage: 500000, CarLoan: 100000, Other: 10000 }),
    group("Utilities", { Electricity: 5000 }),
    group("Shopping", { Clothes: 20000 }),
    group("Salary", { Salary: 0 }),
  ]);
  const rows = [
    transaction("mortgage", "Loans", "Mortgage", "2026-10-01"),
    transaction("car", "Loans", "CarLoan", "2026-10-02"),
    transaction("other", "Loans", "Other", "2026-10-03"),
    transaction("utility", "Utilities", "Electricity", "2026-10-04"),
    transaction("shopping", "Shopping", "Clothes", "2026-10-05"),
    transaction("paycheck", "Salary", "Salary", "2026-10-06", "income"),
  ];
  for (const [name, expected] of [
    ["Mortgage", ["mortgage"]],
    ["Car loan", ["car"]],
    ["Utilities", ["utility"]],
    ["Everything else", ["shopping", "other"]],
  ]) {
    const leaf = groups.find((group) => group.name === name);
    assert.deepEqual(
      filterTransactions(rows, shortcutFilters(leaf.activityFilter)).map(
        (row) => row.id,
      ),
      expected,
    );
  }
  const absent = overviewGroups([]);
  assert.ok(absent.every((group) => group.activityFilter === undefined));
});

test("overview separates loans and utilities while combining all remaining expenses", () => {
  const source = [
    group("Loans", { Mortgage: 500000, CarLoan: 100000, Other: 25000 }),
    group("Utilities", { Electricity: 15000, Water: 5000 }),
    group("Shopping", { Clothes: 20000, Electronics: 30000 }),
    group("Travel", { Travel: 75000 }),
    group("Groceries", { Groceries: 40000 }),
    group("Other", { Other: 10000 }),
  ];
  const original = structuredClone(source);
  const result = overviewGroups(source);
  assert.deepEqual(
    result.map(({ name, cents }) => [name, cents]),
    [
      ["Mortgage", 500000],
      ["Car loan", 100000],
      ["Utilities", 20000],
      ["Everything else", 200000],
    ],
  );
  assert.equal(
    result.reduce((sum, item) => sum + item.cents, 0),
    source.reduce((sum, item) => sum + item.cents, 0),
  );
  assert.deepEqual(source, original);
});

test("overview counts standalone loans, nested utilities and uncategorized spending once", () => {
  const result = overviewGroups([
    group("Mortgage", { Mortgage: 500000 }),
    group("CarLoan", { CarLoan: 100000 }),
    group("Home", { Utilities: 20000, Repairs: 5000 }),
    { ...group("Uncategorized", {}), cents: 10000 },
  ]);
  assert.deepEqual(
    result.map(({ name, cents }) => [name, cents]),
    [
      ["Mortgage", 500000],
      ["Car loan", 100000],
      ["Utilities", 20000],
      ["Everything else", 15000],
    ],
  );
});

test("overview nets refunds within expenses and preserves negative loan refunds", () => {
  const result = overviewGroups([
    group("Loans", { Mortgage: -5000 }),
    group("Groceries", { Groceries: 20000 }),
    group("Shopping", { Returns: -3000 }),
  ]);
  assert.deepEqual(
    result.map(({ name, cents }) => [name, cents]),
    [
      ["Mortgage", -5000],
      ["Car loan", 0],
      ["Utilities", 0],
      ["Everything else", 17000],
    ],
  );
  const income = 100000;
  const spending = result.reduce((sum, item) => sum + item.cents, 0);
  assert.equal(income - spending, 88000);
  assert.equal(
    overviewGroups([group("Shopping", { Returns: -3000 })]).find(
      (item) => item.name === "Everything else",
    ).cents,
    -3000,
  );
});

function incomeSource(label, cents, count = 1) {
  return { key: `name:${label}`, label, cents, transactionCount: count };
}

test("income graph preserves signed adjustments and omits percentages for nonpositive income", () => {
  const sources = [
    incomeSource("Payroll", 10000, 2),
    incomeSource("Reversal", -2000),
    incomeSource("Net zero", 0, 2),
  ];
  const flow = incomeFlow(sources, 8000);
  assert.deepEqual(flow.positive, [sources[0]]);
  assert.deepEqual(flow.adjustments, [sources[1]]);
  assert.equal(flow.positiveCents - flow.adjustmentCents, 8000);
  assert.equal(flow.percentage(sources[0]), "125.0%");
  assert.equal(flow.percentage(sources[1]), null);
  assert.equal(incomeFlow(sources, 0).percentage(sources[0]), null);
  assert.equal(incomeFlow(sources, -1).percentage(sources[0]), null);
  assert.deepEqual(incomeFlow([], 0).positive, []);
});

test("income shortcuts retain the report and exact source, clearing unrelated restrictions", () => {
  const source = incomeSource("Payroll / A&B", 10000);
  const filters = shortcutFilters(incomeActivityFilters("2026-10", source));
  assert.deepEqual(filters, {
    ...emptyFilters(),
    cashFlowPeriod: "2026-10",
    incomeSource: "name:Payroll / A&B",
    kinds: ["income"],
    statuses: ["posted"],
    visibility: "included",
  });
  const query = new URL(activityQuery(filters, ""), "http://localhost");
  assert.equal(query.searchParams.get("filters[incomeSource]"), source.key);
  assert.equal(query.searchParams.get("filters[cashFlowPeriod]"), "2026-10");
  assert.equal(shortcutFilters(incomeActivityFilters("2026")).incomeSource, "");
});

test("income filters retain signed entries and match exact sources within report dates", () => {
  configureFinance({
    categories: [],
    accounts: [],
    months: [],
    today: "2026-10-20",
  });
  const row = (id, date, patch = {}) => ({
    ...transaction(id, "uncategorized", "Uncategorized", date, "income"),
    amountCents: 10000,
    incomeSourceKey: "name:Payroll",
    ...patch,
  });
  const rows = [
    row("included", "2026-10-20"),
    row("reversal", "2026-10-02", { amountCents: -2000 }),
    row("january", "2026-01-01"),
    row("prior year", "2025-12-31"),
    row("future", "2026-10-21"),
    row("pending", "2026-10-03", { pending: true }),
    row("excluded", "2026-10-04", { excluded: true }),
    row("similar", "2026-10-05", { incomeSourceKey: "name:Payroll bonus" }),
    row("refund", "2026-10-06", { kind: "expense", incomeSourceKey: null }),
  ];
  const source = incomeSource("Payroll", 8000);
  const monthly = shortcutFilters(incomeActivityFilters("2026-10", source));
  assert.deepEqual(
    filterTransactions(rows, monthly).map((row) => row.id),
    ["included", "reversal"],
  );
  assert.deepEqual(
    filterTransactions(rows, { ...monthly, cashFlowPeriod: "2026" }).map(
      (row) => row.id,
    ),
    ["included", "reversal", "january"],
  );
  assert.deepEqual(cashFlowPeriodDates("2026"), {
    start: "2026-01-01",
    end: "2026-10-20",
  });
  assert.deepEqual(cashFlowPeriodDates("2024-02"), {
    start: "2024-02-01",
    end: "2024-02-29",
  });
  assert.ok(
    activeFilters(monthly).some(
      (chip) => chip.key === "incomeSource" && chip.label === "Payroll",
    ),
  );
  assert.ok(
    activeFilters(monthly).some(
      (chip) =>
        chip.key === "cashFlowPeriod" && chip.label.includes("Oct 20, 2026"),
    ),
  );
});

test("clearing income context and changing transaction types cannot leave an invalid source filter", () => {
  const filters = shortcutFilters(
    incomeActivityFilters("2026", incomeSource("Payroll", 10000)),
  );
  assert.equal(
    normalizeIncomeFilters({ ...filters, cashFlowPeriod: "" }).incomeSource,
    "",
  );
  const changed = normalizeIncomeFilters({ ...filters, kinds: ["expense"] });
  assert.equal(changed.incomeSource, "");
  assert.equal(changed.cashFlowPeriod, "");
  const category = shortcutFilters({ categoryGroups: ["Food"] });
  assert.equal(category.cashFlowPeriod, "");
  assert.equal(category.incomeSource, "");
  assert.equal(emptyFilters().incomeSource, "");
});

test("tiny positive income shares stay visible without rounding to zero", () => {
  const tiny = incomeSource("Cash interest", 1);
  assert.equal(incomeFlow([tiny], 100000).percentage(tiny), "<0.1%");
  assert.equal(incomeFlow([tiny], 1000).percentage(tiny), "0.1%");
  assert.equal(
    incomeFlow([incomeSource("Empty", 0)], 1000).percentage(
      incomeSource("Empty", 0),
    ),
    null,
  );
});

const { savingsRate, cashFlowPeriodLabel, dashboardStatus } = require(
  path.join(output, "cashFlow.js"),
);

test("savings rates show whole shares and omit nonpositive income", () => {
  assert.equal(savingsRate(25000, 100000), "25%");
  assert.equal(savingsRate(-25700, 100000), "26%");
  assert.equal(savingsRate(0, 100000), "0%");
  assert.equal(savingsRate(200000, 100000), "200%");
  assert.equal(savingsRate(5000, 0), null);
  assert.equal(savingsRate(-5000, -1000), null);
});

test("cash flow period captions distinguish current, complete and leap-year periods", () => {
  assert.equal(cashFlowPeriodLabel("2026-10", "2026-10-25"), "Oct 1–25");
  assert.equal(cashFlowPeriodLabel("2026", "2026-10-25"), "Jan 1–Oct 25");
  assert.equal(cashFlowPeriodLabel("2025", "2026-10-25"), "Full year");
  assert.equal(cashFlowPeriodLabel("2024-02", "2026-10-25"), "Feb 1–29");
  assert.equal(cashFlowPeriodLabel("2026-09", "2026-10-25"), "Sep 1–30");
});

test("status prioritizes work in progress and counts each attention source", () => {
  const idle = {
    loading: false,
    saving: 0,
    handoffReviewCount: 0,
    stagedPendingCount: 0,
    missingCount: 0,
  };
  assert.equal(dashboardStatus(idle).state, "ready");
  for (const field of [
    "handoffReviewCount",
    "stagedPendingCount",
    "missingCount",
  ])
    assert.equal(dashboardStatus({ ...idle, [field]: 1 }).state, "attention");
  assert.deepEqual(
    dashboardStatus({ ...idle, loading: true, missingCount: 2 }),
    { state: "busy", label: "Updating data" },
  );
  assert.deepEqual(dashboardStatus({ ...idle, saving: 1 }), {
    state: "busy",
    label: "Saving changes",
  });
});
