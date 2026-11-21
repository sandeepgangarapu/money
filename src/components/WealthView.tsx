import { ChevronRight, Link2 } from "lucide-react";
import { useEffect, useId, useState } from "react";
import { accountNickname } from "../data/accounts";
import type { Dashboard } from "../data/api";
import { money } from "../data/finance";
import {
  type AccountGroup,
  type CombinedHolding,
  STALE_BALANCE_DAYS,
  accountGroups,
  balanceAgeDays,
  dateLabel,
  instrumentLabel,
  liabilityMoney,
  nativeMoney,
  wealthAllocations,
  wealthHoldingTypes,
  wealthHoldings,
} from "../data/wealth";
import { AllocationSankey } from "./AllocationSankey";
import { HomeValuations } from "./HomeValuations";
import { PlaidConnection } from "./PlaidConnection";
import { Button, EmojiTile, Sheet } from "./Primitives";
import w from "./Wealth.module.css";

const percent = (value: number, total: number) =>
  value > 0 && value / total < 0.001
    ? "<0.1%"
    : `${((value / total) * 100).toFixed(1)}%`;

function AccountGroupRow({ group }: { group: AccountGroup }) {
  const [expanded, setExpanded] = useState(false);
  const id = useId();
  const history = group.id === "history";
  return (
    <div className={w.group}>
      <button
        type="button"
        className={w.groupButton}
        aria-expanded={expanded}
        aria-controls={id}
        onClick={() => setExpanded(!expanded)}
      >
        <EmojiTile emoji={group.emoji} color={group.color} size={36} />
        <span className={w.groupName}>
          <span>
            {group.label}
            {history ? ` · ${group.accounts.length}` : ""}
          </span>
          <small>
            {history
              ? "Copilot history only"
              : `${group.accounts.length} ${group.accounts.length === 1 ? "account" : "accounts"}`}
          </small>
        </span>
        {!history && (
          <strong className={w.groupTotal}>
            {group.liability
              ? liabilityMoney(group.totalCents)
              : money(group.totalCents)}
          </strong>
        )}
        <ChevronRight size={16} aria-hidden="true" />
      </button>
      <div id={id} hidden={!expanded} className={w.groupAccounts}>
        {group.accounts.map((account) => (
          <div className={w.account} key={account.id}>
            <span>
              <strong>{accountNickname(account.name)}</strong>
              <small>
                {history
                  ? "Copilot history only"
                  : account.asOf
                    ? `As of ${dateLabel(account.asOf, false)}`
                    : "Balance date unavailable"}
                {account.holdings.length > 0
                  ? ` · ${account.holdings.length} ${account.holdings.length === 1 ? "holding" : "holdings"}`
                  : ["Investment", "Crypto"].includes(account.type) && !history
                    ? " · Holdings not supplied"
                    : ""}
              </small>
            </span>
            <strong>
              {account.balanceCents === null
                ? "Not connected"
                : group.liability
                  ? liabilityMoney(account.balanceCents, true)
                  : money(account.balanceCents, true)}
            </strong>
          </div>
        ))}
      </div>
    </div>
  );
}

function HoldingsList({
  holdings,
  totalCents,
}: { holdings: CombinedHolding[]; totalCents: number }) {
  const [type, setType] = useState("all");
  const [search, setSearch] = useState("");
  const [showAll, setShowAll] = useState(false);
  const needle = search.trim().toLowerCase();
  const visible = holdings.filter(
    (holding) =>
      (type === "all" || holding.instrumentType === type) &&
      `${holding.ticker} ${holding.name} ${holding.positions.map((position) => position.accountName).join(" ")}`
        .toLowerCase()
        .includes(needle),
  );
  const visibleValue = visible.reduce(
    (sum, holding) => sum + (holding.valueCents ?? 0),
    0,
  );
  return (
    <section className={w.section} aria-label="Holdings">
      <div className={w.sectionHeading}>
        <h2>Holdings</h2>
        <strong>{money(visibleValue, true)}</strong>
      </div>
      <div className={w.card}>
        <div className={w.toolbar}>
          <input
            type="search"
            className={w.search}
            aria-label="Search holdings"
            placeholder="Search ticker, holding or account"
            value={search}
            onChange={(event) => {
              setSearch(event.target.value);
              setShowAll(false);
            }}
          />
          <div className={w.filters} aria-label="Holding types">
            <button
              type="button"
              aria-pressed={type === "all"}
              onClick={() => {
                setType("all");
                setShowAll(false);
              }}
            >
              All holdings
            </button>
            {wealthHoldingTypes(holdings).map(({ type: key, label }) => (
              <button
                key={key}
                type="button"
                aria-pressed={type === key}
                onClick={() => {
                  setType(key);
                  setShowAll(false);
                }}
              >
                {label}
              </button>
            ))}
          </div>
        </div>
        {!visible.length && (
          <p className={w.caption}>
            {holdings.length
              ? "No holdings match this search or type."
              : "No positions have been supplied by the connected accounts yet."}
          </p>
        )}
        {(showAll ? visible : visible.slice(0, 8)).map((holding) => {
          const hasTicker = !holding.ticker.startsWith("CUSTOM:");
          const source = holding.positions.find(
            (position) => position.sourceUrl,
          )?.sourceUrl;
          return (
            <details key={holding.id} className={w.holding}>
              <summary>
                <span>
                  <strong>{hasTicker ? holding.ticker : holding.name}</strong>
                  <small>
                    {hasTicker && holding.name !== holding.ticker
                      ? `${holding.name} · `
                      : ""}
                    {instrumentLabel(holding.instrumentType)}
                  </small>
                </span>
                <span className={w.value}>
                  <strong>
                    {holding.valueCents === null
                      ? nativeMoney(holding.value, holding.currency)
                      : money(holding.valueCents, true)}
                  </strong>
                  <small>
                    {holding.valueCents === null
                      ? "USD unavailable"
                      : totalCents > 0
                        ? `${percent(holding.valueCents, totalCents)} of holdings`
                        : ""}
                  </small>
                </span>
                <ChevronRight size={14} aria-hidden="true" />
              </summary>
              <div className={w.positions}>
                <p className={w.caption}>
                  {holding.quantity} units · {holding.positions.length}{" "}
                  {holding.positions.length === 1 ? "account" : "accounts"}
                </p>
                {holding.positions.map((position) => (
                  <div key={position.id} className={w.position}>
                    <span>
                      <strong>{position.accountName}</strong>
                      <small>
                        {position.quantity.replace(
                          /(\.\d*?[1-9])0+$|\.0+$/,
                          "$1",
                        )}{" "}
                        units · {nativeMoney(position.price, position.currency)}
                        /unit
                      </small>
                      <small>As of {dateLabel(position.asOf)}</small>
                    </span>
                    <strong>
                      {position.valueCents === null
                        ? nativeMoney(position.value, position.currency)
                        : money(position.valueCents, true)}
                    </strong>
                  </div>
                ))}
                {source && (
                  <a
                    className={w.source}
                    href={source}
                    target="_blank"
                    rel="noreferrer"
                  >
                    Issuer information ↗
                  </a>
                )}
              </div>
            </details>
          );
        })}
        {visible.length > 8 && (
          <Button
            variant="secondary"
            className={w.showAll}
            aria-expanded={showAll}
            onClick={() => setShowAll(!showAll)}
          >
            {showAll
              ? "Show top 8 holdings"
              : `Show all ${visible.length} holdings`}
          </Button>
        )}
      </div>
    </section>
  );
}

export function WealthView({
  active,
  wealth,
  today,
  onValuationConnected,
}: {
  active: boolean;
  wealth: Dashboard["wealth"];
  today: string;
  onValuationConnected: () => void;
}) {
  const age = balanceAgeDays(wealth.observedAt, today);
  const [sheet, setSheet] = useState<"about" | "connections" | null>(null);
  // A modal sheet left open in a hidden tab would make the whole page inert.
  useEffect(() => {
    if (!active) setSheet(null);
  }, [active]);
  const known = wealth.accounts.filter(
    (account) => account.balanceCents !== null,
  );
  const groups = accountGroups(wealth.accounts);
  const assets = groups.filter(
    (group) => !group.liability && group.totalCents > 0,
  );
  const allocationTotal = assets.reduce(
    (sum, group) => sum + group.totalCents,
    0,
  );
  const { byAccount } = wealthAllocations(wealth.accounts);
  const { holdings, totalCents, foreignCount, byInstrumentType } =
    wealthHoldings(wealth.accounts);
  return (
    <div className={w.wealth}>
      <section className={`${w.card} ${w.hero}`} aria-label="Net worth">
        <span className={w.heroLabel}>
          {wealth.missingCount ? "Connected net worth" : "Net worth"}
        </span>
        <div className={known.length ? w.amount : w.emptyAmount}>
          {known.length ? money(wealth.netWorth) : "No balances connected"}
        </div>
        <p className={w.assetDebt}>
          Assets {money(wealth.assets)} · Debt {money(wealth.debt)}
        </p>
        <p className={w.caption}>
          {wealth.observedAt
            ? `Balances as of ${dateLabel(wealth.observedAt, false)}`
            : "Waiting for connected balances"}
        </p>
        {age !== null && age > STALE_BALANCE_DAYS && (
          <button
            type="button"
            className={w.stale}
            onClick={() => setSheet("connections")}
            aria-label={`Some balances are ${age} days old. Check connections`}
          >
            Some balances are {age} days old ›
          </button>
        )}
        {assets.length > 0 && (
          <>
            <div
              className={w.allocationBar}
              role="img"
              aria-label="Asset allocation"
            >
              {assets.map((group) => (
                <span
                  key={group.id}
                  style={{ flex: group.totalCents, background: group.color }}
                  title={`${group.label} ${percent(group.totalCents, allocationTotal)}`}
                />
              ))}
            </div>
            <ul className={w.legend} aria-label="Asset allocation breakdown">
              {assets.map((group) => (
                <li key={group.id}>
                  <span
                    style={{ background: group.color }}
                    aria-hidden="true"
                  />
                  {group.label}{" "}
                  {group.totalCents / allocationTotal < 0.01
                    ? "<1%"
                    : `${Math.round((group.totalCents / allocationTotal) * 100)}%`}
                </li>
              ))}
            </ul>
          </>
        )}
      </section>
      <section className={w.section} aria-label="Accounts">
        <div className={w.sectionHeading}>
          <h2>Accounts</h2>
        </div>
        <div className={w.accountCard}>
          {groups.map((group) => (
            <AccountGroupRow key={group.id} group={group} />
          ))}
          {!groups.length && (
            <p className={w.caption}>No accounts connected yet.</p>
          )}
        </div>
      </section>
      <HoldingsList holdings={holdings} totalCents={totalCents} />
      <details className={w.disclosure}>
        <summary>
          <span>Allocation charts</span>
          <ChevronRight size={18} aria-hidden="true" />
        </summary>
        <div className={w.charts}>
          {(byAccount.children?.length ?? 0) > 0 && (
            <div className={w.chartPanel}>
              <AllocationSankey root={byAccount} label="Assets by account" />
            </div>
          )}
          {totalCents > 0 && (
            <div className={w.chartPanel}>
              <AllocationSankey
                root={byInstrumentType}
                label="Holdings by type"
              />
            </div>
          )}
          {!byAccount.children?.length && totalCents <= 0 && (
            <p className={w.caption}>
              Connect balances or holdings to see allocation charts.
            </p>
          )}
        </div>
      </details>
      <Button
        variant="ghost"
        className={w.aboutButton}
        onClick={() => setSheet("about")}
      >
        About these numbers
      </Button>
      <button
        type="button"
        className={w.manageConnections}
        onClick={() => setSheet("connections")}
      >
        <Link2 size={20} aria-hidden="true" />
        <span>Manage connections</span>
        <ChevronRight size={18} aria-hidden="true" />
      </button>
      {active && sheet === "about" && (
        <Sheet title="About these numbers" onClose={() => setSheet(null)}>
          <div className={w.definitions}>
            <p>
              {known.length} accounts with observed balances
              {wealth.observedAt
                ? ` · Oldest balance ${dateLabel(wealth.observedAt)}`
                : ""}
              .
              {wealth.missingCount > 0 &&
                ` ${wealth.missingCount} historical accounts still need a connection or current valuation.`}
            </p>
            <p>
              The allocation bar shows connected assets. Debt is separate, and
              holdings do not add to account balances.
            </p>
            <p>
              Tap an account in Assets by account to see its reported holdings.
              Unallocated balance may include cash or positions the connection
              has not supplied.
            </p>
            <p>
              In Holdings by type, tap a type to see individual holdings, then a
              holding to see its accounts. This chart includes reported
              positions; balances without positions are outside this total.
              Chart branches below 1% of their parent are combined into Other.
              Every account and holding remains in the lists above.
            </p>
            <p>
              The same security is combined across accounts. Fund holdings are
              shown as funds, without estimating the stocks inside them. Other
              pooled funds include retirement trusts and plan portfolios whose
              exact structure is not supplied. Similar investments do not make a
              fund an ETF. Unclassified means the instrument type is
              unavailable.
            </p>
            <p>
              Non-USD holdings retain native values and are excluded from USD
              allocations when a USD value is unavailable.
              {foreignCount > 0
                ? ` ${foreignCount} holdings currently have no USD value.`
                : ""}{" "}
              Missing or unconverted account balances are not included in USD
              totals.
            </p>
          </div>
        </Sheet>
      )}
      {active && sheet === "connections" && (
        <Sheet title="Manage connections" onClose={() => setSheet(null)}>
          <div className={w.connectionPanels}>
            <HomeValuations onConnected={onValuationConnected} />
            <PlaidConnection onConnected={onValuationConnected} />
          </div>
        </Sheet>
      )}
    </div>
  );
}
