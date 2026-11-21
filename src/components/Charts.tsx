import { type SankeyNode, sankey, sankeyLinkHorizontal } from "d3-sankey";
import {
  type CSSProperties,
  Fragment,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import s from "../App.module.css";
import { savedAppearance } from "../data/appearance";
import { overviewGroups, sankeyGroups } from "../data/cashFlow";
import type { ActivityFilters } from "../data/filters";
import type { monthSummary } from "../data/finance";
import { bySpending, money } from "../data/finance";
import c from "./CashFlowChart.module.css";

export function useWidth() {
  const ref = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  useLayoutEffect(() => {
    const element = ref.current;
    if (!element) return;
    const observer = new ResizeObserver(([entry]) =>
      setWidth(entry.contentRect.width),
    );
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  return { ref, width };
}
type FlowNode = {
  id: string;
  name: string;
  color: string;
  expandable?: boolean;
  activityFilter?: Partial<ActivityFilters>;
};
type FlowLink = { source: string; target: string; value: number };
type Summary = ReturnType<typeof monthSummary>;
export function CashFlowChart({
  summary,
  view = "detailed",
  onFilter,
  onIncome,
  incomeDisabled = false,
}: {
  summary: Summary;
  view?: "overview" | "detailed";
  onFilter: (patch: Partial<ActivityFilters>) => void;
  onIncome: (trigger: HTMLButtonElement) => void;
  incomeDisabled?: boolean;
}) {
  const { ref, width } = useWidth();
  const titleId = useId();
  const [expanded, setExpanded] = useState<string | null>(null);
  const groups = useMemo(
    () =>
      view === "overview"
        ? overviewGroups(summary.groups)
        : sankeyGroups(summary.groups),
    [summary.groups, view],
  );
  const category = groups.find((group) => group.id === expanded);
  const refundCredits = -groups
    .filter((group) => group.cents < 0)
    .reduce((sum, group) => sum + group.cents, 0);
  const saved = {
    id: "savings",
    name: "Saved",
    color: savedAppearance.color,
    cents: Math.max(0, summary.savings),
    expandable: false,
  };
  const spendingGroups = (
    view === "overview" ? groups : [...groups].sort(bySpending)
  ).map((group) => ({
    ...group,
    expandable:
      group.children.length > 1 &&
      group.breakdown.some((child) => child.cents > 0),
  }));
  const destinations = category
    ? [...category.breakdown]
        .sort(bySpending)
        .filter((child) => child.cents > 0)
        .map((child) => ({
          ...child,
          expandable: false,
          activityFilter: { categories: [child.id] },
        }))
    : (view === "overview"
        ? [...spendingGroups, saved]
        : [saved, ...spendingGroups]
      ).filter((group) =>
        view === "overview" ? group.cents >= 0 : group.cents > 0,
      );
  const labelWidth = width >= 540 ? 260 : width >= 360 ? 200 : 136;
  const height = Math.max(190, destinations.length * 54);
  const sourceName =
    category?.name ??
    (refundCredits > 0
      ? "Income + net refunds"
      : summary.savings < 0
        ? "To cover spending"
        : "Income");
  const sourceValue =
    category?.cents ??
    Math.max(summary.income + refundCredits, summary.spending + refundCredits);
  const graph = useMemo(() => {
    if (width < 1 || sourceValue <= 0 || !destinations.length) return null;
    const nodes: FlowNode[] = [
      {
        id: "source",
        name: sourceName,
        color: category?.color ?? "var(--positive)",
      },
      ...destinations,
    ];
    return sankey<FlowNode, FlowLink>()
      .nodeId((node) => node.id)
      .nodeWidth(6)
      .nodePadding(44)
      .nodeSort(null)
      .iterations(0)
      .extent([
        [7, 28],
        [Math.max(36, width - labelWidth - 8), height - 22],
      ])({
      nodes,
      links: destinations.map((group) => ({
        source: "source",
        target: group.id,
        value: group.cents,
      })),
    });
  }, [
    width,
    labelWidth,
    height,
    sourceValue,
    sourceName,
    category?.color,
    destinations,
  ]);
  const path = sankeyLinkHorizontal<FlowNode, FlowLink>();
  const source = graph?.nodes[0];
  const labelY = source ? Math.max(15, (source.y0 ?? 0) - 32) : 15;
  return (
    <div>
      {!category && refundCredits > 0 && (
        <p className={c.caption}>
          Net refund categories reduce spending by {money(refundCredits)}.
        </p>
      )}
      {!category && summary.savings < 0 && (
        <p className={c.deficitNote}>
          Income {money(summary.income)} · Shortfall {money(-summary.savings)}
        </p>
      )}
      {category && (
        <div className={c.chartBreadcrumb}>
          <button
            type="button"
            className={c.textButton}
            onClick={() => setExpanded(null)}
            aria-label="Back to all cash flow"
          >
            ‹ All cash flow
          </button>
          <span>{category.name}</span>
        </div>
      )}
      <div
        className={c.flowChart}
        ref={ref}
        style={{ "--flow-label-width": `${labelWidth}px` } as CSSProperties}
        data-flow-view={view}
        data-expanded-category={category?.id ?? "all"}
      >
        <svg
          width="100%"
          height={height}
          viewBox={`0 0 ${width || 320} ${height}`}
          role="img"
          aria-labelledby={titleId}
        >
          <title id={titleId}>
            {sourceName}: {money(sourceValue)}.{" "}
            {destinations
              .map((group) => `${group.name} ${money(group.cents)}`)
              .join(", ")}
            .
          </title>
          {(category || sourceName !== "Income") && (
            <>
              <text x="7" y={labelY} className={c.chartSourceLabel}>
                {sourceName}
              </text>
              <text x="7" y={labelY + 17} className={c.chartSourceAmount}>
                {money(sourceValue)}
              </text>
            </>
          )}
          {graph?.links
            .filter((link) => link.value > 0)
            .map((link) => (
              <path
                key={(link.target as SankeyNode<FlowNode, FlowLink>).id}
                d={path(link) ?? ""}
                fill="none"
                style={
                  {
                    "--category-color": (
                      link.target as SankeyNode<FlowNode, FlowLink>
                    ).color,
                  } as CSSProperties
                }
                stroke="var(--category-color)"
                strokeOpacity=".28"
                strokeWidth={Math.max(1, link.width ?? 0)}
              />
            ))}
          {graph?.nodes.map((node) => (
            <rect
              key={node.id}
              x={node.x0}
              y={node.y0}
              width={6}
              height={(node.y1 ?? 0) - (node.y0 ?? 0)}
              style={{ "--category-color": node.color } as CSSProperties}
              fill="var(--category-color)"
              rx="2"
            />
          ))}
        </svg>
        {!category && sourceName === "Income" && (
          <button
            type="button"
            className={c.incomeSourceButton}
            style={{
              top: labelY - 14,
              minHeight: Math.max(
                44,
                (source?.y1 ?? labelY + 30) - labelY + 14,
              ),
            }}
            onClick={(event) => onIncome(event.currentTarget)}
            disabled={incomeDisabled}
            aria-label={`Break down income, ${money(summary.income, true)}`}
            data-income-trigger="source"
          >
            <span>Income ›</span>
            <strong>{money(summary.income)}</strong>
          </button>
        )}
        {graph?.nodes
          .filter((node) => node.id !== "source")
          .map((node) => {
            const style = {
              top: ((node.y0 ?? 0) + (node.y1 ?? 0)) / 2,
              "--category-color": node.color,
            } as CSSProperties;
            const content = (
              <Fragment key={node.id}>
                <span>
                  {node.name}
                  {node.expandable && " ›"}
                </span>
                <strong>{money(node.value ?? 0)}</strong>
              </Fragment>
            );
            return node.expandable || node.activityFilter ? (
              <button
                type="button"
                key={node.id}
                className={c.flowLabel}
                data-saved={node.id === "savings"}
                style={style}
                onClick={() => {
                  if (node.expandable) setExpanded(node.id);
                  else if (node.activityFilter) onFilter(node.activityFilter);
                }}
                aria-label={
                  node.expandable
                    ? `Expand ${node.name}, ${money(node.value ?? 0)}`
                    : `Show all ${node.name} transactions`
                }
                aria-expanded={node.expandable ? false : undefined}
                title={
                  node.expandable ? undefined : `View ${node.name} in Activity`
                }
              >
                {content}
              </button>
            ) : (
              <div
                key={node.id}
                className={`${c.flowLabel} ${c.flowLeaf}`}
                data-saved={node.id === "savings"}
                style={style}
                aria-label={`${node.name}, ${money(node.value ?? 0)}`}
              >
                {content}
              </div>
            );
          })}
      </div>
      {!category && sourceName !== "Income" && (
        <button
          type="button"
          className={c.textButton}
          onClick={(event) => onIncome(event.currentTarget)}
          disabled={incomeDisabled}
          data-income-trigger="source"
        >
          Break down income · {money(summary.income, true)} ›
        </button>
      )}
    </div>
  );
}
export function TrendChart({
  values,
  labels = ["May", "Oct"],
  large = false,
}: { values: number[]; labels?: [string, string]; large?: boolean }) {
  const { ref, width } = useWidth();
  const id = useId();
  const height = large ? 120 : 80;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = Math.max(1, max - min);
  const points = values.map((value, index) => [
    7 + (index / Math.max(1, values.length - 1)) * Math.max(1, width - 14),
    height - 27 - ((value - min) / range) * (height - 47),
  ]);
  return (
    <div ref={ref} className={s.trend}>
      <svg
        width="100%"
        height={height}
        viewBox={`0 0 ${width || 300} ${height}`}
        role="img"
        aria-labelledby={id}
      >
        <title id={id}>
          Net worth from {money(values[0])} to{" "}
          {money(values[values.length - 1])}
        </title>
        <path
          d={points.map(([x, y], i) => `${i ? "L" : "M"}${x},${y}`).join(" ")}
          stroke="var(--blue)"
          strokeWidth="2.5"
          fill="none"
        />
        <circle
          cx={points.at(-1)?.[0]}
          cy={points.at(-1)?.[1]}
          r="3.5"
          fill="var(--blue)"
        />
        <text x="7" y={height - 3}>
          {labels[0]}
        </text>
        <text x={width - 7} y={height - 3} textAnchor="end">
          {labels[1]}
        </text>
      </svg>
    </div>
  );
}
