import { type Transaction, categories } from "./finance";

export type Appearance = { emoji: string; color: string };
const normalize = (name: string) =>
  name.toLowerCase().replace(/[^\p{L}\p{N}]/gu, "");
const roots = new Map<string, Appearance>(
  [
    ["Beauty", "💅", "#F472B6"],
    ["Car", "🚗", "#3B82F6"],
    ["Education", "🎓", "#1D4ED8"],
    ["Entertainment", "🎬", "#D946EF"],
    ["Fitness", "🏃", "#14B8A6"],
    ["FixedCosts", "📌", "#64748B"],
    ["Gifts", "🎁", "#F43F5E"],
    ["Groceries", "🥑", "#65A30D"],
    ["Gym", "🏋️", "#06B6D4"],
    ["Healthcare", "💊", "#EF4444"],
    ["HomeBigticket", "🛋️", "#A16207"],
    ["HomeImprovement", "🔨", "#C2410C"],
    ["Insurance", "🛡️", "#0EA5E9"],
    ["Investment Contributions", "📈", "#047857"],
    ["Loans", "🏦", "#7C3AED"],
    ["NeedToWaive", "⏳", "#94A3B8"],
    ["Other", "🏷️", "#94A3B8"],
    ["Outside Food", "🍔", "#F97316"],
    ["Rent", "🏘️", "#A855F7"],
    ["Shopping", "🛍️", "#DB2777"],
    ["Subscriptions", "💳", "#6366F1"],
    ["Taxes", "🧾", "#475569"],
    ["Transportation", "🚌", "#0284C7"],
    ["Travel & Vacation", "🏖️", "#F59E0B"],
    ["Utilities", "💡", "#EAB308"],
    ["Work Expenses", "💼", "#92400E"],
    ["Uncategorized", "❓", "#94A3B8"],
  ].map(([name, emoji, color]) => [normalize(name), { emoji, color }]),
);
const children: Record<string, Record<string, Partial<Appearance>>> = {
  loans: {
    mortgage: { emoji: "🏠", color: "#7C3AED" },
    carloan: { emoji: "🚙", color: "#A78BFA" },
  },
  outsidefood: {
    restaurants: { emoji: "🍽️" },
    applefood: { emoji: "🍎" },
    coffee: { emoji: "☕" },
  },
  shopping: {
    amazon: { emoji: "📦" },
    children: { emoji: "🧸" },
    clothing: { emoji: "👕" },
    costco: { emoji: "🛒" },
    shops: { emoji: "🏬" },
  },
};
const keywords: [RegExp, string][] = [
  [/food|restaurant|dining/, "🍽️"],
  [/coffee|cafe/, "☕"],
  [/gas|fuel/, "⛽"],
  [/pet/, "🐾"],
  [/kid|child|baby/, "🧸"],
  [/phone|mobile/, "📱"],
  [/internet|wifi/, "📶"],
  [/travel|flight|air/, "✈️"],
  [/hotel/, "🏨"],
  [/home|house/, "🏠"],
  [/car|auto/, "🚗"],
  [/parking/, "🅿️"],
  [/health|medical|doctor|pharmacy/, "🩺"],
  [/gift/, "🎁"],
  [/shop|store/, "🛍️"],
  [/book/, "📚"],
  [/music/, "🎵"],
  [/game/, "🎮"],
  [/cloth|apparel/, "👕"],
  [/insurance/, "🛡️"],
  [/tax/, "🧾"],
  [/fee|charge/, "💸"],
  [/charity|donation/, "💝"],
  [/education|school/, "🎓"],
];
const keywordEmoji = (name: string) =>
  keywords.find(([pattern]) => pattern.test(name))?.[1];
const fallbackColors = [
  "#3B82F6",
  "#F97316",
  "#7C3AED",
  "#14B8A6",
  "#DB2777",
  "#EAB308",
  "#06B6D4",
  "#EF4444",
  "#6366F1",
  "#65A30D",
];

export function categoryAppearance(
  groupName: string,
  childName?: string,
): Appearance {
  const group = normalize(groupName);
  let hash = 0;
  for (const character of group)
    hash = (Math.imul(hash, 31) + (character.codePointAt(0) ?? 0)) >>> 0;
  const parent = roots.get(group) ?? {
    emoji: keywordEmoji(group) ?? "🏷️",
    color: fallbackColors[hash % fallbackColors.length],
  };
  const child = normalize(childName ?? "");
  if (!child || child === group) return parent;
  const groupChildren = Object.hasOwn(children, group)
    ? children[group]
    : undefined;
  const entry =
    groupChildren && Object.hasOwn(groupChildren, child)
      ? groupChildren[child]
      : roots.get(child);
  return { ...parent, emoji: keywordEmoji(child) ?? parent.emoji, ...entry };
}

export const savedAppearance: Appearance = { emoji: "💰", color: "#10B981" };
export const everythingElseAppearance: Appearance = {
  emoji: "🧺",
  color: "#94A3B8",
};
const kinds: Record<Exclude<Transaction["kind"], "expense">, Appearance> = {
  income: { emoji: "💵", color: "#047857" },
  transfer: { emoji: "🔁", color: "#64748B" },
  investment: { emoji: "📈", color: "#0284C7" },
};
export function transactionAppearance(t: Transaction): Appearance {
  if (t.kind !== "expense") return kinds[t.kind];
  return categoryAppearance(
    categories.find((category) => category.id === t.category)?.name ??
      "Uncategorized",
    t.subcategory,
  );
}
export const tint = (color: string, percent = 14) =>
  `color-mix(in srgb, ${color} ${percent}%, white)`;
