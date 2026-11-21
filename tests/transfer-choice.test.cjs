const assert = require("node:assert/strict");
const { execFileSync } = require("node:child_process");
const { mkdtempSync, rmSync } = require("node:fs");
const { tmpdir } = require("node:os");
const path = require("node:path");
const { after, test } = require("node:test");

const output = mkdtempSync(path.join(tmpdir(), "money-transfer-"));
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
    "src/data/pendingEdits.ts",
  ],
  { cwd: path.resolve(__dirname, ".."), stdio: "pipe" },
);
const {
  applyTransactionPatch,
  transactionType,
  transactionTypeOptions,
  transactionTypePatch,
} = require(path.join(output, "review.js"));
const { editLabel } = require(path.join(output, "pendingEdits.js"));

const row = (kind, amountCents) => ({
  id: `${kind}-${amountCents}`,
  name: "Northwind Deposit",
  date: "2026-11-01",
  amountCents,
  kind,
  category: null,
  subcategory: "Uncategorized",
  account: "Joint Checking",
  reviewed: false,
  categorization: null,
});

test("inflows choose income, refund or transfer and outflows spending or transfer", () => {
  assert.deepEqual(
    transactionTypeOptions(row("income", 500)).map((option) => option.value),
    ["income", "refund", "transfer"],
  );
  assert.deepEqual(
    transactionTypeOptions(row("expense", -500)).map((option) => option.label),
    ["Spending", "Transfer"],
  );
  assert.equal(transactionType(row("income", 500)), "income");
  assert.equal(transactionType(row("expense", 500)), "refund");
  assert.equal(transactionType(row("expense", -500)), "spending");
  assert.equal(transactionType(row("transfer", 500)), "transfer");
  assert.equal(transactionType(row("transfer", -500)), "transfer");
});

test("type choices send the transfer choice and the inflow flow together", () => {
  assert.deepEqual(transactionTypePatch(row("income", 500), "transfer"), {
    transfer: true,
  });
  assert.deepEqual(transactionTypePatch(row("transfer", -500), "spending"), {
    transfer: false,
  });
  assert.deepEqual(transactionTypePatch(row("transfer", 500), "refund"), {
    transfer: false,
    flow: "refund",
  });
  assert.deepEqual(transactionTypePatch(row("expense", 500), "income"), {
    flow: "income",
  });
});

test("transfer choices update the row immediately and name the change", () => {
  const income = row("income", 500);
  assert.equal(
    applyTransactionPatch(income, { transfer: true }).kind,
    "transfer",
  );
  assert.equal(
    applyTransactionPatch(row("transfer", -500), { transfer: false }).kind,
    "expense",
  );
  const refund = applyTransactionPatch(row("transfer", 500), {
    transfer: false,
    flow: "refund",
  });
  assert.equal(refund.kind, "expense");
  assert.equal(refund.reviewed, true);
  assert.equal("transfer" in refund, false);
  assert.equal(editLabel(income, { transfer: true }), "Marked as transfer");
  assert.equal(editLabel(income, { transfer: false }), "Marked as spending");
  assert.equal(
    editLabel(income, { transfer: false, flow: "income" }),
    "Marked as income",
  );
});
