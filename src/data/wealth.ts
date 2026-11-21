import { accountNickname } from "./accounts";
import type { AllocationNode } from "./allocation";
import type { WealthAccount, WealthHolding } from "./api";
import { money } from "./finance";

const colors = ["blue", "purple", "green", "orange", "pink", "gray"];

export type AccountGroup = {
  id: string;
  label: string;
  emoji: string;
  color: string;
  liability: boolean;
  totalCents: number;
  accounts: WealthAccount[];
};

const groupDefinitions = {
  cash: { label: "Cash", emoji: "💵", color: "#10B981" },
  investments: { label: "Investments", emoji: "📈", color: "#2F6FEB" },
  retirement: { label: "Retirement", emoji: "🏦", color: "#06B6D4" },
  crypto: { label: "Crypto", emoji: "🪙", color: "#F59E0B" },
  property: { label: "Property", emoji: "🏡", color: "#7C3AED" },
  other: { label: "Other assets", emoji: "🗃️", color: "#94A3B8" },
  cards: { label: "Credit cards", emoji: "💳", color: "#F43F5E" },
  loans: { label: "Loans", emoji: "🧾", color: "#EF4444" },
  history: { label: "Not connected", emoji: "🔌", color: "#94A3B8" },
};
const retirementName =
  /\b(401\s?\(?k\)?|403\s?\(?b\)?|ira|roth|hsa|pension|brokeragelink)\b/i;
const isLiability = (account: WealthAccount) =>
  account.classification === "liability" ||
  ["CreditCard", "Loan", "OtherLiability"].includes(account.type);

function accountGroupKey(
  account: WealthAccount,
): keyof typeof groupDefinitions {
  if (account.balanceCents === null) return "history";
  switch (account.type) {
    case "Depository":
      return "cash";
    case "Investment":
      return retirementName.test(account.name) ||
        retirementName.test(accountNickname(account.name))
        ? "retirement"
        : "investments";
    case "Crypto":
      return "crypto";
    case "Property":
    case "Vehicle":
      return "property";
    case "CreditCard":
      return "cards";
    case "Loan":
    case "OtherLiability":
      return "loans";
    default:
      return "other";
  }
}

// Owed liability balances read as negative; a credit balance reads as money held.
export const liabilityMoney = (cents: number, showCents = false) =>
  cents > 0 ? `−${money(cents, showCents)}` : money(-cents, showCents);

export function accountGroups(accounts: WealthAccount[]): AccountGroup[] {
  const groups = new Map<string, AccountGroup>();
  for (const account of accounts) {
    const key = accountGroupKey(account);
    const liability = key !== "history" && isLiability(account);
    const id = `${key}${liability ? ":liability" : ""}`;
    const group = groups.get(id) ?? {
      id,
      ...groupDefinitions[key],
      liability,
      totalCents: 0,
      accounts: [],
    };
    // Only API-normalized USD cents enter totals; missing FX stays unknown.
    // Liability balances are signed like the API's debt: positive is owed, and an
    // overpaid card's credit reduces its group's debt.
    group.totalCents += account.balanceCents ?? 0;
    group.accounts.push(account);
    groups.set(id, group);
  }
  return [...groups.values()]
    .map((group) => ({
      ...group,
      accounts: group.liability
        ? [...group.accounts].sort(
            (a, b) =>
              Math.abs(b.balanceCents ?? 0) - Math.abs(a.balanceCents ?? 0) ||
              accountNickname(a.name).localeCompare(accountNickname(b.name)),
          )
        : wealthAccounts(group.accounts),
    }))
    .sort(
      (a, b) =>
        Number(a.id === "history") - Number(b.id === "history") ||
        Number(a.liability) - Number(b.liability) ||
        b.totalCents - a.totalCents ||
        a.label.localeCompare(b.label),
    );
}

function compareValues(a: number | null, b: number | null) {
  if (a === null) return b === null ? 0 : 1;
  if (b === null) return -1;
  return b - a;
}

function sortAllocation(node: AllocationNode): AllocationNode {
  return {
    ...node,
    children: node.children
      ?.map(sortAllocation)
      .sort((a, b) => b.cents - a.cents),
  };
}

export function wealthAccounts(accounts: WealthAccount[]) {
  return [...accounts].sort(
    (a, b) =>
      compareValues(a.balanceCents, b.balanceCents) ||
      accountNickname(a.name).localeCompare(accountNickname(b.name)),
  );
}

export const dateLabel = (date: string, includeYear = true) =>
  new Date(`${date.slice(0, 10)}T12:00:00`).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    ...(includeYear ? { year: "numeric" as const } : {}),
  });
export const nativeMoney = (amount: string, currency: string) =>
  new Intl.NumberFormat("en-US", {
    style: "currency",
    currency,
    maximumFractionDigits: 4,
  }).format(Number(amount));

function holdingNode(holding: WealthHolding, index: number): AllocationNode {
  const ticker = holding.ticker.startsWith("CUSTOM:")
    ? undefined
    : holding.ticker;
  return {
    id: holding.id,
    name: holding.name,
    shortName: ticker ?? holding.name,
    code: ticker === holding.name ? undefined : ticker,
    color: colors[index % colors.length],
    cents: holding.valueCents ?? 0,
    valueLabel:
      holding.valueCents === null
        ? nativeMoney(holding.value, holding.currency)
        : money(holding.valueCents, true),
    detail: `${holding.quantity.replace(/(\.\d*?[1-9])0+$|\.0+$/, "$1")} units · ${nativeMoney(holding.price, holding.currency)}/unit · ${dateLabel(holding.asOf)}${holding.valueCents === null ? " · USD value unavailable" : ""}`,
  };
}

function accountNode(account: WealthAccount, index: number): AllocationNode {
  const children = account.holdings.map(holdingNode);
  const reported = children.reduce((sum, child) => sum + child.cents, 0);
  const balance = account.balanceCents ?? 0;
  let note: string | undefined;
  if (children.length) {
    if (balance > reported) {
      children.push({
        id: `${account.id}:unallocated`,
        name: "Unallocated balance",
        shortName: "Unallocated",
        color: "gray",
        cents: balance - reported,
        valueLabel: money(balance - reported, true),
        detail: "Cash or holdings not supplied with a USD value.",
      });
    } else if (reported > balance) {
      note = `Reported holdings total ${money(reported, true)}; account balance ${money(balance, true)}. Allocation uses reported holdings values, which may have a different valuation date.`;
    }
  }
  return {
    id: account.id,
    name: accountNickname(account.name),
    shortName: accountNickname(account.name),
    cents: balance,
    color: colors[index % colors.length],
    children: children.length ? children : undefined,
    detail:
      !children.length && ["Investment", "Crypto"].includes(account.type)
        ? "Holdings not supplied by this connection"
        : undefined,
    note,
  };
}

export function wealthAllocations(accounts: WealthAccount[]) {
  const assets = accounts.filter(
    (account) =>
      account.classification === "asset" && (account.balanceCents ?? 0) > 0,
  );
  const children = assets.map(accountNode);
  const byAccount: AllocationNode = {
    id: "assets",
    name: "Observed assets",
    shortName: "Assets",
    color: "blue",
    cents: children.reduce((sum, account) => sum + account.cents, 0),
    children,
  };
  const types = [...new Set(assets.map((account) => account.type))];
  const byType: AllocationNode = {
    ...byAccount,
    id: "types",
    children: types.map((type, index) => {
      const accounts = children.filter((_, i) => assets[i].type === type);
      return {
        id: type,
        name: type,
        shortName: type,
        color: colors[index % colors.length],
        cents: accounts.reduce((sum, account) => sum + account.cents, 0),
        children: accounts,
      };
    }),
  };
  return {
    byAccount: sortAllocation(byAccount),
    byType: sortAllocation(byType),
  };
}

export const instrumentTypes: Record<string, { label: string; color: string }> =
  {
    stock: { label: "Individual stocks", color: "blue" },
    etf: { label: "ETFs", color: "purple" },
    mutual_fund: { label: "Mutual funds", color: "green" },
    other_fund: { label: "Other pooled funds", color: "orange" },
    money_market: { label: "Money market funds", color: "pink" },
    bond: { label: "Bonds", color: "green" },
    cryptocurrency: { label: "Crypto", color: "orange" },
    cash: { label: "Cash", color: "gray" },
    other: { label: "Other holdings", color: "gray" },
    unclassified: { label: "Unclassified", color: "gray" },
  };
export const instrumentLabel = (type: string) =>
  (instrumentTypes[type] ?? instrumentTypes.unclassified).label;

// Decimal strings come from Rails. Sum them without losing fractional units or
// combining native currencies; only explicit USD cents contribute to USD charts.
export function sumDecimals(values: string[]) {
  const scale = Math.max(
    0,
    ...values.map((value) => value.split(".")[1]?.length ?? 0),
  );
  const total = values.reduce((sum, value) => {
    const [whole, fraction = ""] = value.split(".");
    return sum + BigInt(`${whole}${fraction.padEnd(scale, "0")}`);
  }, 0n);
  const digits = (total < 0n ? -total : total)
    .toString()
    .padStart(scale + 1, "0");
  const decimal = scale
    ? `.${digits.slice(-scale)}`.replace(/0+$/, "").replace(/\.$/, "")
    : "";
  return `${total < 0n ? "-" : ""}${scale ? digits.slice(0, -scale) : digits}${decimal}`;
}

export type HoldingPosition = WealthHolding & {
  accountId: string;
  accountName: string;
};
export type CombinedHolding = {
  id: string;
  name: string;
  ticker: string;
  instrumentType: string;
  currency: string;
  quantity: string;
  value: string;
  valueCents: number | null;
  positions: HoldingPosition[];
};

export function wealthHoldingTypes(holdings: CombinedHolding[]) {
  return Object.entries(instrumentTypes)
    .filter(([type]) =>
      holdings.some((holding) => holding.instrumentType === type),
    )
    .map(([type, definition]) => {
      const values = holdings
        .filter((holding) => holding.instrumentType === type)
        .flatMap((holding) => holding.valueCents ?? []);
      return {
        type,
        ...definition,
        valueCents: values.length
          ? values.reduce((sum, value) => sum + value, 0)
          : null,
      };
    })
    .sort((a, b) => compareValues(a.valueCents, b.valueCents));
}

export function wealthHoldings(accounts: WealthAccount[]) {
  const grouped = new Map<string, CombinedHolding>();
  for (const account of accounts.filter(
    (account) => account.classification === "asset",
  )) {
    for (const holding of account.holdings) {
      const id = `${holding.securityId}:${holding.currency}`;
      const group = grouped.get(id) ?? {
        id,
        name: holding.name,
        ticker: holding.ticker,
        instrumentType: instrumentTypes[holding.instrumentType]
          ? holding.instrumentType
          : "unclassified",
        currency: holding.currency,
        quantity: "0",
        value: "0",
        valueCents: holding.valueCents === null ? null : 0,
        positions: [],
      };
      group.positions.push({
        ...holding,
        accountId: account.id,
        accountName: accountNickname(account.name),
      });
      grouped.set(id, group);
    }
  }
  const holdings = [...grouped.values()]
    .map((holding) => ({
      ...holding,
      positions: holding.positions.sort(
        (a, b) =>
          Number(b.value) - Number(a.value) ||
          a.accountName.localeCompare(b.accountName),
      ),
      quantity: sumDecimals(
        holding.positions.map((position) => position.quantity),
      ),
      value: sumDecimals(holding.positions.map((position) => position.value)),
      valueCents: holding.positions.every(
        (position) => position.valueCents !== null,
      )
        ? holding.positions.reduce(
            (sum, position) => sum + (position.valueCents ?? 0),
            0,
          )
        : null,
    }))
    .sort(
      (a, b) =>
        compareValues(a.valueCents, b.valueCents) ||
        a.name.localeCompare(b.name),
    );
  const children: AllocationNode[] = Object.entries(instrumentTypes).flatMap(
    ([type, { label, color }]) => {
      const items = holdings.filter(
        (holding) =>
          holding.instrumentType === type && (holding.valueCents ?? 0) > 0,
      );
      if (!items.length) return [];
      return [
        {
          id: `instrument:${type}`,
          name: label,
          shortName: label,
          color,
          cents: items.reduce(
            (sum, holding) => sum + (holding.valueCents ?? 0),
            0,
          ),
          children: items.map((holding) => ({
            id: holding.id,
            name: holding.name,
            shortName: holding.ticker.startsWith("CUSTOM:")
              ? holding.name
              : holding.ticker,
            cents: holding.valueCents ?? 0,
            color,
            children:
              holding.positions.length > 1
                ? holding.positions.map((position) => ({
                    ...holdingNode(position, 0),
                    id: `${holding.id}:${position.accountId}`,
                    name: position.accountName,
                    shortName: position.accountName,
                    color,
                  }))
                : undefined,
          })),
        },
      ];
    },
  );
  const totalCents = holdings.reduce(
    (sum, holding) => sum + (holding.valueCents ?? 0),
    0,
  );
  return {
    holdings,
    totalCents,
    foreignCount: holdings.filter((holding) => holding.valueCents === null)
      .length,
    byInstrumentType: sortAllocation({
      id: "holdings",
      name: "Reported holdings",
      shortName: "Holdings",
      color: "blue",
      cents: totalCents,
      children,
    }),
  };
}

// Connected balances older than this get a visible warning on Wealth.
export const STALE_BALANCE_DAYS = 3;
export function balanceAgeDays(observedAt: string | null, today: string) {
  if (!observedAt) return null;
  // observedAt may be a full timestamp; compare calendar days.
  const days = Math.round(
    (new Date(`${today.slice(0, 10)}T12:00:00`).getTime() -
      new Date(`${observedAt.slice(0, 10)}T12:00:00`).getTime()) /
      86_400_000,
  );
  return Number.isFinite(days) ? Math.max(0, days) : null;
}
