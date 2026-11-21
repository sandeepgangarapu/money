import {
  ArrowRightLeft,
  ChevronLeft,
  ChevronRight,
  Layers,
  PieChart,
  Shapes,
} from "lucide-react";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { flushSync } from "react-dom";
import s from "./App.module.css";
import { ActivityView } from "./components/ActivityView";
import { CashFlowView } from "./components/CashFlowView";
import { CategoriesView } from "./components/CategoriesView";
import { RulesProvider } from "./components/MoneyRules";
import { MonthSheet } from "./components/MonthSheet";
import { SheetExtrasProvider } from "./components/Primitives";
import { ReviewView, prefetchReviewQueue } from "./components/ReviewView";
import shell from "./components/Shell.module.css";
import { StatusSheet } from "./components/StatusSheet";
import { ToastProvider, Toasts } from "./components/Toasts";
import type { TransactionPatch } from "./components/Transactions";
import { WealthView } from "./components/WealthView";
import type { Dashboard } from "./data/api";
import { cashFlowPeriodLabel, dashboardStatus } from "./data/cashFlow";
import {
  type ActivityFilters,
  emptyFilters,
  shortcutFilters,
} from "./data/filters";
import { type Tab, type Transaction, months } from "./data/finance";
import { type Period, type Route, formatRoute, parseRoute } from "./data/route";
import { demo } from "./data/transport";
import { type MoneyStore, useMoneyStore } from "./useMoneyStore";

const tabs = [
  { id: "flow", label: "Cash flow", icon: ArrowRightLeft },
  { id: "wealth", label: "Wealth", icon: PieChart },
  { id: "categories", label: "Categories", icon: Shapes },
  { id: "activity", label: "Activity", icon: Layers },
] as const;

// Cross-fades screen changes where supported; the new screen renders first.
function transition(update: () => void) {
  if (
    !("startViewTransition" in document) ||
    window.matchMedia("(prefers-reduced-motion: reduce)").matches
  ) {
    update();
    return;
  }
  document.startViewTransition(() => flushSync(update));
}

function BottomNav({
  screen,
  reviewCount,
}: { screen: Route["screen"]; reviewCount: number }) {
  return (
    <nav className={shell.bottomNav} aria-label="Main navigation">
      {tabs.map(({ id, label, icon: Icon }) => (
        <a
          key={id}
          href={`#/${id}`}
          aria-current={screen === id ? "page" : undefined}
          aria-label={
            id === "activity" && reviewCount > 0
              ? `Activity, ${reviewCount} to review`
              : undefined
          }
        >
          <span className={shell.navIcon}>
            <Icon size={22} strokeWidth={screen === id ? 2.1 : 1.7} />
            {id === "activity" && reviewCount > 0 && (
              <span className={shell.badge} aria-hidden="true">
                {reviewCount > 99 ? "99+" : reviewCount}
              </span>
            )}
          </span>
          <span>{label}</span>
        </a>
      ))}
    </nav>
  );
}

export default function App() {
  const store = useMoneyStore();
  if (!store.data) {
    // The real header and tab bar paint first; placeholders fade in only if
    // loading takes longer than a moment.
    const screen = parseRoute(location.hash).screen;
    return (
      <div className={shell.app}>
        <main className={shell.main} aria-busy={!store.error}>
          {screen !== "review" && (
            <header className={shell.header}>
              <h1>{tabs.find((item) => item.id === screen)?.label}</h1>
            </header>
          )}
          <div aria-hidden="true" className={shell.placeholders}>
            <div className={`${shell.skeleton} ${shell.skeletonBlock}`} />
            <div className={`${shell.skeleton} ${shell.skeletonBlock}`} />
          </div>
          <output className={s.visuallyHidden}>
            {store.error
              ? "Accounts and transactions could not be loaded."
              : "Loading your accounts and transactions…"}
          </output>
        </main>
        <BottomNav screen={screen} reviewCount={0} />
        <ToastProvider
          value={{
            undo: null,
            onUndo: () => {},
            error: store.error,
            onRetry: store.retry,
          }}
        >
          <Toasts />
        </ToastProvider>
      </div>
    );
  }
  return <MoneyDashboard store={store} data={store.data} />;
}

function MoneyDashboard({
  store,
  data,
}: { store: MoneyStore; data: Dashboard }) {
  const [route, setRoute] = useState<Route>(() => parseRoute(location.hash));
  const tab = route.screen;
  const [filters, setFilters] = useState<ActivityFilters>(emptyFilters);
  const [search, setSearch] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [activityFocus, setActivityFocus] = useState(0);
  const scrollPositions = useRef<Partial<Record<Route["screen"], number>>>({});
  const reviewReturn = useRef<Tab>("flow");
  const currentTab = useRef(tab);
  const month = store.month ?? data.month;
  const storeMonth = useRef(month);
  storeMonth.current = month;
  const currentMonth = months.at(-1)?.id ?? data.month;
  const monthIndex = months.findIndex((item) => item.id === month);
  const monthInfo = months[monthIndex];
  const [monthOpen, setMonthOpen] = useState(false);
  const [statusOpen, setStatusOpen] = useState(false);
  const [scrolled, setScrolled] = useState(window.scrollY > 0);
  const status = dashboardStatus({
    loading: store.refreshing || store.switching,
    saving: store.saving,
    handoffReviewCount: data.handoffReviewCount,
    stagedPendingCount: data.stagedPendingCount,
    missingCount: data.wealth.missingCount,
  });
  const reviewCount = store.reviewCount;
  // The review queue loads quietly after start-up so Review opens instantly.
  useEffect(() => {
    const timer = window.setTimeout(prefetchReviewQueue, 1500);
    return () => window.clearTimeout(timer);
  }, []);
  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 0);
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);
  useEffect(() => {
    const onHash = () => {
      const next = parseRoute(location.hash);
      scrollPositions.current[currentTab.current] = window.scrollY;
      if (next.screen === "review" && currentTab.current !== "review")
        reviewReturn.current = currentTab.current;
      transition(() => {
        setRoute(next);
        setEditingId(null);
      });
      if (next.month && next.month !== storeMonth.current)
        store.setMonth(next.month);
    };
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, [store.setMonth]);
  // Month and period changes replace the URL instead of adding history.
  useEffect(() => {
    const hash = formatRoute({ ...route, month }, currentMonth);
    if (location.hash !== hash) history.replaceState(null, "", hash);
  }, [route, month, currentMonth]);
  useLayoutEffect(() => {
    currentTab.current = tab;
    window.scrollTo({
      top: scrollPositions.current[tab] ?? 0,
      behavior: "instant",
    });
  }, [tab]);
  // ⌘Z / Ctrl+Z undoes the last change while its toast is showing.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (
        event.key.toLowerCase() !== "z" ||
        !(event.metaKey || event.ctrlKey) ||
        event.shiftKey ||
        !store.undo
      )
        return;
      const target = event.target as HTMLElement | null;
      if (target?.closest("input, textarea, [contenteditable='true']")) return;
      event.preventDefault();
      store.undoLast();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [store.undo, store.undoLast]);
  function navigate(next: Route["screen"]) {
    if (next !== tab)
      location.hash = formatRoute(
        { ...route, screen: next, month },
        currentMonth,
      );
  }
  function openActivity(patch: Partial<ActivityFilters> = {}) {
    setFilters(shortcutFilters(patch));
    setSearch("");
    setEditingId(null);
    setActivityFocus((value) => value + 1);
    scrollPositions.current.activity = 0;
    navigate("activity");
    if (tab === "activity") window.scrollTo({ top: 0, behavior: "instant" });
  }
  function changeTransaction(
    transaction: Transaction,
    patch: TransactionPatch,
  ) {
    store.updateTransaction(transaction, patch);
  }
  function changeMonth(index: number) {
    const next = months[index];
    if (!next) return;
    setEditingId(null);
    store.setMonth(next.id);
  }
  function setPeriod(period: Period) {
    setRoute((current) => ({ ...current, period }));
  }
  return (
    <div className={shell.app}>
      <ToastProvider
        value={{
          undo: store.undo,
          onUndo: store.undoLast,
          error: store.error,
          onRetry: store.retry,
        }}
      >
        <SheetExtrasProvider value={<Toasts />}>
          <RulesProvider onApplied={store.retry}>
            <button
              type="button"
              className={s.skipLink}
              onClick={() => document.getElementById("main-content")?.focus()}
            >
              Skip to content
            </button>
            <main
              id="main-content"
              className={shell.main}
              tabIndex={-1}
              data-switching={store.switching}
            >
              <header
                className={shell.header}
                data-scrolled={scrolled}
                hidden={tab === "review"}
              >
                <h1>
                  {tabs.find((item) => item.id === tab)?.label}
                  {demo && (
                    <button
                      type="button"
                      className={shell.demoPill}
                      onClick={() => setStatusOpen(true)}
                      aria-haspopup="dialog"
                    >
                      Demo
                    </button>
                  )}
                </h1>
                {(tab === "flow" || tab === "categories") && monthInfo && (
                  <div className={shell.monthPicker}>
                    <button
                      type="button"
                      className={shell.iconButton}
                      disabled={monthIndex <= 0}
                      onClick={() => changeMonth(monthIndex - 1)}
                      aria-label="Previous month"
                    >
                      <ChevronLeft size={18} />
                    </button>
                    <button
                      type="button"
                      className={shell.monthLabel}
                      onClick={() => setMonthOpen(true)}
                      aria-label={`Choose month, ${monthInfo.label}`}
                      aria-haspopup="dialog"
                      aria-expanded={monthOpen}
                    >
                      {monthInfo.label}
                      <small>{cashFlowPeriodLabel(month, data.today)}</small>
                    </button>
                    <button
                      type="button"
                      className={shell.iconButton}
                      disabled={monthIndex === months.length - 1}
                      onClick={() => changeMonth(monthIndex + 1)}
                      aria-label="Next month"
                    >
                      <ChevronRight size={18} />
                    </button>
                  </div>
                )}
                <button
                  type="button"
                  className={shell.iconButton}
                  onClick={() => setStatusOpen(true)}
                  aria-label={`${status.label}. Open data status`}
                  aria-haspopup="dialog"
                  aria-expanded={statusOpen}
                >
                  <span
                    className={shell.statusDot}
                    data-state={status.state}
                    aria-hidden="true"
                  />
                </button>
              </header>
              <section
                hidden={tab !== "flow"}
                aria-label="Monthly and yearly cash flow"
                data-month-scoped
              >
                <CashFlowView
                  data={data}
                  transactions={store.transactions}
                  period={route.period}
                  onPeriod={setPeriod}
                  reviewCount={reviewCount}
                  loading={store.switching}
                  editingId={editingId}
                  onEdit={setEditingId}
                  onChange={changeTransaction}
                  onFilter={openActivity}
                  onReview={() => navigate("review")}
                  onCategories={() => navigate("categories")}
                  onWealth={() => navigate("wealth")}
                  onPreviousMonth={
                    monthIndex > 0
                      ? () => changeMonth(monthIndex - 1)
                      : undefined
                  }
                  onNextMonth={
                    monthIndex < months.length - 1
                      ? () => changeMonth(monthIndex + 1)
                      : undefined
                  }
                />
              </section>
              <ReviewView
                active={tab === "review"}
                store={store}
                reviewCount={reviewCount}
                onFilter={openActivity}
                onClose={() => navigate(reviewReturn.current)}
              />
              <section hidden={tab !== "wealth"} aria-label="Household wealth">
                <WealthView
                  active={tab === "wealth"}
                  wealth={data.wealth}
                  today={data.today}
                  onValuationConnected={store.retry}
                />
              </section>
              <section hidden={tab !== "activity"} aria-label="Transactions">
                <ActivityView
                  store={store}
                  reviewCount={reviewCount}
                  filters={filters}
                  onFilters={setFilters}
                  search={search}
                  onSearch={setSearch}
                  onFilter={openActivity}
                  editingId={editingId}
                  onEdit={setEditingId}
                  onChange={changeTransaction}
                  resetKey={activityFocus}
                />
              </section>
              <section
                hidden={tab !== "categories"}
                aria-label="Spending categories"
                data-month-scoped
              >
                <CategoriesView
                  active={tab === "categories"}
                  month={data.month}
                  summary={data.summary}
                  yearlySummary={data.yearlySummary}
                  store={store}
                  onFilter={openActivity}
                  onChange={changeTransaction}
                />
              </section>
            </main>
            <BottomNav screen={tab} reviewCount={reviewCount} />
            <Toasts />
            {monthOpen && (
              <MonthSheet
                months={months}
                selected={month}
                today={data.today}
                onChange={changeMonth}
                onClose={() => setMonthOpen(false)}
              />
            )}
            {statusOpen && (
              <StatusSheet
                data={data}
                busy={store.refreshing || store.saving > 0}
                onReload={store.retry}
                onClose={() => setStatusOpen(false)}
              />
            )}
          </RulesProvider>
        </SheetExtrasProvider>
      </ToastProvider>
    </div>
  );
}
