const assert = require("node:assert/strict");
const { execFileSync } = require("node:child_process");
const { mkdtempSync, rmSync } = require("node:fs");
const { tmpdir } = require("node:os");
const path = require("node:path");
const { after, test } = require("node:test");

const output = mkdtempSync(path.join(tmpdir(), "money-merchant-"));
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
    "src/data/merchant.ts",
  ],
  { cwd: path.resolve(__dirname, ".."), stdio: "pipe" },
);
const { displayName } = require(path.join(output, "merchant.js"));

test("bank and imported descriptions split at the first separator", () => {
  assert.deepEqual(displayName("Costco - COSTCO WHSE #0000"), {
    title: "Costco",
    detail: "COSTCO WHSE #0000",
  });
  assert.deepEqual(displayName("Maple Cafe - River St - Terminal 2"), {
    title: "Maple Cafe",
    detail: "River St - Terminal 2",
  });
  assert.deepEqual(displayName("  Maple   Cafe\n -  River\t St  "), {
    title: "Maple Cafe",
    detail: "River St",
  });
});

test("plain, empty and incomplete names stay whole", () => {
  for (const [raw, title] of [
    ["Maple Cafe", "Maple Cafe"],
    ["  ", ""],
    ["Maple - ", "Maple -"],
    [" - Maple", "- Maple"],
    ["Maple-Cafe", "Maple-Cafe"],
  ])
    assert.deepEqual(displayName(raw), { title, detail: null });
});

test("equivalent details are hidden ignoring punctuation and case", () => {
  assert.deepEqual(displayName("Maple Cafe - MAPLE CAFE!"), {
    title: "Maple Cafe",
    detail: null,
  });
  assert.deepEqual(displayName("COSTCO - Costco"), {
    title: "Costco",
    detail: null,
  });
});

test("all caps titles with at least four letters become title case", () => {
  assert.deepEqual(displayName("MAPLE CAFE - RAW BANK PAYROLL 123"), {
    title: "Maple Cafe",
    detail: "RAW BANK PAYROLL 123",
  });
  assert.equal(displayName("CAFE #123").title, "Cafe #123");
  assert.equal(displayName("MAPLE'S MARKET").title, "Maple's Market");
  assert.equal(displayName("ATM").title, "ATM");
  assert.equal(displayName("eBay Store").title, "eBay Store");
  assert.equal(displayName("12345").title, "12345");
});
