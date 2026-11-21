import { type PointerEvent, useId, useMemo, useState } from "react";
import type { DailySpending } from "../data/api";
import { money, shortDate } from "../data/finance";
import {
  cumulativeSpending,
  nearestPoint,
  periodRange,
  trendGeometry,
} from "../data/trend";
import { useWidth } from "./Charts";
import t from "./SpendingTrend.module.css";

const HEIGHT = 120;
const INSET = 6;

// Running spending for the month or year. Drag (or use the arrow keys) to
// read the total on any day.
export function SpendingTrend({
  days,
  period,
  today,
}: {
  days: DailySpending;
  period: string;
  today: string;
}) {
  const { ref, width } = useWidth();
  const gradient = useId();
  const titleId = useId();
  const [active, setActive] = useState<number | null>(null);
  const range = periodRange(period);
  const through = today < range.end ? today : range.end;
  const points = useMemo(
    () => cumulativeSpending(days, range.start, through),
    [days, range.start, through],
  );
  const chartWidth = width || 320;
  const geometry = trendGeometry(points, range, {
    width: chartWidth,
    height: HEIGHT,
    inset: INSET,
  });
  const last = geometry.coordinates.at(-1);
  const shown = active === null ? null : (geometry.coordinates[active] ?? null);
  if (!last) return null;
  const locate = (event: PointerEvent<SVGSVGElement>) => {
    const bounds = event.currentTarget.getBoundingClientRect();
    const x = ((event.clientX - bounds.left) / bounds.width) * chartWidth;
    setActive(nearestPoint(geometry.coordinates, x));
  };
  const yearly = period.length === 4;
  const labels = yearly
    ? ["Jan", "Jul", "Dec"]
    : [shortDate(range.start), "15", range.end.slice(8)];
  return (
    <div ref={ref} className={t.trend}>
      <svg
        className={t.chart}
        width="100%"
        height={HEIGHT}
        viewBox={`0 0 ${chartWidth} ${HEIGHT}`}
        role="img"
        aria-labelledby={titleId}
        // biome-ignore lint/a11y/noNoninteractiveTabindex: the arrow keys read daily totals.
        tabIndex={0}
        onPointerDown={locate}
        onPointerMove={(event) => {
          if (event.pointerType === "mouse" || event.buttons) locate(event);
        }}
        onPointerLeave={() => setActive(null)}
        onPointerUp={(event) => {
          if (event.pointerType !== "mouse") setActive(null);
        }}
        onPointerCancel={() => setActive(null)}
        onBlur={() => setActive(null)}
        onKeyDown={(event) => {
          const step =
            event.key === "ArrowRight" ? 1 : event.key === "ArrowLeft" ? -1 : 0;
          if (!step && event.key !== "Home" && event.key !== "End") return;
          event.preventDefault();
          const end = geometry.coordinates.length - 1;
          setActive((current) =>
            event.key === "Home"
              ? 0
              : event.key === "End"
                ? end
                : Math.min(end, Math.max(0, (current ?? end) + step)),
          );
        }}
      >
        <title id={titleId}>
          {`Spending ${yearly ? "this year" : "this month"}: ${money(last.cents)} through ${shortDate(last.date)}`}
        </title>
        <defs>
          <linearGradient id={gradient} x1="0" x2="0" y1="0" y2="1">
            <stop offset="0" className={t.stopTop} />
            <stop offset="1" className={t.stopBottom} />
          </linearGradient>
        </defs>
        <line
          className={t.baseline}
          x1={INSET}
          x2={chartWidth - INSET}
          y1={geometry.baseline}
          y2={geometry.baseline}
        />
        {geometry.area && (
          <path
            className={t.area}
            d={geometry.area}
            fill={`url(#${gradient})`}
          />
        )}
        <path className={t.line} d={geometry.line} pathLength={1} />
        {shown && (
          <line
            className={t.rule}
            x1={shown.x}
            x2={shown.x}
            y1={INSET}
            y2={geometry.baseline}
          />
        )}
        <circle
          className={t.dot}
          cx={(shown ?? last).x}
          cy={(shown ?? last).y}
          r={4.5}
        />
      </svg>
      {shown && (
        <output
          className={t.tooltip}
          style={{
            left: `${Math.min(Math.max(shown.x, 56), chartWidth - 56)}px`,
          }}
        >
          {shortDate(shown.date)} · {money(shown.cents)}
        </output>
      )}
      <div className={t.axis} aria-hidden="true">
        {labels.map((label) => (
          <span key={label}>{label}</span>
        ))}
      </div>
    </div>
  );
}
