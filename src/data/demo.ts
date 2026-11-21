export type CategoryId = "housing" | "food" | "bills" | "transport" | "other";
export type Tab = "flow" | "wealth" | "activity" | "categories";
export type Transaction = {
  id: string;
  name: string;
  date: string;
  amountCents: number;
  kind: "expense" | "income" | "transfer";
  category: CategoryId | null;
  subcategory: string;
  account: string;
  reviewed: boolean;
  pending?: boolean;
  excluded?: boolean;
  notes?: string;
};

export const categories: {
  id: CategoryId;
  name: string;
  icon: "house" | "utensils" | "zap" | "car" | "shopping-bag";
  color: string;
  children: string[];
}[] = [
  {
    id: "housing",
    name: "Housing",
    icon: "house",
    color: "blue",
    children: ["Mortgage", "Insurance", "Maintenance"],
  },
  {
    id: "food",
    name: "Food & dining",
    icon: "utensils",
    color: "orange",
    children: ["Groceries", "Eating out"],
  },
  {
    id: "bills",
    name: "Bills",
    icon: "zap",
    color: "purple",
    children: ["Utilities", "Phone & subscriptions"],
  },
  {
    id: "transport",
    name: "Transport",
    icon: "car",
    color: "pink",
    children: ["Fuel", "Transit & car costs"],
  },
  {
    id: "other",
    name: "Other spending",
    icon: "shopping-bag",
    color: "gray",
    children: ["Shopping", "Personal & leisure"],
  },
];

export const months = Array.from({ length: 10 }, (_, index) => {
  const date = new Date(2026, index, 1);
  const short = date.toLocaleDateString("en-US", { month: "long" });
  const abbreviation = date.toLocaleDateString("en-US", { month: "short" });
  const lastDay = index === 9 ? 14 : new Date(2026, index + 1, 0).getDate();
  return {
    id: `2026-${String(index + 1).padStart(2, "0")}`,
    label: `${short} 2026`,
    short,
    period: `${abbreviation} 1–${lastDay}`,
    asOf: index === 9 ? "Month to date" : "Full month",
  };
});

type SeedRow = [string, number, CategoryId, string, number];
const expenses: SeedRow[] = [
  ["Home mortgage", 240000, "housing", "Mortgage", 1],
  ["Home insurance", 30000, "housing", "Insurance", 3],
  ["Home repairs", 50000, "housing", "Maintenance", 8],
  ["Whole Foods", 12640, "food", "Groceries", 13],
  ["Trader Joe’s", 18435, "food", "Groceries", 10],
  ["Costco", 20725, "food", "Groceries", 6],
  ["Local market", 14800, "food", "Groceries", 4],
  ["Whole Foods", 25400, "food", "Groceries", 2],
  ["Neighborhood restaurant", 7200, "food", "Eating out", 11],
  ["Friday dinner", 8420, "food", "Eating out", 9],
  ["Family brunch", 12380, "food", "Eating out", 7],
  ["Dinner with friends", 18000, "food", "Eating out", 5],
  ["Weekend takeout", 12000, "food", "Eating out", 3],
  ["Electric company", 8420, "bills", "Utilities", 12],
  ["Water utility", 6400, "bills", "Utilities", 8],
  ["Home internet", 8500, "bills", "Utilities", 5],
  ["Annual utility settlement", 44680, "bills", "Utilities", 2],
  ["Family mobile plan", 18500, "bills", "Phone & subscriptions", 6],
  ["Annual subscriptions", 13000, "bills", "Phone & subscriptions", 4],
  ["Streaming & cloud", 5500, "bills", "Phone & subscriptions", 1],
  ["Shell", 6500, "transport", "Fuel", 12],
  ["Chevron", 5500, "transport", "Fuel", 7],
  ["Shell", 6000, "transport", "Fuel", 2],
  ["Car insurance", 22000, "transport", "Transit & car costs", 3],
  ["Transit pass", 6000, "transport", "Transit & car costs", 1],
  ["Car service", 19000, "transport", "Transit & car costs", 9],
  ["Local shop", 4875, "other", "Shopping", 10],
  ["Household essentials", 22000, "other", "Shopping", 8],
  ["Home store", 33125, "other", "Shopping", 4],
  ["Family fitness", 12000, "other", "Personal & leisure", 1],
  ["Cinema & activities", 6800, "other", "Personal & leisure", 6],
  ["Weekend activities", 21200, "other", "Personal & leisure", 12],
];

function monthTransactions(month: string): Transaction[] {
  const previous = month !== "2026-10";
  const monthNumber = Number(month.slice(-2));
  const targets: Record<CategoryId, number> = previous
    ? {
        housing: 380000,
        food: 170000,
        bills: 125000,
        transport: 75000,
        other: 140000,
      }
    : {
        housing: 320000,
        food: 150000,
        bills: 105000,
        transport: 65000,
        other: 100000,
      };
  if (monthNumber < 9) {
    targets.housing = 310000 + monthNumber * 3200;
    targets.food = 125000 + monthNumber * 3700;
    targets.bills = 91000 + monthNumber * 1800;
    targets.transport = 47000 + monthNumber * 1900;
    targets.other = 79000 + monthNumber * 4100;
  }
  const result: Transaction[] = [];
  for (const category of categories) {
    const rows = expenses.filter((row) => row[2] === category.id);
    const original = rows.reduce((sum, row) => sum + row[1], 0);
    let allocated = 0;
    rows.forEach(([name, value, id, subcategory, day], index) => {
      const cents =
        index === rows.length - 1
          ? targets[id] - allocated
          : Math.round((value / original) * targets[id]);
      allocated += cents;
      result.push({
        id: `${month}-${id}-${index}`,
        name,
        date: `${month}-${String(day).padStart(2, "0")}`,
        amountCents: -cents,
        kind: "expense",
        category: id,
        subcategory,
        account:
          id === "housing" || id === "bills"
            ? "Checking · 1234"
            : "Credit card · 5678",
        reviewed: name !== "Local shop",
      });
    });
  }
  [500000, 500000, previous ? 160000 : 180000].forEach((value, index) =>
    result.push({
      id: `${month}-income-${index}`,
      name: index < 2 ? "Payroll" : "Freelance income",
      date: `${month}-${["01", "14", "08"][index]}`,
      amountCents: value,
      kind: "income",
      category: null,
      subcategory: "Income",
      account: "Checking · 1234",
      reviewed: true,
    }),
  );
  result.push({
    id: `${month}-transfer`,
    name: "Transfer to savings",
    date: `${month}-10`,
    amountCents: -100000,
    kind: "transfer",
    category: null,
    subcategory: "Transfer",
    account: "Checking → Savings",
    reviewed: true,
  });
  if (!previous)
    result.push({
      id: `${month}-pending`,
      name: "Neighborhood café",
      date: `${month}-14`,
      amountCents: -1840,
      kind: "expense",
      category: "food",
      subcategory: "Eating out",
      account: "Credit card · 5678",
      reviewed: true,
      pending: true,
    });
  return result;
}

export const seedTransactions = months.flatMap((month) =>
  monthTransactions(month.id),
);

export const assetGroups = [
  {
    id: "index",
    name: "Index funds",
    color: "blue",
    holdings: [
      {
        name: "VTI · US total market",
        account: "Brokerage",
        valueCents: 9500000,
      },
      {
        name: "VTI · US total market",
        account: "Retirement",
        valueCents: 7000000,
      },
      {
        name: "VXUS · International index",
        account: "Retirement",
        valueCents: 8000000,
      },
    ],
  },
  {
    id: "stocks",
    name: "Individual stocks",
    color: "purple",
    holdings: [
      { name: "AAPL · Apple", account: "Brokerage", valueCents: 4000000 },
      { name: "MSFT · Microsoft", account: "Brokerage", valueCents: 3000000 },
    ],
  },
  {
    id: "property",
    name: "Real estate",
    color: "green",
    holdings: [
      {
        name: "Our home",
        account: "Home",
        valueCents: 41000000,
      },
    ],
  },
  {
    id: "cash",
    name: "Cash",
    color: "orange",
    holdings: [
      { name: "Checking", account: "Checking", valueCents: 1800000 },
      { name: "Savings", account: "Savings", valueCents: 5500000 },
      {
        name: "Brokerage cash",
        account: "Brokerage",
        valueCents: 700000,
      },
    ],
  },
  {
    id: "other",
    name: "Other investments",
    color: "gray",
    holdings: [
      { name: "Bond funds", account: "Retirement", valueCents: 6000000 },
    ],
  },
];
export const totalAssets = assetGroups.reduce(
  (sum, group) =>
    sum +
    group.holdings.reduce((value, holding) => value + holding.valueCents, 0),
  0,
);
export const totalDebt = 23500000;
export const wealthHistory = [
  51000000, 51200000, 52100000, 53000000, 54100000, 54600000, 55100000,
  56500000, 57400000, 60100000, 61500000, 63000000,
];

export function monthSummary(transactions: Transaction[], month: string) {
  const rows = transactions.filter(
    (t) =>
      t.date.startsWith(month) &&
      !t.pending &&
      !t.excluded &&
      t.kind !== "transfer",
  );
  const income = rows
    .filter((t) => t.kind === "income")
    .reduce((sum, t) => sum + t.amountCents, 0);
  const spending = -rows
    .filter((t) => t.kind === "expense")
    .reduce((sum, t) => sum + t.amountCents, 0);
  const groups = categories.map((category) => ({
    ...category,
    cents: -rows
      .filter((t) => t.category === category.id && t.kind === "expense")
      .reduce((sum, t) => sum + t.amountCents, 0),
    breakdown: category.children.map((name) => ({
      id: `${category.id}|${name}`,
      name,
      color: category.color,
      cents: -rows
        .filter(
          (t) =>
            t.category === category.id &&
            t.subcategory === name &&
            t.kind === "expense",
        )
        .reduce((sum, t) => sum + t.amountCents, 0),
    })),
  }));
  return { income, spending, savings: income - spending, groups };
}

export const money = (cents: number, decimals = false) =>
  new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: decimals ? 2 : 0,
    maximumFractionDigits: decimals ? 2 : 0,
  }).format(cents / 100);
export const signedMoney = (cents: number) =>
  `${cents < 0 ? "−" : "+"}${money(Math.abs(cents), true)}`;
export const shortDate = (date: string) =>
  new Date(`${date}T12:00:00`).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
  });
