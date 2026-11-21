import { request } from "./api";
import { type Transaction, categories } from "./finance";

export type RuleDraft = {
  matchType: "contains" | "exact";
  pattern: string;
  categoryId: string;
  active: boolean;
};
export type MoneyRule = RuleDraft & { id: string; createdAt: string };
export type RulePreview = {
  matchCount: number;
  samples: (Pick<
    Transaction,
    "id" | "name" | "date" | "amountCents" | "account"
  > & { categoryName?: string | null })[];
  previewToken: string;
};
export type RuleResult = { rule: MoneyRule; appliedCount: number };

export function ruleCategory(categoryId: string) {
  for (const group of categories) {
    const child = Object.entries(group.childIds).find(
      ([, id]) => id === categoryId,
    );
    if (child)
      return {
        category: group.id,
        subcategory: child[0],
        label:
          child[0] === group.name ? child[0] : `${group.name} → ${child[0]}`,
      };
  }
  return {
    category: null,
    subcategory: "Choose category",
    label: "Choose category",
  };
}
export function categoryIdFor(category: string | null, subcategory: string) {
  return (
    categories.find((group) => group.id === category)?.childIds[subcategory] ??
    ""
  );
}
export function draftFor(transaction?: Transaction): RuleDraft {
  const name = transaction?.name ?? "";
  const separator = name.indexOf(" - ");
  return {
    matchType: "contains",
    pattern: separator >= 0 ? name.slice(separator + 3) : name,
    categoryId: transaction
      ? categoryIdFor(transaction.category, transaction.subcategory)
      : "",
    active: true,
  };
}
export const listRules = (signal?: AbortSignal) =>
  request<{ rules: MoneyRule[] }>("/rules", { signal });
export const previewRule = (rule: RuleDraft, id?: string) =>
  request<RulePreview>("/rules/preview", {
    method: "POST",
    body: JSON.stringify({ rule, id }),
  });
export const writeRule = (
  rule: RuleDraft,
  preview: RulePreview,
  applyExisting: boolean,
  id?: string,
) =>
  request<RuleResult>(id ? `/rules/${id}` : "/rules", {
    method: id ? "PATCH" : "POST",
    body: JSON.stringify({
      rule,
      applyExisting,
      previewToken: preview.previewToken,
    }),
  });
