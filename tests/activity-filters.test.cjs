const assert = require("node:assert/strict");
const { execFileSync } = require("node:child_process");
const { mkdtempSync, rmSync } = require("node:fs");
const { tmpdir } = require("node:os");
const path = require("node:path");
const { after, test } = require("node:test");

// Compile the actual pure TypeScript modules with the project's existing compiler.
const output = mkdtempSync(path.join(tmpdir(), "money-filters-"));
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
    "src/data/filters.ts",
    "src/data/demo.ts",
  ],
  { cwd: path.resolve(__dirname, ".."), stdio: "pipe" },
);
const { seedTransactions, categories } = require(path.join(output, "demo.js"));
require(path.join(output, "finance.js")).configureFinance({
  categories,
  months: [],
  accounts: [],
});
const { emptyFilters, shortcutFilters, filterTransactions } = require(
  path.join(output, "filters.js"),
);
const find = (patch, search = "") =>
  filterTransactions(seedTransactions, { ...emptyFilters(), ...patch }, search);

test("a category shortcut starts with no date, account, review or amount restrictions", () => {
  const filters = shortcutFilters({
    categories: ["food|Groceries"],
    sort: "largest",
  });
  assert.deepEqual(filters, {
    ...emptyFilters(),
    categories: ["food|Groceries"],
  });
  assert.equal(filters.sort, "newest");
});

test("parent categories include every child and all months", () => {
  const rows = find({ categoryGroups: ["food"] });
  assert.equal(rows.length, 101);
  assert.equal(new Set(rows.map((t) => t.date.slice(0, 7))).size, 10);
  assert.deepEqual([...new Set(rows.map((t) => t.subcategory))].sort(), [
    "Eating out",
    "Groceries",
  ]);
  assert.ok(!rows.some((t) => t.name === "Home mortgage"));
});

test("a subcategory shortcut includes its complete history in newest-first order", () => {
  const rows = find({ categories: ["food|Groceries"] });
  assert.equal(rows.length, 50);
  assert.equal(rows[0].id, "2026-10-food-0");
  assert.equal(rows.at(-1).id, "2026-01-food-4");
  assert.ok(!rows.some((t) => t.name === "Neighborhood restaurant"));
});

test("an exact-day shortcut selects that day rather than its entire month", () => {
  assert.deepEqual(
    find({ date: "2026-10-14" }).map((t) => t.id),
    ["2026-10-income-1", "2026-10-pending"],
  );
  assert.equal(find({ date: "2026-10-15" }).length, 0);
});

test("income and account shortcuts retain the complete history", () => {
  const income = find({ kinds: ["income"] });
  assert.equal(income.length, 30);
  assert.equal(income[0].id, "2026-10-income-1");
  assert.equal(income.at(-1).id, "2026-01-income-0");
  const card = find({ accounts: ["Credit card · 5678"] }, "Whole Foods");
  assert.equal(card.length, 20);
  assert.ok(!card.some((t) => t.account === "Checking · 1234"));
});

test("carousel dimensions combine, with absolute amounts and posted/pending distinction", () => {
  const scope = {
    months: ["2026-10"],
    categoryGroups: ["food"],
    categories: ["food|Groceries"],
    minAmount: "100",
    maxAmount: "200",
  };
  assert.deepEqual(
    find(scope).map((t) => t.id),
    ["2026-10-food-0", "2026-10-food-1", "2026-10-food-3"],
  );
  assert.deepEqual(
    find({ months: ["2026-10"], statuses: ["pending"] }).map((t) => t.id),
    ["2026-10-pending"],
  );
  assert.equal(
    find({ months: ["2026-09", "2026-10"], review: "unreviewed" }).length,
    2,
  );
});

test("day grouping follows date sorts but keeps the review queue and amount sorts flat", () => {
  const { groupsByDay } = require(path.join(output, "filters.js"));
  assert.equal(groupsByDay(emptyFilters()), true);
  assert.equal(groupsByDay({ ...emptyFilters(), sort: "oldest" }), true);
  for (const sort of ["review", "largest", "smallest"])
    assert.equal(groupsByDay({ ...emptyFilters(), sort }), false);
  assert.equal(groupsByDay({ ...emptyFilters(), review: "unreviewed" }), false);
  assert.equal(
    groupsByDay({ ...emptyFilters(), review: "unreviewed", sort: "oldest" }),
    false,
  );
});

test("day groups keep transaction and day order without mutating the source", () => {
  const { groupTransactionsByDay } = require(path.join(output, "filters.js"));
  const rows = [
    { id: "one", date: "2026-10-23" },
    { id: "two", date: "2026-10-23" },
    { id: "three", date: "2026-10-22" },
  ];
  assert.deepEqual(groupTransactionsByDay(rows), [
    { date: "2026-10-23", transactions: rows.slice(0, 2) },
    { date: "2026-10-22", transactions: rows.slice(2) },
  ]);
  assert.deepEqual(
    rows.map((row) => row.id),
    ["one", "two", "three"],
  );
  assert.deepEqual(groupTransactionsByDay([]), []);
});

test("day labels use local calendar days, including year boundaries and DST", () => {
  const { activityDayLabel } = require(path.join(output, "filters.js"));
  const today = new Date(2026, 9, 26, 0, 15);
  assert.equal(activityDayLabel("2026-10-26", today), "Today");
  assert.equal(activityDayLabel("2026-10-25", today), "Yesterday");
  assert.equal(activityDayLabel("2026-10-23", today), "Friday, Oct 23");
  assert.equal(activityDayLabel("2025-10-23", today), "Oct 23, 2025");
  assert.equal(
    activityDayLabel("2025-12-31", new Date(2026, 0, 1)),
    "Yesterday",
  );
  assert.equal(
    activityDayLabel("2026-03-08", new Date(2026, 2, 9, 0, 15)),
    "Yesterday",
  );
});
