import type { WealthAccount, WealthHolding } from "../data/api";
import type { Category, Transaction } from "../data/finance";
import type { MoneyRule } from "../data/rules";

// A fictional two-income household for the public demo. Every name, account
// and amount is invented. Each month is generated from its own seed, so a month
// looks the same on every visit while the history always ends on today.

export const HISTORY_MONTHS = 30;
const REVIEW_WINDOW_DAYS = 10;

type Kind = Transaction["kind"];
type Draft = {
  date: string;
  name: string;
  cents: number;
  account: string;
  kind: Kind;
  group?: string;
  child?: string;
  principalCents?: number;
  excluded?: boolean;
};

export const accountNames = {
  checking: "Everyday Checking · 4821",
  savings: "High-Yield Savings · 7730",
  cashback: "Cashback Visa · 1093",
  travel: "Travel Rewards Card · 5512",
  brokerage: "Brokerage · 2290",
  alex401k: "Alex 401(k)",
  sam401k: "Sam 401(k)",
  roth: "Roth IRA · 6604",
  hsa: "HSA · 3158",
  crypto: "Crypto Wallet",
  home: "Home",
  vehicle: "Family SUV",
  mortgage: "Mortgage · 0042",
  carLoan: "Auto Loan · 3307",
};
const A = accountNames;

const catalogSpec: [string, Category["icon"], string[]][] = [
  ["Car", "car", ["Gas", "Parking", "Service"]],
  ["Dining out", "utensils", ["Restaurants", "Coffee", "Delivery"]],
  ["Education", "shopping-bag", ["Childcare", "Kids' activities", "Books"]],
  ["Entertainment", "shopping-bag", ["Events", "Games"]],
  ["Fitness", "shopping-bag", []],
  ["Gifts", "shopping-bag", ["Donations"]],
  ["Groceries", "utensils", []],
  ["Healthcare", "shopping-bag", ["Pharmacy", "Doctor"]],
  ["Home Improvement", "house", ["Furniture", "Repairs"]],
  ["Insurance", "shopping-bag", ["Auto insurance", "Life insurance"]],
  ["Investment Contributions", "shopping-bag", []],
  ["Loans", "house", ["Mortgage", "Car loan"]],
  ["Shopping", "shopping-bag", ["Amazon", "Clothing", "Kids"]],
  ["Subscriptions", "zap", ["Streaming", "Software"]],
  ["Taxes", "shopping-bag", []],
  ["Transportation", "car", ["Rideshare", "Transit"]],
  ["Travel & Vacation", "shopping-bag", ["Flights", "Hotels"]],
  ["Utilities", "zap", ["Electric", "Water", "Internet", "Phone"]],
  ["Work Expenses", "shopping-bag", []],
];
const COLORS = ["blue", "orange", "purple", "pink", "gray", "green"];
const slug = (name: string) =>
  name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");

export function demoCatalog(): Category[] {
  const roots = [...catalogSpec].sort(([a], [b]) => a.localeCompare(b));
  return [
    ...roots.map(([name, icon, children], index) => {
      const id = slug(name);
      return {
        id,
        name,
        icon,
        color: COLORS[index % COLORS.length],
        children: [name, ...children],
        childIds: Object.fromEntries([
          [name, id],
          ...children.map((child) => [child, `${id}:${slug(child)}`]),
        ]),
      };
    }),
    {
      id: "uncategorized",
      name: "Uncategorized",
      icon: "shopping-bag",
      color: "gray",
      children: ["Uncategorized"],
      childIds: { Uncategorized: null },
    },
  ];
}

// Deterministic randomness: mulberry32 seeded by an FNV-1a hash of a key.
function hash(text: string) {
  let value = 2166136261;
  for (let index = 0; index < text.length; index++) {
    value ^= text.charCodeAt(index);
    value = Math.imul(value, 16777619);
  }
  return value >>> 0;
}
function random(key: string) {
  let seed = hash(key);
  const next = () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return {
    next,
    chance: (probability: number) => next() < probability,
    int: (min: number, max: number) =>
      min + Math.floor(next() * (max - min + 1)),
    dollars: (min: number, max: number) =>
      Math.round((min + next() * (max - min)) * 100),
    pick: <T>(items: readonly T[]) => items[Math.floor(next() * items.length)],
  };
}
type Random = ReturnType<typeof random>;

function uuid(key: string) {
  const hex = [key, `${key}#b`, `${key}#c`, `${key}#d`]
    .map((part) => hash(part).toString(16).padStart(8, "0"))
    .join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-a${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}

const pad = (value: number) => String(value).padStart(2, "0");
const isoDate = (year: number, month: number, day: number) =>
  `${year}-${pad(month)}-${pad(day)}`;
const daysIn = (year: number, month: number) =>
  new Date(Date.UTC(year, month, 0)).getUTCDate();
const weekday = (year: number, month: number, day: number) =>
  new Date(Date.UTC(year, month - 1, day)).getUTCDay();
const dayNumber = (date: string) =>
  Date.parse(`${date}T00:00:00Z`) / 86_400_000;
const addMonths = (year: number, month: number, count: number) => {
  const index = year * 12 + (month - 1) + count;
  return { year: Math.floor(index / 12), month: (index % 12) + 1 };
};

// Fixed-rate amortization; the principal part of each payment counts as Saved.
type LoanTerms = {
  principal: number;
  rate: number;
  months: number;
  firstPayment: { year: number; month: number };
  day: number;
};
const mortgageTerms: LoanTerms = {
  principal: 412_000,
  rate: 0.06125,
  months: 360,
  firstPayment: { year: 2022, month: 10 },
  day: 1,
};
const carLoanTerms: LoanTerms = {
  principal: 31_500,
  rate: 0.0549,
  months: 60,
  firstPayment: { year: 2024, month: 3 },
  day: 12,
};
function loanPayment(terms: LoanTerms, year: number, month: number) {
  const index =
    year * 12 +
    month -
    (terms.firstPayment.year * 12 + terms.firstPayment.month);
  if (index < 0 || index >= terms.months) return null;
  const rate = terms.rate / 12;
  const payment =
    Math.round(
      ((terms.principal * rate) / (1 - (1 + rate) ** -terms.months)) * 100,
    ) / 100;
  let balance = terms.principal;
  let interest = 0;
  for (let step = 0; step <= index; step++) {
    interest = Math.round(balance * rate * 100) / 100;
    balance = Math.round((balance - (payment - interest)) * 100) / 100;
  }
  return {
    paymentCents: Math.round(payment * 100),
    principalCents: Math.round((payment - interest) * 100),
    balanceCents: Math.round(balance * 100),
  };
}

const friends = ["JORDAN P", "CASEY L", "MORGAN T", "RILEY K", "AVERY S"];
const restaurants = [
  "Chipotle - CHIPOTLE 2291",
  "Pho Saigon - PHO SAIGON",
  "Blue Door Bistro - BLUE DOOR BISTRO",
  "Taqueria El Sol - TST* EL SOL",
  "Shake Shack - SHAKESHACK #414",
  "Sushi Kaito - SQ *SUSHI KAITO",
  "Pizzeria Nonna - PIZZERIA NONNA",
];
const coffee = [
  "Starbucks - STARBUCKS STORE 04471",
  "Blue Bottle Coffee - BLUE BOTTLE",
  "Corner Cafe - SQ *CORNER CAFE",
];
const clothing = [
  "Uniqlo - UNIQLO USA",
  "Old Navy - OLDNAVY US 5531",
  "REI - REI #47",
];
const gas = [
  "Shell - SHELL OIL 57442",
  "Chevron - CHEVRON 0091",
  "Costco Gas - COSTCO GAS #0114",
];
const electricBase = [
  180, 165, 130, 105, 95, 140, 210, 230, 170, 110, 125, 175,
];

function generateMonth(year: number, month: number, today: string): Draft[] {
  const r: Random = random(`month:${year}-${month}`);
  const drafts: Draft[] = [];
  const current = today.slice(0, 7) === `${year}-${pad(month)}`;
  const last = current ? Number(today.slice(8, 10)) : daysIn(year, month);
  const years = year - 2024 + (month - 1) / 12;
  const raise = (rate: number) => 1.0 + rate * Math.max(0, Math.floor(years));
  const add = (day: number, draft: Omit<Draft, "date">) => {
    const clamped = Math.min(Math.max(day, 1), daysIn(year, month));
    if (clamped <= last)
      drafts.push({ ...draft, date: isoDate(year, month, clamped) });
  };
  const spend = (
    day: number,
    name: string,
    cents: number,
    account: string,
    group: string,
    child?: string,
  ) =>
    add(day, { name, cents: -cents, account, kind: "expense", group, child });
  const transfer = (
    day: number,
    from: string,
    to: string,
    cents: number,
    names: [string, string],
  ) => {
    add(day, {
      name: names[0],
      cents: -cents,
      account: from,
      kind: "transfer",
    });
    add(day, { name: names[1], cents, account: to, kind: "transfer" });
  };
  const anyDay = () => r.int(1, daysIn(year, month));

  // Income
  const alexPay = Math.round(386_240 * raise(0.03));
  const alexMatch = Math.round(30_600 * raise(0.03));
  for (let day = 1; day <= daysIn(year, month); day++) {
    const sinceAnchor =
      dayNumber(isoDate(year, month, day)) - dayNumber("2024-01-05");
    if (sinceAnchor % 14 !== 0) continue;
    add(day, {
      name: "Northwind Labs - PAYROLL DIRECT DEP",
      cents: alexPay,
      account: A.checking,
      kind: "income",
    });
    add(day, {
      name: "Employee Contribution - NORTHWIND LABS 401K",
      cents: 61_200,
      account: A.alex401k,
      kind: "transfer",
    });
    add(day, {
      name: "Employer Match - NORTHWIND LABS 401K",
      cents: alexMatch,
      account: A.alex401k,
      kind: "transfer",
    });
  }
  const samPay = Math.round(294_815 * raise(0.035));
  for (const target of [15, daysIn(year, month)]) {
    let day = target;
    while (weekday(year, month, day) === 0 || weekday(year, month, day) === 6)
      day--;
    add(day, {
      name: "Brightline Health - PAYROLL",
      cents: samPay,
      account: A.checking,
      kind: "income",
    });
    add(day, {
      name: "Employee Contribution - BRIGHTLINE 401K",
      cents: 45_000,
      account: A.sam401k,
      kind: "transfer",
    });
  }
  add(daysIn(year, month), {
    name: "High-Yield Savings - INTEREST PAID",
    cents: Math.round((38 + years * 19 + r.next() * 6) * 100),
    account: A.savings,
    kind: "income",
  });
  for (let count = r.int(0, 2); count > 0; count--)
    add(anyDay(), {
      name: `Venmo - FROM ${r.pick(friends)}`,
      cents: r.dollars(18, 140),
      account: A.checking,
      kind: "income",
    });
  if (month === 3)
    add(14, {
      name: "Northwind Labs - ANNUAL BONUS",
      cents: Math.round(840_000 * raise(0.03)),
      account: A.checking,
      kind: "income",
    });
  if (month % 3 === 1)
    spend(
      9,
      "Harborview Hotel - HARBORVIEW HTL",
      r.dollars(240, 760),
      A.travel,
      "Work Expenses",
    );
  if (month % 3 === 2)
    add(r.int(18, 22), {
      name: "Northwind Labs - EXPENSE REIMB",
      cents: r.dollars(240, 760),
      account: A.checking,
      kind: "income",
      group: "Work Expenses",
    });

  // Housing and loans
  const mortgage = loanPayment(mortgageTerms, year, month);
  if (mortgage)
    add(1, {
      name: "Lakeside Home Loans - MORTGAGE PMT",
      cents: -(mortgage.paymentCents + (year >= 2025 ? 57_135 : 54_820)),
      account: A.checking,
      kind: "expense",
      group: "Loans",
      child: "Mortgage",
      principalCents: mortgage.principalCents,
    });
  const carLoan = loanPayment(carLoanTerms, year, month);
  if (carLoan)
    add(12, {
      name: "Summit Auto Finance - AUTO PAY",
      cents: -carLoan.paymentCents,
      account: A.checking,
      kind: "expense",
      group: "Loans",
      child: "Car loan",
      principalCents: carLoan.principalCents,
    });
  if (month === 4 || month === 11)
    add(r.int(3, 6), {
      name: "Lakeside Home Loans - ESCROW DISB COUNTY TAX",
      cents: -r.dollars(3_700, 3_950),
      account: A.mortgage,
      kind: "expense",
      group: "Taxes",
      excluded: true,
    });

  // Bills
  const electric = electricBase[month - 1];
  spend(
    18,
    "City Power & Light - ONLINE PMT",
    r.dollars(electric * 0.88, electric * 1.12),
    A.cashback,
    "Utilities",
    "Electric",
  );
  spend(
    22,
    "Metro Water District - WATER BILL",
    r.dollars(
      month >= 6 && month <= 9 ? 74 : 56,
      month >= 6 && month <= 9 ? 96 : 72,
    ),
    A.checking,
    "Utilities",
    "Water",
  );
  spend(
    9,
    "FiberNet - INTERNET SVC",
    year >= 2026 ? 7_500 : 7_000,
    A.cashback,
    "Utilities",
    "Internet",
  );
  spend(
    24,
    "Wavelength Mobile - WIRELESS",
    r.dollars(96.4, 98.2),
    A.cashback,
    "Utilities",
    "Phone",
  );
  spend(
    3,
    "Evergreen Life - PREMIUM",
    4_218,
    A.checking,
    "Insurance",
    "Life insurance",
  );
  if (month === 1 || month === 7)
    spend(
      6,
      "Harbor Mutual - AUTO POLICY",
      year >= 2025 ? 71_240 : 68_450,
      A.checking,
      "Insurance",
      "Auto insurance",
    );
  spend(5, "Peak Fitness Club - MEMBERSHIP", 6_499, A.cashback, "Fitness");
  spend(
    11,
    "Netflix - NETFLIX.COM",
    year >= 2025 ? 1_799 : 1_549,
    A.cashback,
    "Subscriptions",
    "Streaming",
  );
  spend(
    17,
    "Spotify - SPOTIFY USA",
    1_699,
    A.cashback,
    "Subscriptions",
    "Streaming",
  );
  spend(
    20,
    "Dropbox - DROPBOX*PLUS",
    1_199,
    A.cashback,
    "Subscriptions",
    "Software",
  );
  spend(
    1,
    "Little Oaks Daycare - TUITION",
    year >= 2026 ? 142_000 : 136_000,
    A.checking,
    "Education",
    "Childcare",
  );
  if (month !== 7 && month !== 8)
    spend(
      2,
      "Sprout Swim School - LESSONS",
      9_500,
      A.checking,
      "Education",
      "Kids' activities",
    );
  if (r.chance(0.3))
    spend(
      anyDay(),
      "Elm Street Books - ELM STREET BOOKS",
      r.dollars(14, 48),
      A.cashback,
      "Education",
      "Books",
    );

  // Groceries
  for (let week = 0; week * 7 + 1 <= daysIn(year, month); week++) {
    const day = () => week * 7 + r.int(1, 7);
    if (r.chance(0.9))
      spend(
        day(),
        "Trader Joe's - TRADER JOE S #552",
        r.dollars(62, 148),
        A.cashback,
        "Groceries",
      );
    if (r.chance(0.55))
      spend(
        day(),
        "Safeway - SAFEWAY #1872",
        r.dollars(28, 165),
        A.cashback,
        "Groceries",
      );
  }
  spend(
    r.int(4, 26),
    "Costco - COSTCO WHSE #0114",
    r.dollars(190, 340),
    A.cashback,
    "Groceries",
  );
  if (r.chance(0.4))
    spend(
      anyDay(),
      "Saturday Market - SQ *GREEN ACRES FARM",
      r.dollars(22, 48),
      A.checking,
      "Groceries",
    );

  // Dining out
  for (let count = r.int(5, 9); count > 0; count--)
    spend(
      anyDay(),
      r.pick(restaurants),
      r.dollars(24, 118),
      A.travel,
      "Dining out",
      "Restaurants",
    );
  for (let count = r.int(6, 12); count > 0; count--)
    spend(
      anyDay(),
      r.pick(coffee),
      r.dollars(4.75, 9.8),
      A.cashback,
      "Dining out",
      "Coffee",
    );
  for (let count = r.int(1, 3); count > 0; count--)
    spend(
      anyDay(),
      "DoorDash - DOORDASH*THAI BASIL",
      r.dollars(26, 58),
      A.cashback,
      "Dining out",
      "Delivery",
    );

  // Shopping, gifts and home
  const holidays = month === 11 || month === 12;
  for (let count = r.int(3, 6); count > 0; count--)
    spend(
      anyDay(),
      "Amazon - AMZN Mktp US*2K4",
      r.dollars(11, 142),
      A.cashback,
      "Shopping",
      "Amazon",
    );
  if (r.chance(0.5))
    add(anyDay(), {
      name: "Amazon - AMZN Mktp US REFUND",
      cents: r.dollars(14, 60),
      account: A.cashback,
      kind: "expense",
      group: "Shopping",
      child: "Amazon",
    });
  for (let count = r.int(1, 3); count > 0; count--)
    spend(
      anyDay(),
      "Target - TARGET 00021",
      r.dollars(18, 96),
      A.cashback,
      "Shopping",
    );
  if (r.chance(0.5))
    spend(
      anyDay(),
      r.pick(clothing),
      r.dollars(35, 160),
      A.travel,
      "Shopping",
      "Clothing",
    );
  if (r.chance(0.4))
    spend(
      anyDay(),
      "Little Sprouts Toys - SQ *LITTLE SPROUTS",
      r.dollars(20, 85),
      A.cashback,
      "Shopping",
      "Kids",
    );
  for (
    let count = holidays ? r.int(4, 7) : r.chance(0.35) ? 1 : 0;
    count > 0;
    count--
  )
    spend(
      holidays ? r.int(1, Math.min(24, daysIn(year, month))) : anyDay(),
      r.pick(["Etsy - ETSY.COM*MAKERSHOP", "Amazon - AMZN Mktp US*7Q1"]),
      r.dollars(30, 120),
      A.cashback,
      "Gifts",
    );
  spend(
    20,
    "Community Food Bank - DONATION",
    month === 12 ? 25_000 : 5_000,
    A.checking,
    "Gifts",
    "Donations",
  );
  for (let count = r.int(0, 2); count > 0; count--)
    spend(
      anyDay(),
      "The Home Depot - THE HOME DEPOT #4710",
      r.dollars(18, 260),
      A.cashback,
      "Home Improvement",
      "Repairs",
    );
  if (r.chance(0.08))
    spend(
      anyDay(),
      "IKEA - IKEA #0412",
      r.dollars(420, 1_250),
      A.travel,
      "Home Improvement",
      "Furniture",
    );

  // Getting around
  for (let count = r.int(2, 4); count > 0; count--)
    spend(anyDay(), r.pick(gas), r.dollars(38, 66), A.cashback, "Car", "Gas");
  if (r.chance(0.5))
    spend(
      anyDay(),
      "ParkMobile - PARKMOBILE",
      r.dollars(6, 24),
      A.cashback,
      "Car",
      "Parking",
    );
  if (month % 5 === 0)
    spend(
      anyDay(),
      "Downtown Auto Care - DOWNTOWN AUTO",
      r.dollars(89, 420),
      A.checking,
      "Car",
      "Service",
    );
  for (let count = r.int(0, 3); count > 0; count--)
    spend(
      anyDay(),
      r.pick(["Uber - UBER *TRIP", "Lyft - LYFT *RIDE"]),
      r.dollars(12, 38),
      A.travel,
      "Transportation",
      "Rideshare",
    );
  if (r.chance(0.4))
    spend(
      anyDay(),
      "City Transit - TRANSIT CARD",
      2_500,
      A.cashback,
      "Transportation",
      "Transit",
    );

  // Health and fun
  for (let count = r.int(1, 2); count > 0; count--)
    spend(
      anyDay(),
      r.pick(["CVS - CVS/PHARMACY #2201", "Walgreens - WALGREENS #3381"]),
      r.dollars(8, 45),
      A.cashback,
      "Healthcare",
      "Pharmacy",
    );
  if (r.chance(0.3))
    spend(
      anyDay(),
      "Riverside Medical - COPAY",
      r.dollars(25, 180),
      A.checking,
      "Healthcare",
      "Doctor",
    );
  if (r.chance(0.6))
    spend(
      anyDay(),
      "Cineplex 12 - CINEPLEX 12",
      r.dollars(28, 54),
      A.travel,
      "Entertainment",
    );
  if (r.chance(0.2))
    spend(
      anyDay(),
      "Ticket Hub - TICKETHUB*EVENT",
      r.dollars(85, 240),
      A.travel,
      "Entertainment",
      "Events",
    );
  if (r.chance(0.3))
    spend(
      anyDay(),
      "Steam - STEAM GAMES",
      r.dollars(9.99, 59.99),
      A.cashback,
      "Entertainment",
      "Games",
    );

  // Travel
  if (month === 5)
    spend(
      r.int(5, 20),
      "Bluebird Airlines - BLUEBIRD AIR 0272",
      r.dollars(612, 940),
      A.travel,
      "Travel & Vacation",
      "Flights",
    );
  if (month === 7) {
    spend(
      r.int(8, 14),
      "Seaside Inn - SEASIDE INN RESORT",
      r.dollars(890, 1_350),
      A.travel,
      "Travel & Vacation",
      "Hotels",
    );
    for (let count = 3; count > 0; count--)
      spend(
        r.int(8, 16),
        "Beach Shack Grill - BEACH SHACK",
        r.dollars(40, 110),
        A.travel,
        "Dining out",
        "Restaurants",
      );
  }
  if (month === 10)
    spend(
      r.int(5, 25),
      "Bluebird Airlines - BLUEBIRD AIR 0272",
      r.dollars(480, 720),
      A.travel,
      "Travel & Vacation",
      "Flights",
    );
  if (month === 4) {
    spend(
      r.int(10, 13),
      "Mountain Lodge - MOUNTAIN LODGE",
      r.dollars(310, 480),
      A.travel,
      "Travel & Vacation",
      "Hotels",
    );
    spend(
      14,
      "State Dept of Revenue - TAX PMT",
      r.dollars(1_650, 2_100),
      A.checking,
      "Taxes",
    );
    add(r.int(18, 26), {
      name: "IRS TREAS 310 - TAX REF",
      cents: r.dollars(1_180, 1_640),
      account: A.checking,
      kind: "expense",
      group: "Taxes",
    });
  }

  // Moving money between the household's own accounts
  transfer(2, A.checking, A.savings, 120_000, [
    "Transfer to Savings - ONLINE TRANSFER",
    "Transfer from Checking - ONLINE TRANSFER",
  ]);
  transfer(3, A.checking, A.brokerage, 50_000, [
    "Brokerage - ACH CONTRIBUTION",
    "ACH Contribution - FROM CHECKING",
  ]);
  add(4, {
    name: "BUY VTI - VANGUARD TOTAL STOCK MKT ETF",
    cents: -50_000,
    account: A.brokerage,
    kind: "investment",
  });
  if (month === 1)
    transfer(8, A.checking, A.roth, 700_000, [
      "Roth IRA - ACH CONTRIBUTION",
      "Contribution - FROM CHECKING",
    ]);
  if (month % 3 === 0) {
    add(27, {
      name: "DIVIDEND VTI",
      cents: r.dollars(140, 190),
      account: A.brokerage,
      kind: "investment",
    });
    add(27, {
      name: "DIVIDEND VXUS",
      cents: r.dollars(60, 110),
      account: A.brokerage,
      kind: "investment",
    });
  }
  return drafts;
}

// Card payments settle the previous month's statement.
function cardPayments(
  year: number,
  month: number,
  previous: Draft[],
  today: string,
): Draft[] {
  const rows: Draft[] = [];
  for (const [card, day, label] of [
    [A.cashback, 26, "Cashback Visa"],
    [A.travel, 28, "Travel Rewards Card"],
  ] as const) {
    const date = isoDate(year, month, day);
    if (date > today) continue;
    const statement = previous
      .filter((row) => row.account === card && row.kind === "expense")
      .reduce((sum, row) => sum - row.cents, 0);
    const cents = statement > 0 ? statement : 120_000;
    rows.push(
      {
        date,
        name: `${label} - AUTOPAY PAYMENT`,
        cents: -cents,
        account: A.checking,
        kind: "transfer",
      },
      {
        date,
        name: "AUTOPAY PAYMENT - THANK YOU",
        cents,
        account: card,
        kind: "transfer",
      },
    );
  }
  return rows;
}

export type Household = {
  today: string;
  categories: Category[];
  transactions: Transaction[];
  principal: Map<string, { path: string; cents: number }>;
  accounts: WealthAccount[];
  rules: MoneyRule[];
  observedAt: string;
};

const confusions: Record<string, string> = {
  Groceries: "Shopping",
  Shopping: "Gifts",
  "Dining out": "Groceries",
  Entertainment: "Shopping",
  Healthcare: "Shopping",
  "Home Improvement": "Shopping",
  Gifts: "Shopping",
  Car: "Transportation",
  Transportation: "Car",
  Education: "Shopping",
};

export function createHousehold(today: string): Household {
  const categories = demoCatalog();
  const groupId = (name?: string) =>
    name
      ? (categories.find((group) => group.name === name)?.id ?? "uncategorized")
      : "uncategorized";
  const rules = initialRules(categories);
  const start = addMonths(
    Number(today.slice(0, 4)),
    Number(today.slice(5, 7)),
    1 - HISTORY_MONTHS,
  );

  const drafts: Draft[] = [];
  let previous: Draft[] = [];
  for (let offset = 0; offset < HISTORY_MONTHS; offset++) {
    const { year, month } = addMonths(start.year, start.month, offset);
    const rows = generateMonth(year, month, today);
    drafts.push(...rows, ...cardPayments(year, month, previous, today));
    previous = rows;
  }

  const todayNumber = dayNumber(today);
  const principal = new Map<string, { path: string; cents: number }>();
  const counts = new Map<string, number>();
  const transactions = drafts
    .sort(
      (a, b) => a.date.localeCompare(b.date) || a.name.localeCompare(b.name),
    )
    .map((draft) => {
      const key = `${draft.date}|${draft.name}|${draft.account}`;
      const occurrence = (counts.get(key) ?? 0) + 1;
      counts.set(key, occurrence);
      const id = uuid(`${key}|${occurrence}`);
      const r = random(id);
      const age = todayNumber - dayNumber(draft.date);
      const recent = age < REVIEW_WINDOW_DAYS;
      const card = draft.account === A.cashback || draft.account === A.travel;
      let group = groupId(draft.group);
      let child = draft.group ? (draft.child ?? draft.group) : "Uncategorized";
      const ruled = rules.find(
        (rule) =>
          rule.active &&
          (rule.matchType === "exact"
            ? draft.name.toLowerCase() === rule.pattern.toLowerCase()
            : draft.name.toLowerCase().includes(rule.pattern.toLowerCase())),
      );
      let categorization: Transaction["categorization"] = null;
      let reviewed =
        draft.kind === "transfer" || draft.kind === "investment" || !recent;
      if (draft.kind === "expense") {
        if (ruled) {
          categorization = {
            source: "rule",
            confidence: null,
            reviewRequired: false,
            confident: true,
          };
          reviewed = true;
        } else if (!recent) {
          categorization = r.chance(0.3)
            ? {
                source: "ollama",
                confidence: Math.round((0.9 + r.next() * 0.09) * 100) / 100,
                reviewRequired: false,
                confident: true,
              }
            : {
                source: "history",
                confidence: null,
                reviewRequired: false,
                confident: true,
              };
        } else {
          const roll = r.next();
          if (roll < 0.55) {
            const confidence = Math.round((0.91 + r.next() * 0.08) * 100) / 100;
            categorization = {
              source: "ollama",
              confidence,
              reviewRequired: false,
              confident: true,
            };
          } else if (roll < 0.8) {
            const confidence = Math.round((0.52 + r.next() * 0.34) * 100) / 100;
            categorization = {
              source: "ollama",
              confidence,
              reviewRequired: confidence < 0.7,
              confident: false,
            };
            const guess = draft.group ? confusions[draft.group] : undefined;
            if (guess && r.chance(0.5)) {
              group = groupId(guess);
              child = guess;
            }
          } else if (roll < 0.9 && draft.cents < 0) {
            categorization = {
              source: "provider",
              confidence: null,
              reviewRequired: false,
              confident: false,
            };
          } else {
            group = "uncategorized";
            child = "Uncategorized";
            categorization = {
              source: "uncategorized",
              confidence: null,
              reviewRequired: true,
              confident: false,
            };
          }
        }
      }
      if (draft.kind !== "expense" && !draft.group) {
        group = "uncategorized";
        child = "Uncategorized";
      }
      if (draft.principalCents)
        principal.set(id, {
          path: `${group}|${child}`,
          cents: draft.principalCents,
        });
      const transaction: Transaction = {
        id,
        name: draft.name,
        date: draft.date,
        amountCents: draft.cents,
        kind: draft.kind,
        category: group,
        subcategory: child,
        account: draft.account,
        reviewed,
        categorization,
        pending: card && draft.kind === "expense" && age <= 1,
        excluded: draft.excluded ?? false,
        incomeSourceKey: draft.kind === "income" ? `name:${draft.name}` : null,
      };
      return transaction;
    });

  return {
    today,
    categories,
    transactions,
    principal,
    accounts: wealthAccounts(today, transactions),
    rules,
    observedAt: `${today}T07:42:00`,
  };
}

function initialRules(categories: Category[]): MoneyRule[] {
  const id = (group: string, child = group) =>
    categories.find((item) => item.name === group)?.childIds[child] ?? "";
  const rule = (
    key: string,
    matchType: MoneyRule["matchType"],
    pattern: string,
    categoryId: string,
    active = true,
  ): MoneyRule => ({
    id: uuid(`rule:${key}`),
    matchType,
    pattern,
    categoryId,
    active,
    createdAt: "2025-02-08T18:20:00Z",
  });
  return [
    rule(
      "mortgage",
      "exact",
      "Lakeside Home Loans - MORTGAGE PMT",
      id("Loans", "Mortgage"),
    ),
    rule(
      "car-loan",
      "contains",
      "SUMMIT AUTO FINANCE",
      id("Loans", "Car loan"),
    ),
    rule("trader-joes", "contains", "TRADER JOE", id("Groceries")),
    rule("netflix", "contains", "NETFLIX", id("Subscriptions", "Streaming")),
    rule("spotify", "contains", "SPOTIFY", id("Subscriptions", "Streaming")),
    rule("power", "contains", "CITY POWER", id("Utilities", "Electric")),
    rule("fibernet", "contains", "FIBERNET", id("Utilities", "Internet")),
    rule("shell", "contains", "SHELL OIL", id("Car", "Gas")),
    rule("gym", "contains", "PEAK FITNESS", id("Fitness"), false),
  ];
}

type HoldingSpec = [
  ticker: string,
  name: string,
  type: string,
  quantity: number,
  price: number,
];
const holdingSpecs: Record<string, HoldingSpec[]> = {
  [A.brokerage]: [
    ["VTI", "Vanguard Total Stock Market ETF", "etf", 182.4, 301.12],
    ["VXUS", "Vanguard Total International Stock ETF", "etf", 310, 66.85],
    ["BND", "Vanguard Total Bond Market ETF", "etf", 120, 73.2],
    ["AAPL", "Apple Inc.", "stock", 42, 228.4],
    ["MSFT", "Microsoft Corp.", "stock", 18, 452.1],
    ["GMMXX", "Government Money Market Fund", "money_market", 2410.55, 1],
  ],
  [A.alex401k]: [
    ["RTF55", "Retirement 2055 Fund", "other_fund", 1120.5, 71.4],
    ["SPXIX", "S&P 500 Index Fund", "mutual_fund", 410.2, 142.8],
  ],
  [A.sam401k]: [
    ["RTF55", "Retirement 2055 Fund", "other_fund", 690, 71.4],
    ["MCIDX", "Mid Cap Index Fund", "mutual_fund", 250, 88.3],
    ["TBIFX", "Total Bond Index Fund", "mutual_fund", 1830, 10.42],
  ],
  [A.roth]: [
    ["VTI", "Vanguard Total Stock Market ETF", "etf", 64, 301.12],
    ["QQQ", "Invesco QQQ Trust", "etf", 38, 512.3],
  ],
  [A.hsa]: [["TMIFX", "Total Market Index Fund", "mutual_fund", 96.5, 118.6]],
  [A.crypto]: [
    ["BTC", "Bitcoin", "cryptocurrency", 0.0815, 96_420],
    ["ETH", "Ethereum", "cryptocurrency", 1.42, 3_410],
  ],
};
// Cash held in an account beyond its listed holdings.
const uninvestedCents: Record<string, number> = {
  [A.brokerage]: 81_240,
  [A.hsa]: 118_000,
};

function wealthAccounts(
  today: string,
  transactions: Transaction[],
): WealthAccount[] {
  const flow = (account: string) =>
    transactions
      .filter((row) => row.account === account && !row.pending)
      .reduce((sum, row) => sum + row.amountCents, 0);
  const cardBalance = (account: string) => {
    const lastPayment = transactions
      .filter((row) => row.account === account && row.kind === "transfer")
      .reduce((date, row) => (row.date > date ? row.date : date), "");
    return transactions
      .filter(
        (row) =>
          row.account === account &&
          row.kind === "expense" &&
          row.date > lastPayment,
      )
      .reduce((sum, row) => sum - row.amountCents, 0);
  };
  const { year, month } = {
    year: Number(today.slice(0, 4)),
    month: Number(today.slice(5, 7)),
  };
  const balanceAfter = (terms: LoanTerms) => {
    const paidThisMonth = Number(today.slice(8, 10)) >= terms.day;
    const latest = paidThisMonth ? { year, month } : addMonths(year, month, -1);
    return loanPayment(terms, latest.year, latest.month)?.balanceCents ?? 0;
  };
  const holdings = (account: string): WealthHolding[] =>
    (holdingSpecs[account] ?? []).map(
      ([ticker, name, instrumentType, quantity, price]) => {
        const value = quantity * price;
        return {
          id: uuid(`holding:${account}:${ticker}`),
          securityId: uuid(`security:${ticker}`),
          name,
          ticker,
          instrumentType,
          sourceUrl: null,
          quantity: String(quantity),
          price: price.toFixed(2),
          value: value.toFixed(2),
          currency: "USD",
          valueCents: Math.round(value * 100),
          asOf: today,
        };
      },
    );
  const account = (
    name: string,
    type: string,
    classification: "asset" | "liability",
    balanceCents: number,
  ): WealthAccount => {
    const list = holdings(name);
    return {
      id: uuid(`account:${name}`),
      name,
      type,
      classification,
      balanceCents: list.length
        ? list.reduce((sum, holding) => sum + (holding.valueCents ?? 0), 0) +
          (uninvestedCents[name] ?? 0)
        : balanceCents,
      asOf: today,
      holdings: list,
    };
  };
  return [
    account(
      A.checking,
      "Depository",
      "asset",
      640_000 + (hash(today) % 400_000),
    ),
    account(A.savings, "Depository", "asset", 1_250_000 + flow(A.savings)),
    account(A.cashback, "CreditCard", "liability", cardBalance(A.cashback)),
    account(A.travel, "CreditCard", "liability", cardBalance(A.travel)),
    account(A.brokerage, "Investment", "asset", 0),
    account(A.alex401k, "Investment", "asset", 0),
    account(A.sam401k, "Investment", "asset", 0),
    account(A.roth, "Investment", "asset", 0),
    account(A.hsa, "Investment", "asset", 0),
    account(A.crypto, "Crypto", "asset", 0),
    account(A.home, "Property", "asset", 58_500_000),
    account(A.vehicle, "Vehicle", "asset", 2_380_000),
    account(A.mortgage, "Loan", "liability", balanceAfter(mortgageTerms)),
    account(A.carLoan, "Loan", "liability", balanceAfter(carLoanTerms)),
  ].sort((a, b) => a.name.localeCompare(b.name));
}
