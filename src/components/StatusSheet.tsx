import type { Dashboard } from "../data/api";
import { demo } from "../data/transport";
import { Button, Sheet } from "./Primitives";
import s from "./Shell.module.css";

export function StatusSheet({
  data,
  busy,
  onReload,
  onClose,
}: {
  data: Dashboard;
  busy: boolean;
  onReload: () => void;
  onClose: () => void;
}) {
  const observed = data.wealth.observedAt;
  return (
    <Sheet title="Data status" onClose={onClose}>
      <div className={s.statusLines}>
        {demo && (
          <p>
            <strong>This is a demo with a fictional household</strong>
            <span>
              Every account, balance and transaction is made up. Reviews,
              category changes and rules work, but they stay in this tab:
              reloading the page starts over.
            </span>
          </p>
        )}
        <p>
          <strong>
            {observed
              ? `Balances as of ${new Date(observed).toLocaleString("en-US", { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" })}`
              : "No connected balance date yet"}
          </strong>
          <span>
            Balances reflect the latest observations from connected accounts.
          </span>
        </p>
        <p>
          <strong>
            {data.handoffReviewCount} bank{" "}
            {data.handoffReviewCount === 1
              ? "transaction awaits"
              : "transactions await"}{" "}
            overlap reconciliation
          </strong>
          <span>
            They are held apart from imported history and do not affect cash
            flow.
          </span>
        </p>
        <p>
          <strong>
            {data.stagedPendingCount} pending CSV{" "}
            {data.stagedPendingCount === 1 ? "row is" : "rows are"} staged
          </strong>
          <span>These pending rows do not affect cash flow.</span>
        </p>
        <p>
          <strong>
            {data.wealth.missingCount}{" "}
            {data.wealth.missingCount === 1
              ? "account contains"
              : "accounts contain"}{" "}
            Copilot history only
          </strong>
          <span>
            Newer activity will appear as you connect them. Missing balances do
            not change recorded cash flow.
          </span>
        </p>
        <Button onClick={onReload} disabled={busy}>
          {busy ? "Updating…" : "Reload data"}
        </Button>
      </div>
    </Sheet>
  );
}
