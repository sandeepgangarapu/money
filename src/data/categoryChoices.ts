import { categoryAppearance } from "./appearance";
import type { Category } from "./finance";

export type CategoryChoice = {
  key: string;
  category: string;
  subcategory: string;
  appearance: ReturnType<typeof categoryAppearance>;
};

type CategoryChoiceSection = {
  id: string;
  heading: { name: string; appearance: CategoryChoice["appearance"] } | null;
  choices: CategoryChoice[];
};

export function normalizeCategorySearch(value: string): string {
  return value
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]/gu, "");
}

function categoryChoice(group: Category, child: string): CategoryChoice {
  return {
    key: `${group.id}|${child}`,
    category: group.id,
    subcategory: child,
    appearance: categoryAppearance(group.name, child),
  };
}

export function categoryChoiceSections(
  groups: Category[],
  query: string,
  allowUncategorized: boolean,
): CategoryChoiceSection[] {
  const terms = query
    .trim()
    .split(/\s+/)
    .map(normalizeCategorySearch)
    .filter(Boolean);
  const sections: CategoryChoiceSection[] = [];
  let singles: CategoryChoiceSection | undefined;

  for (const group of groups) {
    if (!allowUncategorized && group.id === "uncategorized") continue;
    const choices = group.children
      .filter((child) =>
        terms.every((term) =>
          normalizeCategorySearch(`${group.name} ${child}`).includes(term),
        ),
      )
      .map((child) => categoryChoice(group, child));

    if (group.children.length === 1) {
      if (!singles) {
        singles = { id: group.id, heading: null, choices: [] };
        sections.push(singles);
      }
      singles.choices.push(...choices);
    } else {
      singles = undefined;
      sections.push({
        id: group.id,
        heading:
          group.children.length > 1
            ? { name: group.name, appearance: categoryAppearance(group.name) }
            : null,
        choices,
      });
    }
  }

  return sections.filter((section) => section.choices.length > 0);
}

let recentCategories: Pick<
  CategoryChoice,
  "key" | "category" | "subcategory"
>[] = [];

export function rememberCategory(category: string, subcategory: string) {
  if (category === "uncategorized") return;
  const key = `${category}|${subcategory}`;
  recentCategories = [
    { key, category, subcategory },
    ...recentCategories.filter((choice) => choice.key !== key),
  ].slice(0, 6);
}

export function recentCategoryChoices(
  groups: Category[],
  options: { selected: string; allowUncategorized: boolean },
): CategoryChoice[] {
  return recentCategories.flatMap((choice) => {
    if (
      choice.key === options.selected ||
      (!options.allowUncategorized && choice.category === "uncategorized")
    )
      return [];
    const group = groups.find((group) => group.id === choice.category);
    return group?.children.includes(choice.subcategory)
      ? [categoryChoice(group, choice.subcategory)]
      : [];
  });
}

export function resetRecentCategories() {
  recentCategories = [];
}
