import { useCallback, useEffect, useState } from "react";
import s from "../App.module.css";
import { accountNickname } from "../data/accounts";
import { request } from "../data/api";
import { Button } from "./Primitives";
import w from "./Wealth.module.css";

type BankAccount = {
  id: string;
  name: string;
  type: string;
  subtype: string | null;
  currency: string;
  accountId: string | null;
  reviewCount: number;
};
type PlaidSettings = {
  configured: boolean;
  canConfigure: boolean;
  environment: string | null;
  linkUrl: string | null;
  expiresAt: string | null;
  connections: {
    id: string;
    name: string;
    needsUpdate: boolean;
    accounts: BankAccount[];
  }[];
  existingAccounts: {
    id: string;
    name: string;
    type: string;
    currency: string;
  }[];
};

function AccountSetup({
  account,
  settings,
  busy,
  connect,
}: {
  account: BankAccount;
  settings: PlaidSettings;
  busy: boolean;
  connect: (id: string, accountId: string) => void;
}) {
  const [target, setTarget] = useState("");
  if (account.accountId)
    return (
      <p className={s.caption}>
        {accountNickname(account.name)} · Connected
        {account.reviewCount > 0
          ? ` · ${account.reviewCount} overlapping transactions await review`
          : ""}
      </p>
    );
  return (
    <form
      className={w.homeForm}
      onSubmit={(event) => {
        event.preventDefault();
        connect(account.id, target);
      }}
    >
      <label>
        {accountNickname(account.name)} · {account.subtype ?? account.type}{" "}
        {account.currency}
        <select
          className={w.search}
          value={target}
          onChange={(event) => setTarget(event.target.value)}
          required
          disabled={busy}
        >
          <option value="">Choose its Money account</option>
          {settings.existingAccounts
            .filter(
              (candidate) =>
                (candidate.type === account.type ||
                  candidate.type === "OtherAsset") &&
                candidate.currency === account.currency,
            )
            .map((candidate) => (
              <option key={candidate.id} value={candidate.id}>
                {accountNickname(candidate.name)} — existing history
              </option>
            ))}
          <option value="new">Create a new Money account</option>
        </select>
      </label>
      <p className={s.caption}>
        Choose existing history when this is an account you already imported.
        Accounts already syncing through another connection are unavailable.
      </p>
      <button
        className={w.connectButton}
        type="submit"
        disabled={busy || !target}
      >
        Connect account
      </button>
    </form>
  );
}

export function PlaidConnection({ onConnected }: { onConnected: () => void }) {
  const [settings, setSettings] = useState<PlaidSettings | null>(null);
  const [accountType, setAccountType] = useState("Depository");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const load = useCallback((signal?: AbortSignal) => {
    request<PlaidSettings>("/plaid", { signal })
      .then(setSettings)
      .catch(() => {
        if (!signal?.aborted) setError("Plaid settings could not be loaded.");
      });
  }, []);
  useEffect(() => {
    const controller = new AbortController();
    load(controller.signal);
    return () => controller.abort();
  }, [load]);

  async function mutate(path: string, body: object, message: string) {
    if (busy) return;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      setSettings(
        await request<PlaidSettings>(`/plaid/${path}`, {
          method: "POST",
          body: JSON.stringify(body),
        }),
      );
      setNotice(message);
      onConnected();
    } catch (failure) {
      setError(
        failure instanceof Error ? failure.message : "Please retry shortly.",
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className={w.connectionPanel}>
      <div className={w.connectionHeading}>
        <h2>Plaid</h2>
      </div>
      {!settings && !error && (
        <p className={s.caption}>Loading bank connections…</p>
      )}
      {settings && !settings.canConfigure && (
        <p className={s.caption}>
          A self-hosted administrator can configure Plaid here.
        </p>
      )}
      {settings?.canConfigure && !settings.configured && (
        <p className={s.caption}>
          Plaid’s production connection is waiting for backend configuration.
          Once configured, you can add your bank here.
        </p>
      )}
      {settings?.canConfigure && settings.configured && !settings.linkUrl && (
        <form
          className={w.homeForm}
          onSubmit={(event) => {
            event.preventDefault();
            void mutate(
              "link",
              { accountType },
              "Your sign-in link is ready. Open Plaid below.",
            );
          }}
        >
          <p className={s.caption}>
            {settings.environment === "production"
              ? "Production credentials saved."
              : "Your provider environment must be set to production."}{" "}
            Choose one bank at a time. Plaid may charge for connected products
            under your plan.
          </p>
          <label>
            Account type
            <select
              className={w.search}
              value={accountType}
              onChange={(event) => setAccountType(event.target.value)}
              disabled={busy}
            >
              <option value="Depository">Checking or savings</option>
              <option value="CreditCard">Credit card</option>
              <option value="Investment">Investment or retirement</option>
              <option value="Loan">Loan or mortgage</option>
            </select>
          </label>
          <button className={w.connectButton} type="submit" disabled={busy}>
            {busy ? "Preparing Plaid…" : "Add bank"}
          </button>
        </form>
      )}
      {settings?.canConfigure && settings.linkUrl && (
        <div className={w.homeForm}>
          <p className={s.caption}>
            Open Plaid, choose your bank, sign in and select accounts to share.
            Return here when finished. The sign-in link expires after 30
            minutes.
          </p>
          <a
            className={w.source}
            href={settings.linkUrl}
            target="_blank"
            rel="noreferrer"
          >
            Open Plaid to add your bank ↗
          </a>
          <button
            className={w.connectButton}
            type="button"
            disabled={busy}
            onClick={() =>
              void mutate(
                "complete",
                {},
                "Bank connected. Choose each account’s Money account below to start syncing.",
              )
            }
          >
            {busy ? "Checking Plaid…" : "I finished bank sign-in"}
          </button>
        </div>
      )}
      {settings?.connections.map((connection) => (
        <details key={connection.id} open className={w.holding}>
          <summary>
            <strong>{connection.name}</strong>
            <span>{connection.accounts.length} accounts</span>
          </summary>
          {connection.needsUpdate && (
            <p className={s.caption}>This bank needs sign-in again.</p>
          )}
          {connection.accounts.map((account) => (
            <AccountSetup
              key={account.id}
              account={account}
              settings={settings}
              busy={busy || !settings.canConfigure}
              connect={(id, accountId) =>
                void mutate(
                  `accounts/${id}/connect`,
                  { accountId },
                  "Account connected. Its first sync is queued; balances may take a moment to arrive.",
                )
              }
            />
          ))}
        </details>
      ))}
      {notice && <output className={s.caption}>{notice}</output>}
      {error && (
        <p className={s.caption} role="alert">
          {error}
        </p>
      )}
      {!settings && error && (
        <Button
          variant="secondary"
          onClick={() => {
            setError("");
            load();
          }}
        >
          Retry
        </Button>
      )}
    </section>
  );
}
