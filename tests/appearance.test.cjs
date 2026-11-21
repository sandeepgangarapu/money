const assert = require("node:assert/strict");
const { execFileSync } = require("node:child_process");
const { mkdtempSync, rmSync } = require("node:fs");
const { tmpdir } = require("node:os");
const path = require("node:path");
const { after, test } = require("node:test");

const output = mkdtempSync(path.join(tmpdir(), "money-appearance-"));
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
    "src/data/appearance.ts",
  ],
  { cwd: path.resolve(__dirname, ".."), stdio: "pipe" },
);
const {
  categoryAppearance,
  transactionAppearance,
  savedAppearance,
  everythingElseAppearance,
  tint,
} = require(path.join(output, "appearance.js"));
const { configureFinance } = require(path.join(output, "finance.js"));

test("category names ignore case, spaces and punctuation", () => {
  const expected = { emoji: "🔨", color: "#C2410C" };
  for (const name of [
    "HomeImprovement",
    "Home Improvement",
    "home-improvement",
    "HOME.IMPROVEMENT",
  ])
    assert.deepEqual(categoryAppearance(name), expected);
  assert.deepEqual(categoryAppearance("Healthcare"), {
    emoji: "💊",
    color: "#EF4444",
  });
});

test("children inherit colors, use their own entries, or fall back to parent emoji", () => {
  assert.deepEqual(categoryAppearance("Outside Food", "Coffee"), {
    emoji: "☕",
    color: "#F97316",
  });
  assert.deepEqual(categoryAppearance("Shopping", "Amazon"), {
    emoji: "📦",
    color: "#DB2777",
  });
  assert.deepEqual(categoryAppearance("Loans", "Car Loan"), {
    emoji: "🚙",
    color: "#A78BFA",
  });
  assert.deepEqual(categoryAppearance("Loans", "Mortgage"), {
    emoji: "🏠",
    color: "#7C3AED",
  });
  assert.deepEqual(categoryAppearance("FixedCosts", "Mobile phone"), {
    emoji: "📱",
    color: "#64748B",
  });
  assert.deepEqual(
    categoryAppearance("Beauty", "Miscellaneous"),
    categoryAppearance("Beauty"),
  );
  assert.deepEqual(
    categoryAppearance("Other", "Healthcare"),
    categoryAppearance("Healthcare"),
  );
});

test("a parent-named child is the parent", () => {
  assert.deepEqual(
    categoryAppearance("Outside Food", "outside-food"),
    categoryAppearance("Outside Food"),
  );
  assert.deepEqual(
    categoryAppearance("Shopping", "SHOPPING"),
    categoryAppearance("Shopping"),
  );
});

test("unknown names have deterministic normalized colors and keyword emojis", () => {
  assert.deepEqual(
    categoryAppearance("Moon Club"),
    categoryAppearance("MOON-CLUB"),
  );
  assert.deepEqual(
    categoryAppearance("Moon Club"),
    categoryAppearance("Moon Club"),
  );
  assert.equal(categoryAppearance("Moon Club").emoji, "🏷️");
  assert.match(categoryAppearance("Moon Club").color, /^#[\dA-F]{6}$/);
  assert.equal(categoryAppearance("Pet supplies").emoji, "🐾");
  assert.equal(categoryAppearance("Air travel").emoji, "✈️");
  assert.equal(categoryAppearance("Parking").emoji, "🅿️");
  assert.equal(categoryAppearance("Doctor visits").emoji, "🩺");
  for (const name of ["constructor", "toString"])
    assert.match(categoryAppearance(name).color, /^#[\dA-F]{6}$/);
  assert.deepEqual(
    categoryAppearance("Beauty", "constructor"),
    categoryAppearance("Beauty"),
  );
});

test("transaction kinds use category metadata only for spending", () => {
  configureFinance({
    categories: [
      {
        id: "loan-id",
        name: "Loans",
        icon: "car",
        color: "blue",
        children: [],
        childIds: {},
      },
    ],
    accounts: [],
    months: [],
  });
  const t = { category: "loan-id", subcategory: "CarLoan", kind: "expense" };
  assert.deepEqual(
    transactionAppearance(t),
    categoryAppearance("Loans", "CarLoan"),
  );
  assert.deepEqual(
    transactionAppearance({
      ...t,
      category: null,
      subcategory: "Uncategorized",
    }),
    categoryAppearance("Uncategorized"),
  );
  for (const [kind, emoji, color] of [
    ["income", "💵", "#047857"],
    ["transfer", "🔁", "#64748B"],
    ["investment", "📈", "#0284C7"],
  ])
    assert.deepEqual(transactionAppearance({ ...t, kind }), { emoji, color });
  assert.deepEqual(savedAppearance, { emoji: "💰", color: "#10B981" });
  assert.deepEqual(everythingElseAppearance, { emoji: "🧺", color: "#94A3B8" });
  assert.equal(tint("#10B981"), "color-mix(in srgb, #10B981 14%, white)");
  assert.equal(tint("#10B981", 16), "color-mix(in srgb, #10B981 16%, white)");
});
