const assert = require("node:assert/strict");
const { execFileSync } = require("node:child_process");
const { mkdtempSync, rmSync } = require("node:fs");
const { tmpdir } = require("node:os");
const path = require("node:path");
const { after, test } = require("node:test");

const output = mkdtempSync(path.join(tmpdir(), "money-review-"));
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
    "src/data/review.ts",
    "src/data/api.ts",
  ],
  { cwd: path.resolve(__dirname, ".."), stdio: "pipe" },
);
const {
  applyTransactionPatch,
  confidentTransactionIds,
  isRefund,
  suggestionLabel,
} = require(path.join(output, "review.js"));
const {
  emptyFilters,
  filterTransactions,
  reviewFilters,
  shortcutFilters,
} = require(path.join(output, "filters.js"));
const { activityQuery, confirmTransactionBatches } = require(
  path.join(output, "api.js"),
);

const categorization = (patch = {}) => ({
  source: "ollama",
  confidence: 0.956,
  confident: true,
  reviewRequired: false,
  ...patch,
});
const transaction = (patch = {}) => ({
  id: "spending",
  name: "Local shop",
  date: "2026-10-20",
  amountCents: -1200,
  kind: "expense",
  category: "shopping",
  subcategory: "Clothes",
  account: "Checking",
  reviewed: false,
  categorization: categorization(),
  ...patch,
});

test("suggestion lines identify each source and round Gemma confidence", () => {
  for (const [source, label] of [
    ["rule", "From your rule"],
    ["history", "From your confirmed history"],
    ["copilot_history", "From your Copilot history"],
    ["ollama", "Suggested by AI · 96%"],
    ["provider", "Bank's category — check it"],
    ["uncategorized", "Needs a category"],
  ])
    assert.equal(suggestionLabel(categorization({ source })), label);
  assert.equal(suggestionLabel(null), "Needs a category");
  assert.equal(
    suggestionLabel(categorization({ confidence: null })),
    "Suggested by AI",
  );
  assert.equal(
    suggestionLabel(categorization({ confidence: 0 })),
    "Suggested by AI · 0%",
  );
});

test("only positive spending rows are refunds regardless of category or account", () => {
  assert.equal(isRefund(transaction({ amountCents: 100 })), true);
  assert.equal(isRefund(transaction({ amountCents: 0 })), false);
  assert.equal(isRefund(transaction()), false);
  for (const kind of ["income", "transfer", "investment"])
    assert.equal(isRefund(transaction({ kind, amountCents: 100 })), false);
  assert.equal(
    isRefund(
      transaction({ amountCents: 100, category: null, account: "Card" }),
    ),
    true,
  );
});

test("batch eligibility uses the confident flag and only unreviewed cash-flow rows", () => {
  const rows = [
    transaction(),
    transaction({ id: "income", kind: "income" }),
    transaction({ id: "reviewed", reviewed: true }),
    transaction({ id: "unknown", categorization: null }),
    transaction({ id: "transfer", kind: "transfer" }),
    transaction({ id: "investment", kind: "investment" }),
    transaction({
      id: "not confident",
      categorization: categorization({ confident: false, confidence: 1 }),
    }),
  ];
  assert.deepEqual(confidentTransactionIds(rows), ["spending", "income"]);
  assert.deepEqual(confidentTransactionIds([]), []);
  assert.deepEqual(
    filterTransactions(rows, { ...emptyFilters(), review: "unreviewed" }).map(
      (row) => row.id,
    ),
    ["income", "not confident", "spending", "unknown"],
  );
});

test("optimistic flow edits immediately change kind without changing signed cents", () => {
  const original = transaction({ kind: "income", amountCents: 1200 });
  const refund = applyTransactionPatch(original, { flow: "refund" });
  assert.equal(refund.kind, "expense");
  assert.equal(refund.reviewed, true);
  assert.equal(refund.amountCents, 1200);
  assert.equal(refund.category, "shopping");
  assert.ok(!("flow" in refund));
  assert.equal(
    applyTransactionPatch(refund, { flow: "income" }).kind,
    "income",
  );
  assert.deepEqual(applyTransactionPatch(original, { reviewed: true }), {
    ...original,
    reviewed: true,
  });
  assert.equal(original.reviewed, false);
  assert.equal(original.kind, "income");
});

test("review filters switch the default sort and preserve other chosen orders", () => {
  const on = reviewFilters(emptyFilters(), "unreviewed");
  assert.equal(on.sort, "review");
  assert.equal(reviewFilters(on, "all").sort, "newest");
  assert.equal(reviewFilters(on, "reviewed").sort, "newest");
  for (const sort of ["oldest", "largest", "smallest"]) {
    const filters = reviewFilters({ ...emptyFilters(), sort }, "unreviewed");
    assert.equal(filters.sort, sort);
    assert.equal(reviewFilters(filters, "all").sort, sort);
  }
  assert.equal(shortcutFilters({ review: "unreviewed" }).sort, "review");
  assert.equal(
    shortcutFilters({ categories: ["shopping|Clothes"] }).sort,
    "newest",
  );
  const query = new URL(activityQuery(on, ""), "http://localhost");
  assert.equal(query.searchParams.get("filters[sort]"), "review");
});

test("review order matches server priority, null confidence, dates and stable IDs", () => {
  const rows = [
    transaction({ id: "confident" }),
    transaction({
      id: "uncategorized",
      category: "uncategorized",
      categorization: null,
    }),
    transaction({
      id: "a",
      categorization: categorization({ reviewRequired: true, confidence: 0.2 }),
    }),
    transaction({
      id: "b",
      categorization: categorization({ reviewRequired: true, confidence: 0.2 }),
    }),
    transaction({
      id: "older",
      date: "2026-10-19",
      categorization: categorization({ reviewRequired: true, confidence: 0.2 }),
    }),
    transaction({
      id: "null",
      categorization: categorization({
        reviewRequired: true,
        confidence: null,
      }),
    }),
    transaction({
      id: "provider",
      categorization: categorization({
        source: "provider",
        confident: false,
        confidence: null,
      }),
    }),
  ];
  assert.deepEqual(
    filterTransactions(rows, { ...emptyFilters(), sort: "review" }).map(
      (row) => row.id,
    ),
    ["null", "a", "b", "older", "uncategorized", "provider", "confident"],
  );
});

test("batch confirmation sends at most 100 IDs and counts server confirmations", async () => {
  const fetch = global.fetch;
  const calls = [];
  const batches = [];
  global.fetch = async (url, options) => {
    const { ids } = JSON.parse(options.body);
    calls.push({ url, options, ids });
    return {
      ok: true,
      status: 200,
      json: async () => ({
        confirmed: ids.length - 1,
        transactions: ids.map((id) => transaction({ id, reviewed: true })),
      }),
    };
  };
  try {
    const ids = Array.from({ length: 205 }, (_, index) => String(index));
    const confirmed = await confirmTransactionBatches(ids, (batch) =>
      batches.push(batch),
    );
    assert.equal(confirmed, 202);
    assert.deepEqual(
      calls.map((call) => call.ids.length),
      [100, 100, 5],
    );
    assert.deepEqual(
      calls.flatMap((call) => call.ids),
      ids,
    );
    assert.deepEqual(
      batches.flatMap((batch) => batch.transactions.map((row) => row.id)),
      ids,
    );
    for (const call of calls) {
      assert.equal(call.url, "/api/v1/money_dashboard/transactions/confirm");
      assert.equal(call.options.method, "POST");
      assert.equal(call.options.headers["Content-Type"], "application/json");
    }
    assert.equal(
      await confirmTransactionBatches([], () =>
        assert.fail("Unexpected batch"),
      ),
      0,
    );
    assert.equal(calls.length, 3);
  } finally {
    global.fetch = fetch;
  }
});

test("a failed confirmation chunk keeps earlier results and stops further writes", async () => {
  const fetch = global.fetch;
  const batches = [];
  let calls = 0;
  global.fetch = async () => {
    calls += 1;
    return calls === 1
      ? {
          ok: true,
          status: 200,
          json: async () => ({
            confirmed: 100,
            transactions: [transaction({ reviewed: true })],
          }),
        }
      : {
          ok: false,
          status: 422,
          json: async () => ({ message: "Could not confirm" }),
        };
  };
  try {
    await assert.rejects(
      confirmTransactionBatches(
        Array.from({ length: 205 }, (_, index) => String(index)),
        (batch) => batches.push(batch),
      ),
      /Could not confirm/,
    );
    assert.equal(calls, 2);
    assert.equal(batches.length, 1);
    assert.equal(batches[0].transactions[0].reviewed, true);
  } finally {
    global.fetch = fetch;
  }
});

test("review sections preserve server order and exclude reviewed and non-cash-flow rows", () => {
  const { reviewSections, needsCategory } = require(
    path.join(output, "review.js"),
  );
  const rows = [
    transaction({ id: "least certain", categorization: null }),
    transaction({ id: "ready one" }),
    transaction({ id: "needs category", category: "uncategorized" }),
    transaction({ id: "ready income", kind: "income", category: null }),
    transaction({ id: "reviewed", reviewed: true }),
    transaction({ id: "transfer", kind: "transfer" }),
    transaction({ id: "investment", kind: "investment" }),
    transaction({
      id: "less certain",
      categorization: categorization({ confident: false }),
    }),
  ];
  const sections = reviewSections(rows);
  assert.deepEqual(
    sections.ready.map((row) => row.id),
    ["ready one", "ready income"],
  );
  assert.deepEqual(
    sections.needsCall.map((row) => row.id),
    ["least certain", "needs category", "less certain"],
  );
  assert.equal(needsCategory(transaction({ category: null })), true);
  assert.equal(
    needsCategory(transaction({ kind: "income", category: null })),
    false,
  );
  assert.deepEqual(confidentTransactionIds(rows), [
    "ready one",
    "ready income",
  ]);
  assert.deepEqual(reviewSections([]), { ready: [], needsCall: [] });
});
