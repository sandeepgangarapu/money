import type { CashFlowSummary } from "./api";
import { type ActivityFilters, emptyFilters } from "./filters";
import { bySpending, months } from "./finance";

type Summary = Pick<CashFlowSummary, "spending" | "groups">;
export type CategorySelection = { group: string; child?: string };

const shareOf = (cents: number, spending: number) =>
  spending > 0 && cents > 0 ? cents / spending : 0;
export const formatShare = (share: number) =>
  share > 0 && share < 0.01 ? "under 1%" : `${Math.round(share * 100)}%`;

// There are no budgets, so each bar is the category's share of the month's
// spending. A parent-named row holds transactions placed directly on the
// parent and only appears when it has any.
export function categoryRows(summary: Summary) {
  return [...summary.groups].sort(bySpending).map((group) => ({
    ...group,
    share: shareOf(group.cents, summary.spending),
    subcategories:
      group.children.length > 1
        ? group.breakdown
            .filter((child) => child.name !== group.name || child.cents !== 0)
            .sort(bySpending)
            .map((child) => ({
              ...child,
              share: shareOf(child.cents, summary.spending),
            }))
        : [],
  }));
}

type CategoryRow = ReturnType<typeof categoryRows>[number];

// Keep nonzero refunds visible, including children of a parent that nets to zero.
export function splitByActivity(rows: CategoryRow[]) {
  const active: CategoryRow[] = [];
  const inactive: {
    selection: CategorySelection;
    name: string;
    groupName: string;
    cents: number;
    share: number;
  }[] = [];
  for (const group of rows) {
    if (group.cents === 0)
      inactive.push({
        selection: { group: group.id },
        name: group.name,
        groupName: group.name,
        cents: group.cents,
        share: group.share,
      });
    const subcategories = group.subcategories.filter((child) => {
      if (child.cents !== 0) return true;
      inactive.push({
        selection: { group: group.id, child: child.id },
        name: child.name,
        groupName: group.name,
        cents: child.cents,
        share: child.share,
      });
      return false;
    });
    if (group.cents !== 0 || subcategories.length)
      active.push({ ...group, subcategories });
  }
  return { active, inactive };
}

// Negative refunds have no drawable width in the spending composition.
export function categorySpendingSegments(rows: CategoryRow[]) {
  const spending = rows.filter((row) => row.cents > 0).sort(bySpending);
  const segments: { id: string; name: string | null; cents: number }[] =
    spending.slice(0, 6).map(({ id, name, cents }) => ({
      id,
      name,
      cents,
    }));
  const rest = spending.slice(6).reduce((sum, row) => sum + row.cents, 0);
  if (rest > 0) segments.push({ id: "remaining", name: null, cents: rest });
  return segments;
}

function findCategory(summary: Summary, selection: CategorySelection) {
  const group = summary.groups.find((item) => item.id === selection.group);
  const child = selection.child
    ? group?.breakdown.find((item) => item.id === selection.child)
    : undefined;
  if (!group || (selection.child && !child)) return null;
  return {
    group,
    name: child?.name ?? group.name,
    cents: child?.cents ?? group.cents,
  };
}

// The yearly summary covers the selected month's year through today, so the
// average divides by the months of that year present in the history.
export function categoryMetrics(
  month: string,
  summary: Summary,
  yearlySummary: Summary,
  selection: CategorySelection,
) {
  const current = findCategory(summary, selection);
  if (!current) return null;
  const year = month.slice(0, 4);
  const yearCents = findCategory(yearlySummary, selection)?.cents ?? 0;
  const monthCount = months.filter((item) => item.id.startsWith(year)).length;
  return {
    ...current,
    share: shareOf(current.cents, summary.spending),
    year,
    yearCents,
    monthlyAverageCents: Math.round(yearCents / Math.max(monthCount, 1)),
  };
}

export const categoryShortcut = (
  selection: CategorySelection,
): Partial<ActivityFilters> =>
  selection.child
    ? { categories: [selection.child] }
    : { categoryGroups: [selection.group] };

// Spending in the category from the selected month back through history.
export function categoryActivityFilters(
  selection: CategorySelection,
  month: string,
): ActivityFilters {
  const through = months
    .filter((item) => item.id <= month)
    .map((item) => item.id);
  return {
    ...emptyFilters(),
    ...categoryShortcut(selection),
    kinds: ["expense"],
    months: through.length === months.length ? [] : through,
  };
}

export function transactionsByMonth<T extends { date: string }>(rows: T[]) {
  const sections: { month: string; transactions: T[] }[] = [];
  for (const row of rows) {
    const month = row.date.slice(0, 7);
    const section = sections.at(-1);
    if (section?.month === month) section.transactions.push(row);
    else sections.push({ month, transactions: [row] });
  }
  return sections;
}
