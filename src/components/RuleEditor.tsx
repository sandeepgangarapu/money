import { useId, useState } from "react";
import s from "../App.module.css";
import { accountNickname } from "../data/accounts";
import { type Transaction, signedMoney } from "../data/finance";
import {
  type MoneyRule,
  type RuleDraft,
  type RulePreview,
  type RuleResult,
  categoryIdFor,
  draftFor,
  previewRule,
  ruleCategory,
  writeRule,
} from "../data/rules";
import { CategoryPicker } from "./CategoryPicker";
import { Button, Sheet } from "./Primitives";

export function RuleEditor({
  rule,
  transaction,
  applyMode,
  onClose,
  onComplete,
}: {
  rule?: MoneyRule;
  transaction?: Transaction;
  applyMode: boolean;
  onClose: () => void;
  onComplete: (result: RuleResult) => void;
}) {
  const [draft, setDraft] = useState<RuleDraft>(rule ?? draftFor(transaction));
  const [preview, setPreview] = useState<RulePreview | null>(null);
  const [applyExisting, setApplyExisting] = useState(applyMode);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const matchId = useId();
  const category = ruleCategory(draft.categoryId);
  function change(patch: Partial<RuleDraft>) {
    setDraft((current) => ({ ...current, ...patch }));
    setPreview(null);
    setApplyExisting(false);
    setError("");
  }
  async function loadPreview() {
    setBusy(true);
    setError("");
    try {
      setPreview(await previewRule(draft, rule?.id));
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "Could not preview rule",
      );
      setPreview(null);
    } finally {
      setBusy(false);
    }
  }
  async function submit() {
    if (!preview) return loadPreview();
    setBusy(true);
    setError("");
    try {
      onComplete(
        await writeRule(
          draft,
          preview,
          applyExisting && preview.matchCount > 0,
          rule?.id,
        ),
      );
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "Could not update rule",
      );
      setPreview(null);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Sheet title={rule ? "Edit rule" : "Create rule"} onClose={onClose}>
      <form
        className={s.ruleForm}
        onSubmit={(event) => {
          event.preventDefault();
          void submit();
        }}
      >
        <fieldset disabled={busy} className={s.ruleFields}>
          <div className={s.ruleMatchFields}>
            <fieldset className={s.matchMode}>
              <legend className={s.visuallyHidden}>
                Match transaction name
              </legend>
              {(["contains", "exact"] as const).map((matchType) => (
                <label
                  key={matchType}
                  className={s.matchModeOption}
                  data-selected={draft.matchType === matchType}
                >
                  <input
                    type="radio"
                    name={matchId}
                    value={matchType}
                    checked={draft.matchType === matchType}
                    onChange={() => {
                      const suggested = draftFor(transaction).pattern;
                      change({
                        matchType,
                        ...(transaction &&
                        (draft.pattern === suggested ||
                          draft.pattern === transaction.name)
                          ? {
                              pattern:
                                matchType === "exact"
                                  ? transaction.name
                                  : suggested,
                            }
                          : {}),
                      });
                    }}
                  />
                  <span>{matchType === "contains" ? "Contains" : "Exact"}</span>
                </label>
              ))}
            </fieldset>
            <label>
              <span className={s.visuallyHidden}>
                {draft.matchType === "exact"
                  ? "Transaction name"
                  : "Text to find"}
              </span>
              <input
                type="text"
                value={draft.pattern}
                maxLength={200}
                aria-describedby={`${matchId}-hint`}
                required
                placeholder="e.g. NETFLIX.COM"
                onChange={(event) => change({ pattern: event.target.value })}
              />
            </label>
          </div>
          <p id={`${matchId}-hint`} className={s.caption}>
            {draft.matchType === "contains"
              ? "Matches anywhere in the name, ignoring case."
              : "Matches the full name and letter case."}
          </p>
          <div className={s.ruleCategoryField}>
            <span>Assign category</span>
            <CategoryPicker
              category={category.category}
              subcategory={category.subcategory}
              allowUncategorized={false}
              onChange={(patch) =>
                change({
                  categoryId: categoryIdFor(
                    patch.category ?? null,
                    patch.subcategory ?? "",
                  ),
                })
              }
            />
          </div>
          <label className={s.ruleCheck}>
            <input
              type="checkbox"
              checked={draft.active}
              onChange={(event) => change({ active: event.target.checked })}
            />
            <span>Enable for new transactions</span>
          </label>
          <p className={s.caption}>
            Fills uncategorized expenses on future imports.
          </p>
        </fieldset>
        <p className={s.caption}>
          Preview includes categorized expenses from all dates.
        </p>
        {error && (
          <p role="alert" className={s.ruleError}>
            {error}
          </p>
        )}
        {preview && (
          <section className={s.rulePreview} aria-label="Rule preview">
            <h3>
              {preview.matchCount} matching{" "}
              {preview.matchCount === 1 ? "expense" : "expenses"}
            </h3>
            {preview.samples.length > 0 && (
              <ul className={s.ruleSamples}>
                {preview.samples.map((sample) => (
                  <li key={sample.id}>
                    <span>
                      {sample.name}
                      <small>
                        {sample.date} · {accountNickname(sample.account)}
                        {" · "}
                        {sample.categoryName ?? "Uncategorized"}
                      </small>
                    </span>
                    <strong>{signedMoney(sample.amountCents)}</strong>
                  </li>
                ))}
              </ul>
            )}
            {preview.matchCount > preview.samples.length && (
              <p className={s.caption}>
                Showing the {preview.samples.length} most recent matches.
              </p>
            )}
            {preview.matchCount > 0 && (
              <label className={s.ruleCheck}>
                <input
                  type="checkbox"
                  checked={applyExisting}
                  disabled={busy}
                  onChange={(event) => setApplyExisting(event.target.checked)}
                />
                <span>
                  Apply this category to all {preview.matchCount} existing
                  matches, replacing their current categories
                </span>
              </label>
            )}
          </section>
        )}
        <div className={s.ruleActions}>
          {preview && (
            <Button
              type="button"
              variant="secondary"
              disabled={busy}
              onClick={() => void loadPreview()}
            >
              Refresh preview
            </Button>
          )}
          <Button
            type="submit"
            disabled={busy || !draft.pattern.trim() || !draft.categoryId}
          >
            {busy
              ? "Working…"
              : !preview
                ? "Preview matches"
                : applyExisting && preview.matchCount > 0
                  ? rule
                    ? "Update and apply"
                    : "Create and apply"
                  : rule
                    ? "Update rule"
                    : "Create rule"}
          </Button>
        </div>
      </form>
    </Sheet>
  );
}
