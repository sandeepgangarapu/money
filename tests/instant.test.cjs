const assert = require("node:assert/strict");
const { execFileSync } = require("node:child_process");
const { mkdtempSync, rmSync } = require("node:fs");
const { tmpdir } = require("node:os");
const path = require("node:path");
const { after, test } = require("node:test");

const output = mkdtempSync(path.join(tmpdir(), "money-instant-"));
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
    "src/data/pendingEdits.ts",
    "src/data/route.ts",
    "src/data/reviewInbox.ts",
    "src/data/trend.ts",
    "src/data/wealth.ts",
    "src/data/api.ts",
  ],
  { cwd: path.resolve(__dirname, ".."), stdio: "pipe" },
);
const { PendingEdits, editLabel, resolveRows } = require(
  path.join(output, "pendingEdits.js"),
);
const {
  adjacentMonths,
  formatRoute,
  localMonth,
  pageNumbers,
  parseRoute,
} = require(path.join(output, "route.js"));
const {
  categorySuggestions,
  formatElapsed,
  inboxOrder,
  nextFocus,
  reviewKeyAction,
  samePayee,
} = require(path.join(output, "reviewInbox.js"));
const { cumulativeSpending, nearestPoint, periodRange, trendGeometry } =
  require(path.join(output, "trend.js"));
const { balanceAgeDays } = require(path.join(output, "wealth.js"));
const { queryPage } = require(path.join(output, "api.js"));
const { configureFinance } = require(path.join(output, "finance.js"));
const { rememberCategory, resetRecentCategories } = require(
  path.join(output, "categoryChoices.js"),
);

configureFinance({
  categories: [
    {
      id: "food",
      name: "Food",
      color: "green",
      icon: "utensils",
      children: ["Food", "Groceries", "Dining"],
      childIds: { Food: "f", Groceries: "g", Dining: "d" },
    },
    {
      id: "fun",
      name: "Entertainment",
      color: "pink",
      icon: "shopping-bag",
      children: ["Entertainment"],
      childIds: { Entertainment: "e" },
    },
    {
      id: "home",
      name: "Home",
      color: "blue",
      icon: "house",
      children: ["Home", "Utilities"],
      childIds: { Home: "h", Utilities: "u" },
    },
  ],
  months: [],
  accounts: [],
});

const row = (patch = {}) => ({
  id: "t1",
  name: "Maple Studio - ZELLE PAYMENT",
  date: "2026-10-26",
  amountCents: -1000,
  kind: "expense",
  category: "food",
  subcategory: "Groceries",
  account: "Joint Checking",
  reviewed: false,
  categorization: {
    source: "ollama",
    confidence: 0.5,
    reviewRequired: true,
    confident: false,
  },
  ...patch,
});

// Deterministic timers: run() fires everything that is due.
function fakeTimers() {
  let next = 1;
  const pending = new Map();
  return {
    timers: {
      set: (callback, ms) => {
        const id = next++;
        pending.set(id, { callback, ms });
        return id;
      },
      clear: (id) => pending.delete(id),
    },
    size: () => pending.size,
    run() {
      const due = [...pending.values()];
      pending.clear();
      for (const { callback } of due) callback();
    },
  };
}
const settle = () => new Promise((resolve) => setImmediate(resolve));

test("edits wait out the undo window, then commit once in order", async () => {
  const clock = fakeTimers();
  const sent = [];
  const queue = new PendingEdits({
    timers: clock.timers,
    onChange: () => {},
    commit: async (edit, keepalive) => sent.push({ ...edit, keepalive }),
  });
  queue.add({ ids: ["a"], patch: { reviewed: true }, label: "Confirmed A" });
  queue.add({ ids: ["b"], patch: { excluded: true }, label: "Excluded" });
  assert.equal(queue.busy, 2);
  assert.deepEqual(queue.latest(), { key: 2, label: "Excluded", count: 1 });
  assert.equal(sent.length, 0);
  clock.run();
  await settle();
  assert.deepEqual(
    sent.map((edit) => [edit.ids[0], edit.keepalive]),
    [
      ["a", false],
      ["b", false],
    ],
  );
  assert.equal(queue.busy, 0);
  assert.equal(queue.latest(), null);
});

test("a second change to a row merges into its pending edit", async () => {
  const clock = fakeTimers();
  const sent = [];
  const queue = new PendingEdits({
    timers: clock.timers,
    onChange: () => {},
    commit: async (edit) => sent.push(edit),
  });
  const first = queue.add({
    ids: ["a"],
    patch: { category: "food", subcategory: "Dining" },
    label: "Moved to Dining",
  });
  const second = queue.add({
    ids: ["a"],
    patch: { flow: "refund" },
    label: "Refund · Dining",
  });
  assert.equal(first, second);
  assert.equal(clock.size(), 1);
  clock.run();
  await settle();
  assert.deepEqual(sent[0].patch, {
    category: "food",
    subcategory: "Dining",
    flow: "refund",
  });
  assert.equal(sent[0].label, "Refund · Dining");
});

test("undo cancels only the latest pending edit and never sends it", async () => {
  const clock = fakeTimers();
  const sent = [];
  const queue = new PendingEdits({
    timers: clock.timers,
    onChange: () => {},
    commit: async (edit) => sent.push(edit.ids[0]),
  });
  queue.add({ ids: ["a"], patch: { reviewed: true }, label: "A" });
  queue.add({ ids: ["b"], patch: { reviewed: true }, label: "B" });
  const undone = queue.undo();
  assert.deepEqual(
    undone.map((edit) => edit.ids),
    [["b"]],
  );
  assert.deepEqual([...queue.pendingIds()], ["a"]);
  clock.run();
  await settle();
  assert.deepEqual(sent, ["a"]);
  assert.deepEqual(queue.undo(), []);
});

test("one Undo reverts every edit made by the same action", async () => {
  const clock = fakeTimers();
  const sent = [];
  const queue = new PendingEdits({
    timers: clock.timers,
    onChange: () => {},
    commit: async (edit) => sent.push(edit.ids[0]),
  });
  queue.add({ ids: ["solo"], patch: { reviewed: true }, label: "Solo" });
  for (const id of ["b", "c", "a"])
    queue.add({
      ids: [id],
      patch: { category: "food", subcategory: "Dining" },
      label: "Moved to Dining",
      group: 7,
    });
  assert.deepEqual(queue.latest(), {
    key: 4,
    label: "Moved to Dining · 3 transactions",
    count: 3,
  });
  assert.deepEqual(
    queue
      .undo()
      .map((edit) => edit.ids[0])
      .sort(),
    ["a", "b", "c"],
  );
  assert.equal(queue.latest().label, "Solo");
  clock.run();
  await settle();
  assert.deepEqual(sent, ["solo"]);
});

test("a batch confirm sends pending category changes for its rows first", async () => {
  const clock = fakeTimers();
  const sent = [];
  const queue = new PendingEdits({
    timers: clock.timers,
    onChange: () => {},
    commit: async (edit) =>
      sent.push(
        edit.patch ? `patch:${edit.ids[0]}` : `confirm:${edit.ids.join(",")}`,
      ),
  });
  queue.add({
    ids: ["a"],
    patch: { category: "fun", subcategory: "Entertainment" },
    label: "Moved",
  });
  queue.add({ ids: ["a", "b"], label: "Confirmed 2 transactions" });
  await settle();
  assert.deepEqual(sent, ["patch:a"]);
  clock.run();
  await settle();
  assert.deepEqual(sent, ["patch:a", "confirm:a,b"]);
});

test("leaving the page sends every pending edit at once with keepalive", async () => {
  const clock = fakeTimers();
  const sent = [];
  let release;
  const queue = new PendingEdits({
    timers: clock.timers,
    onChange: () => {},
    commit: (edit, keepalive) => {
      sent.push([edit.ids[0], keepalive]);
      return new Promise((resolve) => {
        release = resolve;
      });
    },
  });
  queue.add({ ids: ["a"], patch: { reviewed: true }, label: "A" });
  queue.add({ ids: ["b"], patch: { reviewed: true }, label: "B" });
  queue.flushAll(true);
  assert.deepEqual(sent, [
    ["a", true],
    ["b", true],
  ]);
  assert.equal(clock.size(), 0);
  assert.equal(queue.busy, 2, "in-flight writes still count as busy");
  release();
});

test("a failed commit still settles the queue", async () => {
  const clock = fakeTimers();
  const queue = new PendingEdits({
    timers: clock.timers,
    onChange: () => {},
    commit: async () => {
      throw new Error("offline");
    },
  });
  queue.add({ ids: ["a"], patch: { reviewed: true }, label: "A" });
  queue.add({ ids: ["b"], patch: { reviewed: true }, label: "B" });
  clock.run();
  await settle();
  await settle();
  assert.equal(queue.busy, 0);
});

test("toast labels describe what changed", () => {
  const t = row();
  assert.equal(editLabel(t, { excluded: true }), "Excluded from cash flow");
  assert.equal(editLabel(t, { excluded: false }), "Included in cash flow");
  assert.equal(editLabel(t, { flow: "income" }), "Marked as income");
  assert.equal(
    editLabel(t, { category: "food", subcategory: "Dining" }),
    "Moved to Dining",
  );
  assert.equal(
    editLabel(t, { category: "fun", subcategory: "Entertainment" }),
    "Moved to Entertainment",
  );
  assert.equal(
    editLabel(t, { category: "food", subcategory: "Dining", flow: "refund" }),
    "Refund · Dining",
  );
  assert.equal(editLabel(t, { reviewed: true }), "Confirmed Maple Studio");
});

test("saved rows win only over fetches that started before the save", () => {
  const fetched = [row({ id: "a" }), row({ id: "b" })];
  const overrides = {
    a: { row: row({ id: "a", subcategory: "Dining" }), at: 100 },
    b: { row: row({ id: "b", reviewed: true }), at: Number.POSITIVE_INFINITY },
  };
  const before = resolveRows(fetched, overrides, 50);
  assert.equal(before[0].subcategory, "Dining");
  assert.equal(before[1].reviewed, true);
  const after = resolveRows(fetched, overrides, 150);
  assert.equal(
    after[0].subcategory,
    "Groceries",
    "a newer fetch is authoritative",
  );
  assert.equal(after[1].reviewed, true, "unsent edits always win");
});

test("routes keep screen, month and period, omitting the current month", () => {
  assert.deepEqual(parseRoute("#/flow?m=2026-10&p=year"), {
    screen: "flow",
    month: "2026-10",
    period: "year",
  });
  assert.deepEqual(parseRoute(""), {
    screen: "flow",
    month: null,
    period: "month",
  });
  assert.deepEqual(parseRoute("#/nowhere?m=2026-13"), {
    screen: "flow",
    month: null,
    period: "month",
  });
  assert.equal(parseRoute("#/review").screen, "review");
  const route = { screen: "flow", month: "2026-10", period: "year" };
  assert.equal(formatRoute(route, "2026-11"), "#/flow?m=2026-10&p=year");
  assert.equal(
    formatRoute({ ...route, month: "2026-11", period: "month" }, "2026-11"),
    "#/flow",
  );
  assert.equal(
    formatRoute({ ...route, screen: "categories" }, "2026-11"),
    "#/categories?m=2026-10",
  );
  assert.equal(
    formatRoute({ ...route, screen: "activity" }, "2026-11"),
    "#/activity",
  );
});

test("month helpers find neighbours, extra pages and the local month", () => {
  assert.deepEqual(
    adjacentMonths(["2026-09", "2026-10", "2026-11"], "2026-10"),
    ["2026-09", "2026-11"],
  );
  assert.deepEqual(
    adjacentMonths(["2026-09", "2026-10", "2026-11"], "2026-11"),
    ["2026-10"],
  );
  assert.deepEqual(adjacentMonths(["2026-09"], "2025-01"), []);
  assert.deepEqual(pageNumbers(0), []);
  assert.deepEqual(pageNumbers(100), []);
  assert.deepEqual(pageNumbers(151), [2]);
  assert.deepEqual(pageNumbers(301), [2, 3, 4]);
  assert.equal(localMonth(new Date(2026, 0, 31, 23, 59)), "2026-01");
  assert.equal(
    queryPage(
      "/activity?page=1&search=tacos&filters%5Bmonths%5D%5B%5D=2026-10",
      3,
    ),
    "/activity?page=3&search=tacos&filters%5Bmonths%5D%5B%5D=2026-10",
  );
});

test("suggestions lead with the current pick, then the payee's history", () => {
  resetRecentCategories();
  const t = row();
  const pool = [
    row({
      id: "h1",
      reviewed: true,
      category: "fun",
      subcategory: "Entertainment",
    }),
    row({
      id: "h2",
      reviewed: true,
      category: "fun",
      subcategory: "Entertainment",
    }),
    row({
      id: "s1",
      name: "Utility Co",
      reviewed: true,
      category: "home",
      subcategory: "Utilities",
      amountCents: -1000,
    }),
    row({
      id: "s2",
      name: "Utility Co",
      reviewed: true,
      category: "home",
      subcategory: "Utilities",
      amountCents: -1200,
    }),
    // One large bill must not outrank everyday categories.
    row({
      id: "s3",
      name: "Big Bill",
      reviewed: true,
      category: "home",
      subcategory: "Home",
      amountCents: -900000,
    }),
  ];
  assert.deepEqual(
    categorySuggestions(t, pool).map((choice) => [
      choice.subcategory,
      choice.current,
    ]),
    [
      ["Groceries", true],
      ["Entertainment", false],
      ["Utilities", false],
    ],
  );
  rememberCategory("food", "Dining");
  assert.deepEqual(
    categorySuggestions(t, pool).map((choice) => choice.subcategory),
    ["Groceries", "Entertainment", "Dining"],
    "recent picks come before the most-used categories",
  );
  resetRecentCategories();
  assert.deepEqual(
    categorySuggestions(
      row({ category: "uncategorized", subcategory: "Uncategorized" }),
      pool,
    ).map((choice) => choice.subcategory),
    ["Entertainment", "Utilities", "Home"],
  );
  assert.deepEqual(categorySuggestions(row({ kind: "income" }), pool), []);
});

test("focus moves to the row that followed the one just reviewed", () => {
  assert.equal(nextFocus(["a", "b", "c"], [], null), "a");
  assert.equal(nextFocus(["a", "c"], ["a", "b", "c"], "b"), "c");
  assert.equal(
    nextFocus(["a"], ["a", "b"], "b"),
    "a",
    "the last row falls back to the previous one",
  );
  assert.equal(nextFocus([], ["a"], "a"), null);
  assert.equal(nextFocus(["a", "b"], ["a", "b"], "b"), "b");
});

test("the inbox puts confident rows first and finds the same payee", () => {
  const confident = row({
    id: "c",
    categorization: {
      source: "rule",
      confidence: null,
      reviewRequired: false,
      confident: true,
    },
  });
  const unsure = row({ id: "u" });
  const done = row({ id: "d", reviewed: true });
  assert.deepEqual(
    inboxOrder([unsure, confident, done]).order.map((t) => t.id),
    ["c", "u"],
  );
  const other = row({ id: "o", name: "Maple Studio - ANOTHER" });
  const refund = row({ id: "r", amountCents: 500 });
  assert.deepEqual(
    samePayee(unsure, [unsure, other, refund, done]).map((t) => t.id),
    ["o"],
  );
});

test("review shortcuts map keys without modifiers", () => {
  const key = (value, modifiers = {}) =>
    reviewKeyAction({
      key: value,
      metaKey: false,
      ctrlKey: false,
      altKey: false,
      ...modifiers,
    });
  assert.equal(key("j"), "next");
  assert.equal(key("ArrowUp"), "previous");
  assert.equal(key("Enter"), "confirm");
  assert.equal(key("e"), "pick");
  assert.equal(key("x"), "exclude");
  assert.equal(key("Escape"), "close");
  assert.deepEqual(key("2"), { choose: 1 });
  assert.equal(key("z", { metaKey: true }), null);
  assert.equal(key("q"), null);
  assert.equal(formatElapsed(40_000), "40 s");
  assert.equal(formatElapsed(200), "1 s");
  assert.equal(formatElapsed(150_000), "3 min");
});

test("running spending fills empty days and stops at today", () => {
  assert.deepEqual(periodRange("2024-02"), {
    start: "2024-02-01",
    end: "2024-02-29",
  });
  assert.deepEqual(periodRange("2026"), {
    start: "2026-01-01",
    end: "2026-12-31",
  });
  const points = cumulativeSpending(
    [
      { date: "2026-11-01", cents: 601409 },
      { date: "2026-11-03", cents: 2000 },
      { date: "2026-11-03", cents: -500 },
    ],
    "2026-11-01",
    "2026-11-04",
  );
  assert.deepEqual(points, [
    { date: "2026-11-01", cents: 601409 },
    { date: "2026-11-02", cents: 601409 },
    { date: "2026-11-03", cents: 602909 },
    { date: "2026-11-04", cents: 602909 },
  ]);
  assert.equal(cumulativeSpending([], "2026-03-01", "2026-03-31").length, 31);
});

test("trend geometry spans the whole period and scrubs to the nearest day", () => {
  const range = periodRange("2026-11");
  const points = cumulativeSpending(
    [{ date: "2026-11-10", cents: 1000 }],
    range.start,
    "2026-11-15",
  );
  const geometry = trendGeometry(points, range, {
    width: 296,
    height: 120,
    inset: 4,
  });
  assert.equal(geometry.coordinates[0].x, 4);
  assert.equal(
    geometry.coordinates.at(-1).x,
    4 + (14 / 29) * 288,
    "today sits mid-chart",
  );
  assert.ok(
    geometry.coordinates[9].y < geometry.coordinates[8].y,
    "spending raises the line",
  );
  assert.ok(geometry.line.startsWith("M4.0,"));
  assert.ok(geometry.area.endsWith("Z"));
  assert.equal(nearestPoint(geometry.coordinates, 0), 0);
  assert.equal(nearestPoint(geometry.coordinates, 1000), 14);
  assert.equal(nearestPoint([], 10), -1);
});

test("balance age counts whole days and handles missing dates", () => {
  assert.equal(balanceAgeDays("2026-10-22", "2026-11-20"), 29);
  assert.equal(balanceAgeDays("2026-10-22T14:17:02-07:00", "2026-11-20"), 29);
  assert.equal(balanceAgeDays("not a date", "2026-11-20"), null);
  assert.equal(balanceAgeDays("2026-11-20", "2026-11-20"), 0);
  assert.equal(balanceAgeDays(null, "2026-11-20"), null);
});
