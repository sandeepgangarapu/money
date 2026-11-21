import { useCallback, useEffect, useId, useState } from "react";
import s from "../App.module.css";
import { request } from "../data/api";
import { money } from "../data/finance";
import { Button } from "./Primitives";
import w from "./Wealth.module.css";

type HomeValuation = {
  id: string;
  connected: boolean;
  canConnect: boolean;
  valueCents: number | null;
};
type HomeSettings = {
  canConfigure: boolean;
  configured: boolean;
  properties: HomeValuation[];
};

function Home({
  home,
  configured,
  onConnected,
}: {
  home: HomeValuation;
  configured: boolean;
  onConnected: (home: HomeValuation) => void;
}) {
  const [apiKey, setApiKey] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const inputId = useId();
  return (
    <section className={w.connectionPanel}>
      <div className={w.connectionHeading}>
        <h2>Home valuation</h2>
        <strong>
          {home.valueCents === null
            ? "Awaiting estimate"
            : money(home.valueCents)}
        </strong>
      </div>
      {!home.connected && home.canConnect && (
        <form
          className={w.homeForm}
          onSubmit={async (event) => {
            event.preventDefault();
            if (busy) return;
            setBusy(true);
            setError("");
            const key = apiKey.trim();
            setApiKey("");
            try {
              const result = await request<HomeValuation>(
                `/properties/${home.id}/connect`,
                { method: "POST", body: JSON.stringify({ api_key: key }) },
              );
              onConnected(result);
            } catch (failure) {
              setError(
                failure instanceof Error
                  ? failure.message
                  : "Unable to connect RentCast. Please retry.",
              );
            } finally {
              setBusy(false);
            }
          }}
        >
          {!configured && (
            <label htmlFor={inputId}>
              RentCast API key
              <input
                id={inputId}
                type="password"
                autoComplete="off"
                spellCheck={false}
                autoCapitalize="none"
                className={w.search}
                value={apiKey}
                maxLength={512}
                required
                disabled={busy}
                onChange={(event) => setApiKey(event.target.value)}
              />
            </label>
          )}
          <p className={s.caption}>
            {configured
              ? "Uses your saved RentCast connection."
              : "Your key is encrypted on the server and never saved in browser storage."}{" "}
            Fetches one estimate now, then automatically once per calendar
            month. Dashboard visits use the saved estimate.
          </p>
          <button type="submit" className={w.connectButton} disabled={busy}>
            {busy ? "Fetching home estimate…" : "Connect home valuation"}
          </button>
          {error && <p role="alert">{error}</p>}
        </form>
      )}
    </section>
  );
}

export function HomeValuations({ onConnected }: { onConnected: () => void }) {
  const [settings, setSettings] = useState<HomeSettings | null>(null);
  const [error, setError] = useState("");
  const load = useCallback((signal?: AbortSignal) => {
    setError("");
    request<HomeSettings>("/properties", { signal })
      .then(setSettings)
      .catch(() => {
        if (!signal?.aborted)
          setError("Home valuation settings could not be loaded.");
      });
  }, []);
  useEffect(() => {
    const controller = new AbortController();
    load(controller.signal);
    return () => controller.abort();
  }, [load]);
  if (settings && !settings.properties.length) return null;
  return (
    <>
      {(!settings || error) && (
        <section className={w.connectionPanel}>
          <div className={w.connectionHeading}>
            <h2>Home valuation</h2>
          </div>
          {!error && <p className={s.caption}>Loading home valuation…</p>}
          {error && (
            <p role="alert">
              {error}{" "}
              <Button variant="secondary" onClick={() => load()}>
                Retry
              </Button>
            </p>
          )}
        </section>
      )}
      {settings?.properties.map((home) => (
        <Home
          key={home.id}
          home={home}
          configured={settings.configured}
          onConnected={(result) => {
            setSettings({
              ...settings,
              configured: true,
              properties: settings.properties.map((item) =>
                item.id === result.id ? result : item,
              ),
            });
            onConnected();
          }}
        />
      ))}
    </>
  );
}
