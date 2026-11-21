import { ChevronRight } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { Dashboard } from "../data/api";
import { cashFlowPeriodLabel, savingsRate } from "../data/cashFlow";
import type { ActivityFilters } from "../data/filters";
import { type Transaction, money, months } from "../data/finance";
import type { Period } from "../data/route";
import { swipeIntent } from "../data/swipe";
import s from "./CashFlow.module.css";
import { CashFlowChart } from "./Charts";
import { IncomeBreakdown } from "./IncomeBreakdown";
import { Button, Panel, PanelHeading, SegmentedControl } from "./Primitives";
import { SpendingTrend } from "./SpendingTrend";
import { type TransactionPatch, TransactionRow } from "./Transactions";

function spentLabel(period: Period, month: string, today: string) {
  const current =
    period === "month"
      ? month === today.slice(0, 7)
      : month.slice(0, 4) === today.slice(0, 4);
  if (current)
    return period === "month" ? "Spent so far" : "Spent so far this year";
  return `Spent in ${
    period === "month"
      ? (months.find((item) => item.id === month)?.short ?? month)
      : month.slice(0, 4)
  }`;
}

export function CashFlowView({
  data,
  transactions,
  period,
  onPeriod,
  reviewCount,
  loading,
  editingId,
  onEdit,
  onChange,
  onFilter,
  onReview,
  onCategories,
  onWealth,
  onPreviousMonth,
  onNextMonth,
}: {
  data: Dashboard;
  transactions: Transaction[];
  period: Period;
  onPeriod: (period: Period) => void;
  reviewCount: number;
  loading: boolean;
  editingId: string | null;
  onEdit: (id: string | null) => void;
  onChange: (transaction: Transaction, patch: TransactionPatch) => void;
  onFilter: (patch?: Partial<ActivityFilters>) => void;
  onReview: () => void;
  onCategories: () => void;
  onWealth: () => void;
  onPreviousMonth?: () => void;
  onNextMonth?: () => void;
}) {
  const [view, setView] = useState<"overview" | "detailed">("overview");
  const [incomeOpen, setIncomeOpen] = useState(false);
  const incomeTrigger = useRef<HTMLButtonElement | null>(null);
  const flowArea = useRef<HTMLDivElement>(null);
  const reportPeriod = period === "month" ? data.month : data.month.slice(0, 4);
  const summary = period === "month" ? data.summary : data.yearlySummary;
  const rate = savingsRate(summary.savings, summary.income);
  const days = data.spendingByDay?.[period];
  const swipe = useRef<{ id: number; x: number; y: number } | null>(null);
  // A different month or period closes the income breakdown.
  useEffect(() => {
    void reportPeriod;
    setIncomeOpen(false);
  }, [reportPeriod]);
  function openIncome(trigger: HTMLButtonElement) {
    incomeTrigger.current = trigger;
    setIncomeOpen(true);
    requestAnimationFrame(() =>
      flowArea.current?.scrollIntoView({ block: "nearest" }),
    );
  }
  function closeIncome() {
    setIncomeOpen(false);
    requestAnimationFrame(() =>
      incomeTrigger.current?.focus({ preventScroll: true }),
    );
  }
  return (
    <div className={s.view}>
      <div className={s.periodControl}>
        <SegmentedControl
          value={period}
          options={[
            { value: "month", label: "Month" },
            { value: "year", label: "Year" },
          ]}
          onChange={onPeriod}
          label="Cash flow period"
        />
        {reviewCount > 0 && (
          <button
            type="button"
            className={s.reviewPill}
            onClick={onReview}
            aria-label={`Review ${reviewCount} new transaction${reviewCount === 1 ? "" : "s"}`}
          >
            <span className={s.reviewDot} aria-hidden="true" />
            {reviewCount} to review
            <ChevronRight size={16} aria-hidden="true" />
          </button>
        )}
      </div>
      <Panel className={s.summary}>
        {/* Swiping the summary sideways steps through months. */}
        <div
          className={s.hero}
          onPointerDown={(event) => {
            if (
              period !== "month" ||
              event.pointerType === "mouse" ||
              (event.target as Element).closest("svg")
            )
              return;
            swipe.current = {
              id: event.pointerId,
              x: event.clientX,
              y: event.clientY,
            };
          }}
          onPointerUp={(event) => {
            const start = swipe.current;
            swipe.current = null;
            if (!start || start.id !== event.pointerId) return;
            const dx = event.clientX - start.x;
            if (
              Math.abs(dx) < 64 ||
              swipeIntent(dx, event.clientY - start.y) === "scroll"
            )
              return;
            (dx > 0 ? onPreviousMonth : onNextMonth)?.();
          }}
          onPointerCancel={() => {
            swipe.current = null;
          }}
        >
          <button
            type="button"
            className={s.spent}
            onClick={onCategories}
            aria-label={`${spentLabel(period, data.month, data.today)}, ${money(summary.spending, true)}. Open categories`}
          >
            <span>
              {spentLabel(period, data.month, data.today)}
              {period === "year" &&
                ` · ${cashFlowPeriodLabel(reportPeriod, data.today)}`}
            </span>
            <strong>{money(summary.spending)}</strong>
          </button>
          {days && (
            <SpendingTrend
              days={days}
              period={reportPeriod}
              today={data.today}
            />
          )}
        </div>
        <div className={s.metrics}>
          <button
            type="button"
            onClick={(event) => openIncome(event.currentTarget)}
            disabled={loading}
            aria-expanded={incomeOpen}
            aria-label={`Break down income, ${money(summary.income, true)}`}
            data-income-trigger="summary"
          >
            <span>Income ›</span>
            <strong>{money(summary.income)}</strong>
          </button>
          <div className={s.saved} data-negative={summary.savings < 0}>
            <span>
              {summary.savings < 0 ? "Shortfall" : "Saved"}
              {rate && ` · ${rate}`}
            </span>
            <strong>{money(Math.abs(summary.savings))}</strong>
          </div>
        </div>
        {summary.principalCents > 0 && (
          <p className={s.caption}>
            Includes {money(summary.principalCents)} of loan principal
          </p>
        )}
      </Panel>
      <Panel className={s.flow}>
        <div className={s.flowHeading}>
          <h2>Where it went</h2>
          <SegmentedControl
            value={view}
            options={[
              { value: "overview", label: "Overview" },
              { value: "detailed", label: "All categories" },
            ]}
            onChange={(next) => {
              setView(next);
              setIncomeOpen(false);
            }}
            label="Cash flow detail"
            size="sm"
          />
        </div>
        <div ref={flowArea}>
          <div hidden={incomeOpen}>
            <CashFlowChart
              key={`${reportPeriod}-${view}`}
              summary={summary}
              view={view}
              onFilter={onFilter}
              onIncome={openIncome}
              incomeDisabled={loading}
            />
          </div>
          {incomeOpen && (
            <IncomeBreakdown
              key={reportPeriod}
              summary={summary}
              reportPeriod={reportPeriod}
              onBack={closeIncome}
              onFilter={onFilter}
            />
          )}
        </div>
      </Panel>
      <button type="button" className={s.netWorth} onClick={onWealth}>
        <span>Net worth</span>
        <strong>{money(data.wealth.netWorth)}</strong>
        <ChevronRight size={18} aria-hidden="true" />
      </button>
      <Panel className={s.recent}>
        <PanelHeading
          action={
            <Button variant="ghost" size="sm" onClick={() => onFilter()}>
              See all
            </Button>
          }
        >
          Recent
        </PanelHeading>
        {[...transactions]
          .sort((a, b) => b.date.localeCompare(a.date))
          .slice(0, 5)
          .map((transaction) => (
            <TransactionRow
              key={transaction.id}
              transaction={transaction}
              expanded={editingId === transaction.id}
              onToggle={() =>
                onEdit(editingId === transaction.id ? null : transaction.id)
              }
              onChange={(patch) => onChange(transaction, patch)}
              onFilter={onFilter}
            />
          ))}
        {transactions.length === 0 && (
          <p className={s.caption}>No transactions this month.</p>
        )}
      </Panel>
    </div>
  );
}
