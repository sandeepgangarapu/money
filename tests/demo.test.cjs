const assert = require("node:assert/strict");
const { execFileSync } = require("node:child_process");
const { mkdtempSync, rmSync } = require("node:fs");
const { tmpdir } = require("node:os");
const path = require("node:path");
const { after, test } = require("node:test");

const output = mkdtempSync(path.join(tmpdir(), "money-demo-"));
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
    "src/demo/backend.ts",
  ],
  { cwd: path.resolve(__dirname, ".."), stdio: "pipe" },
);
const { createDemoBackend } = require(path.join(output, "demo/backend.js"));

const TODAY = "2026-11-21";
const get = (backend, url) => {
  const response = backend.handle("GET", url);
  assert.equal(response.status, 200, JSON.stringify(response.body));
  return response.body;
};
const activity = (backend, params) => {
  const query = new URLSearchParams({ page: "1", search: "" });
  for (const [key, value] of Object.entries(params)) {
    query.delete(key);
    for (const item of [].concat(value)) query.append(key, item);
  }
  return get(backend, `/activity?${query}`);
};
const sum = (items, key = "cents") =>
  items.reduce((total, item) => total + item[key], 0);

test("the household is the same on every visit for a given day", () => {
  assert.deepEqual(
    get(createDemoBackend(TODAY), ""),
    get(createDemoBackend(TODAY), ""),
  );
});

test("history ends today and covers thirty months", () => {
  const dashboard = get(createDemoBackend(TODAY), "");
  assert.equal(dashboard.month, "2026-11");
  assert.equal(dashboard.today, TODAY);
  assert.equal(dashboard.months.length, 30);
  assert.equal(dashboard.months.at(-1).asOf, "Month to date");
  assert.equal(dashboard.months.at(-1).period, "Nov 1–21");
  const rows = activity(createDemoBackend(TODAY), {
    "filters[sort]": "newest",
  });
  assert.ok(rows.transactions[0].date <= TODAY);
});

for (const today of [TODAY, "2027-01-03"]) {
  test(`cash flow totals reconcile (${today})`, () => {
    const backend = createDemoBackend(today);
    const current = get(backend, "");
    for (const month of current.months.slice(-14)) {
      const { summary, spendingByDay, months } = get(
        backend,
        `?month=${month.id}`,
      );
      assert.equal(summary.savings, summary.income - summary.spending);
      assert.equal(summary.income, sum(summary.incomeBreakdown.sources));
      assert.equal(summary.spending, sum(summary.groups));
      for (const group of summary.groups)
        assert.equal(group.cents, sum(group.breakdown));
      assert.equal(sum(spendingByDay.month), summary.spending);
      assert.equal(
        months.find((item) => item.id === month.id).spendingCents,
        summary.spending,
      );
    }
    const year = current.month.slice(0, 4);
    const monthly = current.months
      .filter((month) => month.id.startsWith(year))
      .map((month) => get(backend, `?month=${month.id}`).summary);
    assert.equal(current.yearlySummary.spending, sum(monthly, "spending"));
    assert.equal(current.yearlySummary.income, sum(monthly, "income"));
  });
}

test("a full month looks like a real household", () => {
  const { summary } = get(createDemoBackend(TODAY), "?month=2026-10");
  assert.ok(summary.income > 1_000_000, "income above $10k");
  assert.ok(summary.spending > 500_000, "spending above $5k");
  assert.ok(summary.savings > 0, "the household saves");
  assert.ok(summary.principalCents > 0, "loan principal counts as Saved");
  const loans = summary.groups.find((group) => group.name === "Loans");
  assert.deepEqual(
    loans.breakdown.map((child) => child.name),
    ["Loans", "Mortgage", "Car loan"],
  );
  assert.ok(loans.breakdown[1].cents > 0 && loans.breakdown[2].cents > 0);
  const payments = activity(createDemoBackend(TODAY), {
    "filters[months][]": "2026-10",
    "filters[categoryGroups][]": "loans",
  }).transactions;
  assert.equal(
    loans.cents + summary.principalCents,
    -sum(payments, "amountCents"),
  );
});

test("every row uses the catalog and the review queue is ready", () => {
  const backend = createDemoBackend(TODAY);
  const dashboard = get(backend, "");
  const all = [];
  for (let page = 1; ; page++) {
    const result = activity(backend, { page: String(page) });
    all.push(...result.transactions);
    if (!result.hasMore) break;
  }
  assert.ok(all.length > 1500);
  assert.equal(new Set(all.map((row) => row.id)).size, all.length);
  for (const row of all) {
    const group = dashboard.categories.find((item) => item.id === row.category);
    assert.ok(group && row.subcategory in group.childIds, row.name);
    assert.ok(dashboard.accounts.includes(row.account), row.account);
  }
  const queue = all.filter(
    (row) => !row.reviewed && (row.kind === "income" || row.kind === "expense"),
  );
  assert.equal(dashboard.reviewCount, queue.length);
  assert.ok(queue.length >= 10 && queue.length <= 45, `${queue.length}`);
  const sources = new Set(queue.map((row) => row.categorization?.source));
  for (const source of ["ollama", "uncategorized"])
    assert.ok(sources.has(source));
  assert.ok(queue.some((row) => row.categorization?.confident));
  assert.ok(queue.some((row) => row.kind === "income"));
  assert.ok(all.some((row) => row.pending));
  assert.ok(all.some((row) => row.excluded));
  assert.ok(all.some((row) => row.kind === "expense" && row.amountCents > 0));
  for (const kind of ["income", "expense", "transfer", "investment"])
    assert.ok(
      all.some((row) => row.kind === kind),
      kind,
    );
  assert.equal(
    activity(backend, {
      "filters[review]": "unreviewed",
      "filters[sort]": "review",
    }).total,
    queue.length,
  );
});

test("activity filters, searches and pages like the server", () => {
  const backend = createDemoBackend(TODAY);
  const month = activity(backend, { "filters[months][]": "2026-09" });
  assert.ok(month.total > 50);
  assert.ok(month.transactions.every((row) => row.date.startsWith("2026-09")));
  assert.equal(month.hasMore, month.total > 100);
  const search = activity(backend, { search: "trader joe" });
  assert.ok(search.total > 0);
  assert.ok(search.transactions.every((row) => /trader joe/i.test(row.name)));
  const largest = activity(backend, { "filters[sort]": "largest" });
  assert.ok(
    Math.abs(largest.transactions[0].amountCents) >=
      Math.abs(largest.transactions[1].amountCents),
  );
  const { summary } = get(backend, "?month=2026-10");
  const source = summary.incomeBreakdown.sources[0];
  const income = activity(backend, {
    "filters[cashFlowPeriod]": "2026-10",
    "filters[incomeSource]": source.key,
    "filters[kinds][]": "income",
  });
  assert.equal(income.total, source.transactionCount);
  assert.equal(sum(income.transactions, "amountCents"), source.cents);
  assert.equal(
    backend.handle("GET", "/activity?filters[incomeSource]=name:x").status,
    422,
  );
});

test("edits and confirmations update totals and the review count", () => {
  const backend = createDemoBackend(TODAY);
  const before = get(backend, "");
  const queue = activity(backend, {
    "filters[review]": "unreviewed",
    "filters[kinds][]": "expense",
    "filters[statuses][]": "posted",
  }).transactions;
  const row = queue.find(
    (item) => item.amountCents < 0 && item.category !== "gifts",
  );
  const patched = backend.handle("PATCH", `/transactions/${row.id}`, {
    transaction: { category: "gifts", subcategory: "Gifts" },
  });
  assert.equal(patched.status, 200);
  assert.equal(patched.body.reviewed, true);
  assert.equal(patched.body.category, "gifts");
  const after = get(backend, "");
  assert.equal(after.reviewCount, before.reviewCount - 1);
  const gifts = (dashboard) =>
    dashboard.summary.groups.find((group) => group.id === "gifts").cents;
  assert.equal(gifts(after), gifts(before) - row.amountCents);

  const rest = queue.filter((item) => item.id !== row.id).slice(0, 3);
  const confirmed = backend.handle("POST", "/transactions/confirm", {
    ids: rest.map((item) => item.id),
  });
  assert.equal(confirmed.body.confirmed, rest.length);
  assert.equal(get(backend, "").reviewCount, after.reviewCount - rest.length);

  const excluded = backend.handle("PATCH", `/transactions/${rest[0].id}`, {
    transaction: { excluded: true },
  });
  assert.equal(excluded.body.excluded, true);
  assert.equal(
    backend.handle("PATCH", `/transactions/${row.id}`, {
      transaction: { category: "gifts", subcategory: "Nope" },
    }).status,
    422,
  );
  assert.equal(
    backend.handle("PATCH", "/transactions/missing", { transaction: {} })
      .status,
    404,
  );
});

test("rules preview, save, apply, toggle and delete", () => {
  const backend = createDemoBackend(TODAY);
  const { rules } = get(backend, "/rules");
  assert.ok(rules.length >= 5);
  const rule = {
    matchType: "contains",
    pattern: "doordash",
    categoryId: "dining-out:restaurants",
    active: true,
  };
  const preview = backend.handle("POST", "/rules/preview", { rule }).body;
  assert.ok(preview.matchCount > 0 && preview.samples.length <= 10);
  const created = backend.handle("POST", "/rules", {
    rule,
    applyExisting: true,
    previewToken: preview.previewToken,
  });
  assert.equal(created.status, 201);
  assert.equal(created.body.appliedCount, preview.matchCount);
  const moved = activity(backend, { search: "doordash" }).transactions;
  assert.ok(moved.every((row) => row.subcategory === "Restaurants"));
  const toggled = backend.handle("PATCH", `/rules/${created.body.rule.id}`, {
    rule: { active: false },
  });
  assert.equal(toggled.body.rule.active, false);
  assert.equal(
    backend.handle("DELETE", `/rules/${created.body.rule.id}`).status,
    204,
  );
  assert.equal(get(backend, "/rules").rules.length, rules.length);
  assert.equal(
    backend.handle("POST", "/rules/preview", {
      rule: { ...rule, categoryId: "" },
    }).status,
    422,
  );
});

test("wealth adds up and connections stay read-only", () => {
  const backend = createDemoBackend(TODAY);
  const { wealth } = get(backend, "");
  assert.equal(wealth.netWorth, wealth.assets - wealth.debt);
  assert.ok(wealth.netWorth > 0 && wealth.debt > 0);
  const types = new Set(wealth.accounts.map((account) => account.type));
  for (const type of [
    "Depository",
    "CreditCard",
    "Investment",
    "Crypto",
    "Property",
    "Loan",
  ])
    assert.ok(types.has(type), type);
  for (const account of wealth.accounts) {
    assert.notEqual(account.balanceCents, null);
    const held = sum(account.holdings, "valueCents");
    assert.ok(held <= account.balanceCents, account.name);
  }
  assert.equal(get(backend, "/plaid").canConfigure, false);
  assert.equal(get(backend, "/properties").properties.length, 1);
  assert.equal(backend.handle("POST", "/plaid/link", {}).status, 403);
  assert.equal(backend.handle("GET", "?month=2026-12").status, 422);
  assert.equal(backend.handle("GET", "/nope").status, 404);
});
