const assert = require("node:assert/strict");
const { execFileSync } = require("node:child_process");
const { mkdtempSync, rmSync } = require("node:fs");
const { tmpdir } = require("node:os");
const path = require("node:path");
const { after, test } = require("node:test");

const output = mkdtempSync(path.join(tmpdir(), "money-categories-"));
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
    "src/data/categories.ts",
  ],
  { cwd: path.resolve(__dirname, ".."), stdio: "pipe" },
);
const {
  categoryActivityFilters,
  categoryMetrics,
  categoryRows,
  categorySpendingSegments,
  categoryShortcut,
  formatShare,
  splitByActivity,
  transactionsByMonth,
} = require(path.join(output, "categories.js"));
const { configureFinance } = require(path.join(output, "finance.js"));

const month = (id) => ({
  id,
  label: id,
  short: id.slice(5),
  period: "",
  asOf: "",
});
configureFinance({
  categories: [],
  accounts: [],
  months: ["2025-11", "2025-12", "2026-01", "2026-02", "2026-03"].map(month),
  today: "2026-03-15",
});

function group(name, children) {
  return {
    id: name,
    name,
    icon: "house",
    color: "blue",
    children: Object.keys(children),
    cents: Object.values(children).reduce((sum, value) => sum + value, 0),
    breakdown: Object.entries(children).map(([child, cents]) => ({
      id: `${name}|${child}`,
      name: child,
      color: "blue",
      cents,
    })),
  };
}
const summary = (...groups) => ({
  spending: groups.reduce((sum, item) => sum + item.cents, 0),
  groups,
});

test("rows sort by spending and bars show each share of the month's spending", () => {
  const rows = categoryRows(
    summary(
      group("Travel", { Travel: 30000 }),
      group("Shopping", {
        Shopping: 0,
        Costco: 15000,
        Amazon: 5000,
        Children: 0,
      }),
      group("Beauty", { Beauty: 0 }),
    ),
  );
  assert.deepEqual(
    rows.map((row) => [row.name, row.share]),
    [
      ["Travel", 0.6],
      ["Shopping", 0.4],
      ["Beauty", 0],
    ],
  );
  assert.deepEqual(rows[0].subcategories, []);
  // The activity split moves empty children into the disclosure later.
  assert.deepEqual(
    rows[1].subcategories.map((child) => [child.name, child.share]),
    [
      ["Costco", 0.3],
      ["Amazon", 0.1],
      ["Children", 0],
    ],
  );
});

test("zero-spend parents and children move into one disclosure without mutating rows", () => {
  const rows = categoryRows(
    summary(
      group("Shopping", { Shopping: 0, Costco: 15000, Clothing: 0 }),
      group("Travel", { Travel: 0, Flights: 0, Hotels: 0 }),
      group("Education", { Education: 0 }),
    ),
  );
  const original = structuredClone(rows);
  const { active, inactive } = splitByActivity(rows);
  assert.deepEqual(
    active.map((row) => [
      row.name,
      row.subcategories.map((child) => child.name),
    ]),
    [["Shopping", ["Costco"]]],
  );
  assert.deepEqual(
    inactive.map((row) => [row.name, row.selection]),
    [
      ["Clothing", { group: "Shopping", child: "Shopping|Clothing" }],
      ["Education", { group: "Education" }],
      ["Travel", { group: "Travel" }],
      ["Flights", { group: "Travel", child: "Travel|Flights" }],
      ["Hotels", { group: "Travel", child: "Travel|Hotels" }],
    ],
  );
  assert.ok(inactive.every((row) => row.cents === 0 && row.share === 0));
  assert.equal(inactive[0].groupName, "Shopping");
  assert.deepEqual(rows, original);
  assert.deepEqual(splitByActivity([]), { active: [], inactive: [] });
});

test("net refunds stay active and a zero-net parent retains its nonzero children", () => {
  const { active, inactive } = splitByActivity(
    categoryRows(
      summary(
        group("Travel", { Travel: -1200 }),
        group("Shopping", { Shopping: 0, Costco: 1500, Clothing: -1500 }),
      ),
    ),
  );
  assert.deepEqual(
    active.map((row) => row.name),
    ["Shopping", "Travel"],
  );
  assert.deepEqual(
    active[0].subcategories.map((child) => [child.name, child.cents]),
    [
      ["Costco", 1500],
      ["Clothing", -1500],
    ],
  );
  assert.equal(active[1].cents, -1200);
  assert.deepEqual(
    inactive.map((row) => row.selection),
    [{ group: "Shopping" }],
  );
});

test("the header combines spending below the top six into a single remainder", () => {
  const rows = categoryRows(
    summary(
      ...Array.from({ length: 8 }, (_, i) =>
        group(`Category ${i}`, { General: (i + 1) * 100 }),
      ),
    ),
  );
  const original = structuredClone(rows);
  const segments = categorySpendingSegments(rows);
  assert.deepEqual(
    segments.map((segment) => [segment.name, segment.cents]),
    [
      ["Category 7", 800],
      ["Category 6", 700],
      ["Category 5", 600],
      ["Category 4", 500],
      ["Category 3", 400],
      ["Category 2", 300],
      [null, 300],
    ],
  );
  assert.equal(new Set(segments.map((segment) => segment.id)).size, 7);
  assert.deepEqual(rows, original);
});

test("the header omits empty or refund segments and never invents a remainder", () => {
  assert.deepEqual(categorySpendingSegments([]), []);
  assert.deepEqual(
    categorySpendingSegments(
      categoryRows(
        summary(
          group("Travel", { Travel: -1200 }),
          group("Education", { Education: 0 }),
        ),
      ),
    ),
    [],
  );
  const rows = categoryRows(
    summary(
      group("Shopping", { Costco: 2000 }),
      group("Travel", { Travel: -1200 }),
    ),
  );
  assert.deepEqual(categorySpendingSegments(rows), [
    { id: "Shopping", name: "Shopping", cents: 2000 },
  ]);
  const six = categoryRows(
    summary(
      ...Array.from({ length: 6 }, (_, i) =>
        group(`Category ${i}`, { General: 100 }),
      ),
    ),
  );
  assert.equal(categorySpendingSegments(six).length, 6);
  assert.ok(categorySpendingSegments(six).every((segment) => segment.name));
});

test("a parent-named row appears when transactions sit directly on the parent", () => {
  const [row] = categoryRows(
    summary(group("Shopping", { Shopping: 2500, Costco: 7500 })),
  );
  assert.deepEqual(
    row.subcategories.map((child) => child.name),
    ["Costco", "Shopping"],
  );
});

test("net refunds and empty months never produce negative or invalid bars", () => {
  const rows = categoryRows({
    spending: 0,
    groups: [group("Travel", { Travel: -1200 }), group("Food", { Food: 1200 })],
  });
  assert.deepEqual(
    rows.map((row) => row.share),
    [0, 0],
  );
  assert.equal(formatShare(0), "0%");
  assert.equal(formatShare(0.004), "under 1%");
  assert.equal(formatShare(0.356), "36%");
});

test("metrics use the selected year's total over that year's recorded months", () => {
  const monthly = summary(
    group("Shopping", { Shopping: 0, Costco: 15000, Amazon: 5000 }),
    group("Travel", { Travel: 30000 }),
  );
  const yearly = summary(
    group("Shopping", { Shopping: 0, Costco: 45001, Amazon: 9000 }),
    group("Travel", { Travel: 90000 }),
  );
  const parent = categoryMetrics("2026-02", monthly, yearly, {
    group: "Shopping",
  });
  assert.equal(parent.name, "Shopping");
  assert.equal(parent.cents, 20000);
  assert.equal(parent.share, 0.4);
  assert.equal(parent.year, "2026");
  assert.equal(parent.yearCents, 54001);
  // January–March 2026 are in the history.
  assert.equal(parent.monthlyAverageCents, 18000);
  const child = categoryMetrics("2026-02", monthly, yearly, {
    group: "Shopping",
    child: "Shopping|Costco",
  });
  assert.equal(child.name, "Costco");
  assert.equal(child.group.name, "Shopping");
  assert.equal(child.yearCents, 45001);
  assert.equal(child.monthlyAverageCents, 15000);
  // History starting in November gives 2025 two months.
  const earlier = categoryMetrics("2025-12", monthly, yearly, {
    group: "Travel",
  });
  assert.equal(earlier.monthlyAverageCents, 45000);
  assert.equal(
    categoryMetrics("2026-02", monthly, yearly, {
      group: "Shopping",
      child: "Shopping|Missing",
    }),
    null,
  );
});

test("detail transactions are spending from the selected month back", () => {
  const latest = categoryActivityFilters({ group: "Travel" }, "2026-03");
  assert.deepEqual(latest.categoryGroups, ["Travel"]);
  assert.deepEqual(latest.categories, []);
  assert.deepEqual(latest.kinds, ["expense"]);
  assert.deepEqual(latest.months, []);
  assert.equal(latest.sort, "newest");
  const past = categoryActivityFilters(
    { group: "Shopping", child: "Shopping|Costco" },
    "2026-01",
  );
  assert.deepEqual(past.categoryGroups, []);
  assert.deepEqual(past.categories, ["Shopping|Costco"]);
  assert.deepEqual(past.months, ["2025-11", "2025-12", "2026-01"]);
  // View all keeps the existing all-history category shortcut.
  assert.deepEqual(categoryShortcut({ group: "Travel" }), {
    categoryGroups: ["Travel"],
  });
  assert.deepEqual(
    categoryShortcut({ group: "Shopping", child: "Shopping|Costco" }),
    { categories: ["Shopping|Costco"] },
  );
});

test("transactions group into consecutive months in their given order", () => {
  const rows = [
    { id: "a", date: "2026-03-04" },
    { id: "b", date: "2026-03-01" },
    { id: "c", date: "2026-01-20" },
  ];
  assert.deepEqual(
    transactionsByMonth(rows).map((section) => [
      section.month,
      section.transactions.map((row) => row.id),
    ]),
    [
      ["2026-03", ["a", "b"]],
      ["2026-01", ["c"]],
    ],
  );
  assert.deepEqual(transactionsByMonth([]), []);
});
