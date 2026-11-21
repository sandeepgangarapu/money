import { sankey, sankeyLinkHorizontal } from "d3-sankey";
import { ChevronLeft } from "lucide-react";
import { useEffect, useId, useMemo, useRef } from "react";
import s from "../App.module.css";
import type { CashFlowSummary, IncomeSource } from "../data/api";
import { incomeActivityFilters, incomeFlow } from "../data/cashFlow";
import type { ActivityFilters } from "../data/filters";
import { money, shortDate } from "../data/finance";
import { displayName } from "../data/merchant";
import { useWidth } from "./Charts";
import { Button } from "./Primitives";

type IncomeNode = { id: string; name: string };
type IncomeLink = { source: string; target: string; value: number };

export function IncomeBreakdown({
  summary,
  reportPeriod,
  onBack,
  onFilter,
}: {
  summary: CashFlowSummary;
  reportPeriod: string;
  onBack: () => void;
  onFilter: (patch: Partial<ActivityFilters>) => void;
}) {
  const { ref, width } = useWidth();
  const back = useRef<HTMLElement>(null);
  const titleId = useId();
  const sources = summary.incomeBreakdown.sources;
  const flow = incomeFlow(sources, summary.income);
  const graph = useMemo(() => {
    const positive = sources.filter((source) => source.cents > 0);
    if (width < 1 || !positive.length) return null;
    return sankey<IncomeNode, IncomeLink>()
      .nodeId((node) => node.id)
      .nodeWidth(5)
      .nodePadding(Math.min(12, 60 / positive.length))
      .nodeSort(null)
      .iterations(0)
      .extent([
        [5, 5],
        [Math.max(20, width - 5), 125],
      ])({
      nodes: [
        ...positive.map((source) => ({ id: source.key, name: source.label })),
        { id: "total", name: "Income" },
      ],
      links: positive.map((source) => ({
        source: source.key,
        target: "total",
        value: source.cents,
      })),
    });
  }, [sources, width]);
  const path = sankeyLinkHorizontal<IncomeNode, IncomeLink>();
  useEffect(() => {
    back.current?.querySelector("button")?.focus({ preventScroll: true });
  }, []);
  function sourceRow(source: IncomeSource) {
    const { title } = displayName(source.label);
    return (
      <li key={source.key}>
        <button
          type="button"
          className={s.incomeRow}
          onClick={() => onFilter(incomeActivityFilters(reportPeriod, source))}
          aria-label={`Show ${source.label} income entries, ${money(source.cents, true)}`}
        >
          <span>
            {title}
            <small title={source.label}>
              {source.transactionCount}{" "}
              {source.transactionCount === 1 ? "entry" : "entries"}
              {title !== source.label && ` · ${source.label}`}
            </small>
          </span>
          <span className={s.incomeAmount}>
            <strong>{money(source.cents, true)} ›</strong>
            {flow.percentage(source) && (
              <small>{flow.percentage(source)}</small>
            )}
          </span>
        </button>
      </li>
    );
  }
  return (
    <div data-income-breakdown={reportPeriod}>
      <nav ref={back} className={s.chartBreadcrumb} aria-label="Cash flow path">
        <Button variant="ghost" size="sm" onClick={onBack}>
          <ChevronLeft size={18} aria-hidden="true" /> Back
        </Button>
        <span>Income sources</span>
      </nav>
      <p className={s.caption}>
        {shortDate(summary.incomeBreakdown.startDate)}–
        {shortDate(summary.incomeBreakdown.endDate)},{" "}
        {summary.incomeBreakdown.endDate.slice(0, 4)} · Posted, included income
      </p>
      <div className={s.incomeGraph}>
        <div ref={ref}>
          {flow.positive.length > 0 && (
            <svg
              width="100%"
              height="130"
              viewBox={`0 0 ${width || 200} 130`}
              role="img"
              aria-labelledby={titleId}
            >
              <title id={titleId}>
                {flow.positive
                  .map(
                    (source) => `${source.label} ${money(source.cents, true)}`,
                  )
                  .join(", ")}
                . Positive sources total {money(flow.positiveCents, true)}.
              </title>
              {graph?.links.map((link, index) => (
                <path
                  key={flow.positive[index].key}
                  d={path(link) ?? ""}
                  fill="none"
                  stroke="var(--green)"
                  strokeOpacity=".25"
                  strokeWidth={Math.max(1, link.width ?? 0)}
                />
              ))}
              {graph?.nodes.map((node) => (
                <rect
                  key={node.id}
                  x={node.x0}
                  y={node.y0}
                  width="5"
                  height={Math.max(1, (node.y1 ?? 0) - (node.y0 ?? 0))}
                  fill="var(--green)"
                  rx="1"
                />
              ))}
            </svg>
          )}
        </div>
        <div className={s.incomeTotal}>
          <span>
            {flow.adjustments.length > 0 && flow.positive.length > 0
              ? "Before adjustments"
              : "Income"}
          </span>
          <strong>
            {money(
              flow.adjustments.length > 0 && flow.positive.length > 0
                ? flow.positiveCents
                : summary.income,
              true,
            )}
          </strong>
          <small>
            {sources.reduce((sum, source) => sum + source.transactionCount, 0)}{" "}
            entries
          </small>
        </div>
      </div>
      {sources.length > 0 ? (
        <>
          {flow.adjustments.length > 0 && (
            <p className={s.caption}>
              Positive sources {money(flow.positiveCents, true)} − adjustments{" "}
              {money(flow.adjustmentCents, true)} = income{" "}
              {money(summary.income, true)}.
              {summary.income > 0
                ? " Percentages use net income and can exceed 100%."
                : " Percentages are unavailable when net income is zero or negative."}
            </p>
          )}
          <ul className={s.incomeSources} aria-label="Income sources">
            {sources.filter((source) => source.cents >= 0).map(sourceRow)}
          </ul>
          {flow.adjustments.length > 0 && (
            <>
              <h3 className={s.incomeAdjustments}>Adjustments</h3>
              <ul className={s.incomeSources} aria-label="Income adjustments">
                {flow.adjustments.map(sourceRow)}
              </ul>
            </>
          )}
          <button
            type="button"
            className={s.textButton}
            onClick={() => onFilter(incomeActivityFilters(reportPeriod))}
          >
            View all income entries ›
          </button>
        </>
      ) : (
        <p className={s.caption}>No posted, included income in this period.</p>
      )}
    </div>
  );
}
