const assert = require("node:assert/strict");
const { execFileSync } = require("node:child_process");
const { mkdtempSync, rmSync } = require("node:fs");
const { tmpdir } = require("node:os");
const path = require("node:path");
const { after, test } = require("node:test");

const output = mkdtempSync(path.join(tmpdir(), "money-wealth-"));
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
    "src/data/wealth.ts",
  ],
  { cwd: path.resolve(__dirname, ".."), stdio: "pipe" },
);
const {
  wealthAccounts,
  wealthAllocations,
  wealthHoldings,
  wealthHoldingTypes,
  sumDecimals,
} = require(path.join(output, "wealth.js"));
const { accountNickname } = require(path.join(output, "accounts.js"));
const { activeFilters, emptyFilters, filterTransactions } = require(
  path.join(output, "filters.js"),
);

const position = (patch = {}) => ({
  id: "stock",
  securityId: "example-security",
  name: "Example stock",
  ticker: "EXAMPLE",
  instrumentType: "stock",
  sourceUrl: null,
  quantity: "100.0",
  price: "6.0",
  value: "600.0",
  valueCents: 60000,
  currency: "USD",
  asOf: "2026-10-19",
  ...patch,
});
const account = (patch = {}) => ({
  id: "brokerage",
  name: "Brokerage",
  type: "Investment",
  classification: "asset",
  balanceCents: 100000,
  asOf: "2026-10-20T00:00:00Z",
  holdings: [position()],
  ...patch,
});

test("asset type drills through accounts to holdings without counting positions twice", () => {
  const { byAccount, byType } = wealthAllocations([
    account(),
    account({
      id: "checking",
      type: "Depository",
      balanceCents: 20000,
      holdings: [],
    }),
    account({ id: "history", balanceCents: null }),
    account({ id: "debt", classification: "liability", balanceCents: 10000 }),
  ]);
  assert.equal(byAccount.cents, 120000);
  assert.equal(byType.cents, 120000);
  assert.equal(byAccount.children.length, 2);
  const investment = byType.children.find((node) => node.id === "Investment");
  assert.equal(investment.cents, 100000);
  assert.equal(investment.children[0].children[0].code, "EXAMPLE");
  const [stock, remainder] = byAccount.children[0].children;
  assert.equal(stock.cents, 60000);
  assert.equal(remainder.name, "Unallocated balance");
  assert.equal(remainder.cents, 40000);
  assert.match(remainder.detail, /Cash or holdings/);
  assert.match(stock.detail, /^100 units/);
  assert.match(stock.detail, /Oct 19, 2026/);
});

test("holdings above the account valuation keep their values and explain the mismatch", () => {
  const { byAccount } = wealthAllocations([account({ balanceCents: 50000 })]);
  const brokerage = byAccount.children[0];
  assert.equal(byAccount.cents, 50000);
  assert.equal(brokerage.children.length, 1);
  assert.equal(brokerage.children[0].cents, 60000);
  assert.match(
    brokerage.note,
    /holdings total \$600\.00; account balance \$500\.00/,
  );
});

test("foreign holdings show native values without contributing invented USD amounts", () => {
  const { byAccount } = wealthAllocations([
    account({ holdings: [position({ currency: "EUR", valueCents: null })] }),
  ]);
  const [remainder, holding] = byAccount.children[0].children;
  assert.equal(holding.cents, 0);
  assert.match(holding.valueLabel, /€600/);
  assert.match(holding.detail, /USD value unavailable/);
  assert.equal(remainder.cents, 100000);
});

test("accounts without supplied positions remain explicit leaves", () => {
  const { byAccount } = wealthAllocations([account({ holdings: [] })]);
  const brokerage = byAccount.children[0];
  assert.equal(brokerage.children, undefined);
  assert.match(brokerage.detail, /Holdings not supplied/);
});

test("account lists and every allocation level use descending totals with unknown balances last", () => {
  const accounts = [
    account({ id: "history", balanceCents: null, holdings: [] }),
    account({ id: "brokerage", balanceCents: 60000, holdings: [] }),
    account({
      id: "checking",
      type: "Depository",
      balanceCents: 90000,
      holdings: [],
    }),
    account({
      id: "retirement",
      balanceCents: 70000,
      holdings: [
        position({ id: "small", valueCents: 10000, value: "100" }),
        position({ id: "large", valueCents: 20000, value: "200" }),
      ],
    }),
    account({ id: "negative", balanceCents: -100, holdings: [] }),
    account({ id: "zero", balanceCents: 0, holdings: [] }),
  ];
  const original = structuredClone(accounts);
  assert.deepEqual(
    wealthAccounts(accounts).map((item) => item.id),
    ["checking", "retirement", "brokerage", "zero", "negative", "history"],
  );
  const { byAccount, byType } = wealthAllocations(accounts);
  assert.deepEqual(
    byAccount.children.map((node) => node.id),
    ["checking", "retirement", "brokerage"],
  );
  assert.deepEqual(
    byAccount.children[1].children.map((node) => node.id),
    ["retirement:unallocated", "large", "small"],
  );
  assert.deepEqual(
    byType.children.map((node) => [node.id, node.cents]),
    [
      ["Investment", 130000],
      ["Depository", 90000],
    ],
  );
  assert.deepEqual(
    byType.children[0].children.map((node) => node.id),
    ["retirement", "brokerage"],
  );
  assert.deepEqual(accounts, original);
});

test("fund descriptions replace synthetic tickers and decimal quantities retain precision", () => {
  const { byAccount } = wealthAllocations([
    account({
      holdings: [
        position({
          ticker: "CUSTOM:EXAMPLE_123",
          name: "Retirement fund",
          quantity: "0.123456789012345678",
        }),
      ],
    }),
  ]);
  const holding = byAccount.children[0].children[0];
  assert.equal(holding.shortName, "Retirement fund");
  assert.equal(holding.code, undefined);
  assert.match(holding.detail, /^0\.123456789012345678 units/);
});

test("consolidation combines the same security across accounts with exact quantities", () => {
  const { holdings, totalCents, byInstrumentType } = wealthHoldings([
    account({
      name: "Brokerage · 1234",
      holdings: [position({ quantity: "0.123456789012345678" })],
    }),
    account({
      id: "ira",
      name: "IRA (9876)",
      holdings: [
        position({
          id: "ira-stock",
          quantity: "0.000000000000000001",
          valueCents: 20000,
          value: "200",
        }),
      ],
    }),
    account({ id: "debt", classification: "liability" }),
  ]);
  assert.equal(holdings.length, 1);
  assert.equal(holdings[0].quantity, "0.123456789012345679");
  assert.equal(holdings[0].valueCents, 80000);
  assert.equal(holdings[0].positions.length, 2);
  assert.deepEqual(
    holdings[0].positions.map((position) => position.accountName),
    ["Brokerage", "IRA"],
  );
  assert.equal(totalCents, 80000);
  assert.equal(byInstrumentType.cents, 80000);
  assert.equal(byInstrumentType.children[0].children[0].children.length, 2);
});

test("holdings retain distinct security identities and native currencies", () => {
  const { holdings, totalCents, foreignCount } = wealthHoldings([
    account({
      holdings: [
        position(),
        position({
          id: "foreign-listing",
          securityId: "other-exchange",
          valueCents: 10000,
          value: "100",
        }),
        position({
          id: "foreign-currency",
          currency: "EUR",
          valueCents: null,
          value: "300.01",
        }),
      ],
    }),
  ]);
  assert.equal(holdings.length, 3);
  assert.equal(totalCents, 70000);
  assert.equal(foreignCount, 1);
  assert.equal(
    holdings.find((holding) => holding.currency === "EUR").valueCents,
    null,
  );
});

test("holding groups, filters and account positions rank by combined value", () => {
  const shared = {
    securityId: "shared",
    name: "Shared fund",
    instrumentType: "etf",
  };
  const accounts = [
    account({
      id: "a",
      name: "A Account",
      holdings: [
        position({ ...shared, id: "small", valueCents: 10000, value: "100" }),
        position({ valueCents: 50000, value: "500" }),
      ],
    }),
    account({
      id: "z",
      name: "Z Account",
      holdings: [
        position({ ...shared, id: "large", valueCents: 60000, value: "600" }),
        position({
          id: "second",
          securityId: "second",
          instrumentType: "etf",
          valueCents: 20000,
          value: "200",
        }),
      ],
    }),
  ];
  const { holdings, byInstrumentType } = wealthHoldings(accounts);
  assert.deepEqual(
    holdings.map((holding) => holding.valueCents),
    [70000, 50000, 20000],
  );
  assert.deepEqual(
    holdings[0].positions.map((position) => position.accountName),
    ["Z Account", "A Account"],
  );
  assert.deepEqual(
    wealthHoldingTypes(holdings).map((type) => [type.type, type.valueCents]),
    [
      ["etf", 90000],
      ["stock", 50000],
    ],
  );
  const etfs = byInstrumentType.children[0];
  assert.equal(etfs.id, "instrument:etf");
  assert.deepEqual(
    etfs.children.map((node) => node.cents),
    [70000, 20000],
  );
  assert.deepEqual(
    etfs.children[0].children.map((node) => node.name),
    ["Z Account", "A Account"],
  );
});

test("instrument Sankey separates stocks, ETFs, mutual funds and unknown types", () => {
  const types = [
    "stock",
    "etf",
    "mutual_fund",
    "other_fund",
    "money_market",
    "unclassified",
  ];
  const { byInstrumentType, totalCents } = wealthHoldings([
    account({
      holdings: types.map((instrumentType, index) =>
        position({
          id: String(index),
          securityId: String(index),
          instrumentType,
          valueCents: 10000,
          value: "100",
        }),
      ),
    }),
  ]);
  assert.equal(totalCents, 60000);
  assert.deepEqual(
    byInstrumentType.children.map((node) => node.name),
    [
      "Individual stocks",
      "ETFs",
      "Mutual funds",
      "Other pooled funds",
      "Money market funds",
      "Unclassified",
    ],
  );
  assert.equal(
    byInstrumentType.children.reduce((sum, node) => sum + node.cents, 0),
    totalCents,
  );
});

test("decimal aggregation keeps integer trailing zeros and fractional precision", () => {
  assert.equal(sumDecimals(["100.0", "20"]), "120");
  assert.equal(
    sumDecimals(["0.000000000000000001", "0.000000000000000001"]),
    "0.000000000000000002",
  );
  assert.equal(sumDecimals(["0.99", "0.01"]), "1");
  assert.equal(sumDecimals([]), "0");
});

test("nicknames omit account masks without changing account types or filter identities", () => {
  for (const [name, expected] of [
    ["401k Alex · 12345", "401k Alex"],
    ["IRA (9876)", "IRA"],
    [
      "Cash Management (Individual - TOD) · 1234",
      "Cash Management (Individual - TOD)",
    ],
    ["Checking ending in 1234", "Checking"],
    ["Checking - ****1234", "Checking"],
    ["529 plan", "529 plan"],
    ["401k", "401k"],
  ])
    assert.equal(accountNickname(name), expected);
  const original = "Checking · 1234";
  const filters = { ...emptyFilters(), accounts: [original] };
  assert.equal(
    activeFilters(filters).find((chip) => chip.key === "accounts").label,
    "Checking",
  );
  assert.deepEqual(filters.accounts, [original]);
  const transaction = {
    id: "test",
    account: original,
    date: "2026-10-20",
    amountCents: 100,
    kind: "income",
    subcategory: "Income",
    name: "Deposit",
  };
  assert.equal(filterTransactions([transaction], filters).length, 1);
  assert.equal(
    filterTransactions(
      [{ ...transaction, account: "Checking · 5678" }],
      filters,
    ).length,
    0,
  );
});

test("account groups cover every Sure type and preserve every account", () => {
  const { accountGroups } = require(path.join(output, "wealth.js"));
  const inputs = [
    ["Depository", "Everyday cash", "Cash", "💵"],
    ["Investment", "Index portfolio", "Investments", "📈"],
    ["Crypto", "Digital wallet", "Crypto", "🪙"],
    ["Property", "Home", "Property", "🏡"],
    ["Vehicle", "Car", "Property", "🏡"],
    ["OtherAsset", "Collectibles", "Other assets", "🗃️"],
    ["Unknown", "Miscellaneous", "Other assets", "🗃️"],
    ["CreditCard", "Everyday card", "Credit cards", "💳"],
    ["Loan", "Mortgage", "Loans", "🧾"],
    ["OtherLiability", "Other debt", "Loans", "🧾"],
  ];
  const accounts = inputs.map(([type, name], index) =>
    account({ id: String(index), type, name, holdings: [] }),
  );
  const original = structuredClone(accounts);
  const groups = accountGroups(accounts);
  for (let index = 0; index < inputs.length; index++) {
    const group = groups.find((group) =>
      group.accounts.some((account) => account.id === String(index)),
    );
    assert.equal(group.label, inputs[index][2]);
    assert.equal(group.emoji, inputs[index][3]);
    assert.equal(group.liability, index >= 7);
  }
  assert.equal(groups.flatMap((group) => group.accounts).length, inputs.length);
  assert.equal(new Set(groups.map((group) => group.color)).size, groups.length);
  assert.deepEqual(accounts, original);
});

test("investment groups recognize retirement names and nicknames without partial words", () => {
  const { accountGroups } = require(path.join(output, "wealth.js"));
  const names = [
    "401k · 1234",
    "401(k) plan",
    "401 K account",
    "403b plan",
    "403 (b) plan",
    "Traditional IRA",
    "Roth account",
    "HSA",
    "Pension",
    "BrokerageLink",
  ];
  for (const name of names) {
    const [group] = accountGroups([account({ name })]);
    assert.equal(group.label, "Retirement", name);
  }
  for (const name of [
    "Mirage portfolio",
    "Growth investments",
    "HSABC",
    "IRAqi fund",
  ]) {
    assert.equal(accountGroups([account({ name })])[0].label, "Investments");
  }
  assert.equal(
    accountGroups([account({ type: "Depository", name: "Roth proceeds" })])[0]
      .label,
    "Cash",
  );
});

test("groups rank assets then debts by value and history last without inventing USD", () => {
  const { accountGroups } = require(path.join(output, "wealth.js"));
  const accounts = [
    account({ id: "unknown", name: "Imported history", balanceCents: null }),
    account({ id: "unconverted", name: "Foreign history", balanceCents: null }),
    account({ id: "cash-small", type: "Depository", balanceCents: 1000 }),
    account({ id: "cash-large", type: "Depository", balanceCents: 2000 }),
    account({ id: "home", type: "Property", balanceCents: 5000 }),
    account({ id: "card", type: "CreditCard", balanceCents: 6000 }),
    account({ id: "loan-small", type: "Loan", balanceCents: 4000 }),
    account({ id: "loan-large", type: "OtherLiability", balanceCents: 7000 }),
    account({
      id: "classified-debt",
      type: "Unknown",
      classification: "liability",
      balanceCents: 3000,
    }),
  ];
  const groups = accountGroups(accounts);
  assert.deepEqual(
    groups.map((group) => [group.label, group.totalCents]),
    [
      ["Property", 5000],
      ["Cash", 3000],
      ["Loans", 11000],
      ["Credit cards", 6000],
      ["Other assets", 3000],
      ["Not connected", 0],
    ],
  );
  assert.deepEqual(
    groups[1].accounts.map((account) => account.id),
    ["cash-large", "cash-small"],
  );
  assert.deepEqual(
    groups[2].accounts.map((account) => account.id),
    ["loan-large", "loan-small"],
  );
  assert.equal(groups[4].liability, true);
  assert.equal(groups.at(-1).accounts.length, 2);
  assert.equal(groups.at(-1).id, "history");
  assert.deepEqual(accountGroups([]), []);
  const zero = accountGroups([account({ balanceCents: 0 })]);
  assert.equal(zero[0].label, "Investments");
  assert.equal(zero[0].totalCents, 0);
});

test("classification marks normally asset-typed groups as liabilities", () => {
  const { accountGroups } = require(path.join(output, "wealth.js"));
  const groups = accountGroups([
    account({ type: "Depository", balanceCents: 1000 }),
    account({
      id: "overdraft",
      type: "Depository",
      classification: "liability",
      balanceCents: 9000,
    }),
  ]);
  assert.equal(groups[0].liability, false);
  assert.equal(groups[1].liability, true);
  assert.notEqual(groups[0].id, groups[1].id);
});

test("balance dates accept timestamps and date-only observations", () => {
  const { dateLabel } = require(path.join(output, "wealth.js"));
  assert.equal(dateLabel("2026-10-22T00:00:00Z", false), "Oct 22");
  assert.equal(dateLabel("2026-10-22"), "Oct 22, 2026");
});

test("liability groups keep signed balances so card credits reduce debt", () => {
  const { accountGroups, liabilityMoney } = require(
    path.join(output, "wealth.js"),
  );
  const [cards] = accountGroups([
    account({
      id: "owed",
      type: "CreditCard",
      classification: "liability",
      balanceCents: 10000,
    }),
    account({
      id: "credit",
      type: "CreditCard",
      classification: "liability",
      balanceCents: -4000,
    }),
  ]);
  assert.equal(cards.liability, true);
  assert.equal(cards.totalCents, 6000);
  assert.equal(liabilityMoney(6000), "−$60");
  assert.equal(liabilityMoney(-4000, true), "$40.00");
});
