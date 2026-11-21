import type { IncomeSource } from "./api";
import { categoryAppearance, everythingElseAppearance } from "./appearance";
import type { ActivityFilters } from "./filters";
import type { monthSummary } from "./finance";

type Group = ReturnType<typeof monthSummary>["groups"][number];
type CashFlowGroup = Group & { activityFilter?: Partial<ActivityFilters> };
const loanNames = new Map([
  ["Mortgage", "Mortgage"],
  ["CarLoan", "Car loan"],
  ["Car loan", "Car loan"],
]);

export function incomeActivityFilters(
  period: string,
  source?: IncomeSource,
): Partial<ActivityFilters> {
  return {
    cashFlowPeriod: period,
    incomeSource: source?.key ?? "",
    kinds: ["income"],
    statuses: ["posted"],
    visibility: "included",
  };
}

export function incomeFlow(sources: IncomeSource[], income: number) {
  const positive = sources.filter((source) => source.cents > 0);
  const adjustments = sources.filter((source) => source.cents < 0);
  return {
    positive,
    adjustments,
    positiveCents: positive.reduce((sum, source) => sum + source.cents, 0),
    adjustmentCents: -adjustments.reduce(
      (sum, source) => sum + source.cents,
      0,
    ),
    percentage: (source: IncomeSource) =>
      income > 0 && source.cents > 0
        ? source.cents / income < 0.001
          ? "<0.1%"
          : `${((source.cents / income) * 100).toFixed(1)}%`
        : null,
  };
}

// Give loan payments their own Sankey branches while retaining the category tree
// for Activity and Categories. Every amount stays in exactly one branch.
export function sankeyGroups(groups: Group[]): CashFlowGroup[] {
  return groups.flatMap<CashFlowGroup>((original) => {
    const group = {
      ...original,
      color: (loanNames.has(original.name)
        ? categoryAppearance("Loans", original.name)
        : categoryAppearance(original.name)
      ).color,
      breakdown: original.breakdown.map((child) => ({
        ...child,
        color: categoryAppearance(original.name, child.name).color,
      })),
    };
    const loans = group.breakdown.filter((child) => loanNames.has(child.name));
    if (!loans.length)
      return [{ ...group, activityFilter: { categoryGroups: [group.id] } }];

    const remaining = group.breakdown.filter(
      (child) => !loanNames.has(child.name),
    );
    const branches = loans.map((child) => {
      const name = loanNames.get(child.name) as string;
      return {
        ...group,
        id: child.id,
        name,
        color: categoryAppearance("Loans", child.name).color,
        cents: child.cents,
        children: [name],
        breakdown: [
          {
            ...child,
            name,
            color: categoryAppearance("Loans", child.name).color,
          },
        ],
        activityFilter: { categories: [child.id] },
      };
    });
    if (remaining.length)
      branches.push({
        ...group,
        cents: remaining.reduce((sum, child) => sum + child.cents, 0),
        children: remaining.map((child) => child.name),
        breakdown: remaining,
        activityFilter: { categories: remaining.map((child) => child.id) },
      });
    return branches;
  });
}

// The overview partitions the same net spending into four destinations. Use
// group totals for the remainder so uncategorized spending is included too.
export function overviewGroups(groups: Group[]): CashFlowGroup[] {
  const totals = new Map([
    ["Mortgage", 0],
    ["Car loan", 0],
    ["Utilities", 0],
    ["Everything else", 0],
  ]);
  const categoryPaths = new Map<string, string[]>();
  const names = new Map([...loanNames, ["Utilities", "Utilities"]]);
  for (const group of groups) {
    const name = names.get(group.name);
    if (name) {
      totals.set(name, (totals.get(name) ?? 0) + group.cents);
      categoryPaths.set(name, [
        ...(categoryPaths.get(name) ?? []),
        ...group.breakdown.map((child) => child.id),
      ]);
      continue;
    }

    let remaining = group.cents;
    for (const child of group.breakdown) {
      const name = names.get(child.name);
      if (!name) continue;
      totals.set(name, (totals.get(name) ?? 0) + child.cents);
      categoryPaths.set(name, [...(categoryPaths.get(name) ?? []), child.id]);
      remaining -= child.cents;
    }
    totals.set(
      "Everything else",
      (totals.get("Everything else") ?? 0) + remaining,
    );
    categoryPaths.set("Everything else", [
      ...(categoryPaths.get("Everything else") ?? []),
      ...group.breakdown
        .filter((child) => !names.has(child.name))
        .map((child) => child.id),
    ]);
  }

  const appearances = [
    categoryAppearance("Loans", "Mortgage"),
    categoryAppearance("Loans", "CarLoan"),
    categoryAppearance("Utilities"),
    everythingElseAppearance,
  ];
  return [...totals].map(([name, cents], index) => {
    const id = `overview-${index}`;
    const color = appearances[index].color;
    const paths = categoryPaths.get(name) ?? [];
    return {
      id,
      name,
      cents,
      color,
      icon: "house",
      children: [name],
      childIds: { [name]: null },
      breakdown: [{ id, name, cents, color }],
      activityFilter: paths.length
        ? {
            categories: paths,
            ...(name === "Everything else"
              ? { kinds: ["expense" as const] }
              : {}),
          }
        : undefined,
    };
  });
}

export function savingsRate(savings: number, income: number): string | null {
  return income > 0
    ? `${Math.round((Math.abs(savings) / income) * 100)}%`
    : null;
}

export function cashFlowPeriodLabel(period: string, today: string): string {
  const year = period.slice(0, 4);
  if (period.length === 4 && year !== today.slice(0, 4)) return "Full year";
  const end =
    period.length === 4 || period === today.slice(0, 7)
      ? new Date(`${today}T12:00:00`)
      : new Date(Number(year), Number(period.slice(5, 7)), 0, 12);
  const start =
    period.length === 4
      ? "Jan"
      : end.toLocaleDateString("en-US", { month: "short" });
  return `${start} 1–${period.length === 4 ? end.toLocaleDateString("en-US", { month: "short", day: "numeric" }) : end.getDate()}`;
}

export function dashboardStatus({
  loading,
  saving,
  handoffReviewCount,
  stagedPendingCount,
  missingCount,
}: {
  loading: boolean;
  saving: number;
  handoffReviewCount: number;
  stagedPendingCount: number;
  missingCount: number;
}) {
  if (loading || saving > 0)
    return {
      state: "busy",
      label: saving > 0 ? "Saving changes" : "Updating data",
    } as const;
  if (handoffReviewCount > 0 || stagedPendingCount > 0 || missingCount > 0)
    return {
      state: "attention",
      label: "Data status needs attention",
    } as const;
  return { state: "ready", label: "Data is up to date" } as const;
}
