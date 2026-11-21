// The hash keeps the screen, month and cash-flow period, so a reload or Back
// returns to the same view: #/flow?m=2026-10&p=year
export type Screen = "flow" | "wealth" | "categories" | "activity" | "review";
export type Period = "month" | "year";
export type Route = { screen: Screen; month: string | null; period: Period };

const screens: Screen[] = [
  "flow",
  "wealth",
  "categories",
  "activity",
  "review",
];

export function parseRoute(hash: string): Route {
  const [path, query = ""] = hash.replace(/^#\/?/, "").split("?");
  const params = new URLSearchParams(query);
  const month = params.get("m");
  return {
    screen: screens.includes(path as Screen) ? (path as Screen) : "flow",
    month: month && /^\d{4}-(0[1-9]|1[0-2])$/.test(month) ? month : null,
    period: params.get("p") === "year" ? "year" : "month",
  };
}

export function formatRoute(route: Route, currentMonth: string): string {
  const params = new URLSearchParams();
  // Only month-scoped screens carry the month; the current month stays implicit.
  if (
    (route.screen === "flow" || route.screen === "categories") &&
    route.month &&
    route.month !== currentMonth
  )
    params.set("m", route.month);
  if (route.screen === "flow" && route.period === "year")
    params.set("p", "year");
  const query = params.toString();
  return `#/${route.screen}${query ? `?${query}` : ""}`;
}

// The local calendar month, used to start the first month's rows in parallel
// with the dashboard. A wrong guess near midnight only costs one extra request.
export function localMonth(now = new Date()) {
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
}

export function adjacentMonths(ids: string[], month: string) {
  const index = ids.indexOf(month);
  if (index < 0) return [];
  return [ids[index - 1], ids[index + 1]].filter(
    (id): id is string => id !== undefined,
  );
}

export function pageNumbers(total: number, pageSize = 100) {
  return Array.from(
    { length: Math.max(0, Math.ceil(total / pageSize) - 1) },
    (_, index) => index + 2,
  );
}
