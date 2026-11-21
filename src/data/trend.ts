import type { DailySpending } from "./api";

export type TrendPoint = { date: string; cents: number };

const day = (value: string) => new Date(`${value}T12:00:00`);
const iso = (date: Date) =>
  `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;

// The period a report covers: a month (YYYY-MM) or a year (YYYY).
export function periodRange(period: string) {
  if (period.length === 4)
    return { start: `${period}-01-01`, end: `${period}-12-31` };
  const [year, month] = period.split("-").map(Number);
  return { start: `${period}-01`, end: iso(new Date(year, month, 0, 12)) };
}

export function daysBetween(start: string, end: string) {
  return Math.round((day(end).getTime() - day(start).getTime()) / 86_400_000);
}

// Running spending total for each day from the start of the period through
// `through` (today, or the period's end for past periods).
export function cumulativeSpending(
  days: DailySpending,
  start: string,
  through: string,
): TrendPoint[] {
  const byDate = new Map<string, number>();
  for (const entry of days)
    byDate.set(entry.date, (byDate.get(entry.date) ?? 0) + entry.cents);
  const points: TrendPoint[] = [];
  let total = 0;
  const cursor = day(start);
  const last = day(through);
  while (cursor <= last) {
    const date = iso(cursor);
    total += byDate.get(date) ?? 0;
    points.push({ date, cents: total });
    cursor.setDate(cursor.getDate() + 1);
  }
  return points;
}

// SVG coordinates: x spans the whole period so the line stops at today.
export function trendGeometry(
  points: TrendPoint[],
  range: { start: string; end: string },
  size: { width: number; height: number; inset: number },
) {
  const span = Math.max(1, daysBetween(range.start, range.end));
  const values = points.map((point) => point.cents);
  const low = Math.min(0, ...values);
  const high = Math.max(1, ...values);
  const scale = (high - low) * 1.08 || 1;
  const x = (date: string) =>
    size.inset +
    (daysBetween(range.start, date) / span) * (size.width - size.inset * 2);
  const y = (cents: number) =>
    size.height -
    size.inset -
    ((cents - low) / scale) * (size.height - size.inset * 2);
  const coordinates = points.map((point) => ({
    ...point,
    x: x(point.date),
    y: y(point.cents),
  }));
  const line = coordinates
    .map(
      (point, index) =>
        `${index ? "L" : "M"}${point.x.toFixed(1)},${point.y.toFixed(1)}`,
    )
    .join(" ");
  const last = coordinates.at(-1);
  const area =
    last && coordinates.length > 1
      ? `${line} L${last.x.toFixed(1)},${y(low).toFixed(1)} L${coordinates[0].x.toFixed(1)},${y(low).toFixed(1)} Z`
      : "";
  return { coordinates, line, area, baseline: y(low) };
}

export function nearestPoint<T extends { x: number }>(points: T[], x: number) {
  let best = 0;
  for (let index = 1; index < points.length; index++)
    if (Math.abs(points[index].x - x) < Math.abs(points[best].x - x))
      best = index;
  return points.length ? best : -1;
}
