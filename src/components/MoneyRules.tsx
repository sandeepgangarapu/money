import { Plus, SlidersHorizontal, WandSparkles } from "lucide-react";
import {
  type ReactNode,
  createContext,
  useContext,
  useEffect,
  useState,
} from "react";
import s from "../App.module.css";
import { request } from "../data/api";
import type { Transaction } from "../data/finance";
import {
  type MoneyRule,
  type RuleResult,
  listRules,
  ruleCategory,
} from "../data/rules";
import { Button, Panel, Sheet } from "./Primitives";
import { RuleEditor } from "./RuleEditor";

type Editor = {
  rule?: MoneyRule;
  transaction?: Transaction;
  applyMode: boolean;
  returnToManager: boolean;
};
const RulesContext = createContext<{
  manage: () => void;
  create: (transaction: Transaction) => void;
} | null>(null);

export function RulesProvider({
  children,
  onApplied,
}: { children: ReactNode; onApplied: () => void }) {
  const [manager, setManager] = useState(false);
  const [editor, setEditor] = useState<Editor | null>(null);
  const [notice, setNotice] = useState("");
  function complete(result: RuleResult) {
    setNotice(
      `${editor?.rule ? "Rule updated" : "Rule created"}${result.appliedCount ? ` · ${result.appliedCount} transactions categorized` : ""}`,
    );
    setEditor(null);
    setManager(true);
    if (result.appliedCount > 0) onApplied();
  }
  return (
    <RulesContext.Provider
      value={{
        manage: () => {
          setNotice("");
          setManager(true);
        },
        create: (transaction) =>
          setEditor({ transaction, applyMode: false, returnToManager: false }),
      }}
    >
      {children}
      {manager && (
        <RulesManager
          notice={notice}
          onClose={() => setManager(false)}
          onEdit={(rule, applyMode = false) => {
            setManager(false);
            setEditor({ rule, applyMode, returnToManager: true });
          }}
        />
      )}
      {editor && (
        <RuleEditor
          rule={editor.rule}
          transaction={editor.transaction}
          applyMode={editor.applyMode}
          onClose={() => {
            setEditor(null);
            setManager(editor.returnToManager);
          }}
          onComplete={complete}
        />
      )}
    </RulesContext.Provider>
  );
}

export function RulesButton() {
  const context = useContext(RulesContext);
  return (
    <button
      type="button"
      className={s.iconButton}
      aria-label="Rules"
      title="Rules"
      onClick={() => context?.manage()}
    >
      <SlidersHorizontal size={20} aria-hidden="true" />
    </button>
  );
}
export function TransactionRuleButton({
  transaction,
  variant = "ghost",
  className,
}: {
  transaction: Transaction;
  variant?: "primary" | "secondary" | "ghost";
  className?: string;
}) {
  const context = useContext(RulesContext);
  return (
    <Button
      variant={variant}
      size="sm"
      className={className}
      onClick={() => context?.create(transaction)}
    >
      <WandSparkles size={18} aria-hidden="true" />
      Create rule
    </Button>
  );
}

function RulesManager({
  notice,
  onClose,
  onEdit,
}: {
  notice: string;
  onClose: () => void;
  onEdit: (rule?: MoneyRule, applyMode?: boolean) => void;
}) {
  const [rules, setRules] = useState<MoneyRule[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  useEffect(() => {
    const abort = new AbortController();
    listRules(abort.signal)
      .then((result) => {
        setRules(result.rules);
        setLoading(false);
      })
      .catch((cause) => {
        if (!abort.signal.aborted) {
          setError(cause.message);
          setLoading(false);
        }
      });
    return () => abort.abort();
  }, []);
  async function mutate(rule: MoneyRule, remove = false) {
    setBusy(rule.id);
    setError("");
    try {
      if (remove) {
        await request(`/rules/${rule.id}`, { method: "DELETE" });
        setRules((current) => current.filter((item) => item.id !== rule.id));
      } else {
        const result = await request<RuleResult>(`/rules/${rule.id}`, {
          method: "PATCH",
          body: JSON.stringify({ rule: { active: !rule.active } }),
        });
        setRules((current) =>
          current.map((item) => (item.id === rule.id ? result.rule : item)),
        );
      }
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "Could not update rule",
      );
    } finally {
      setBusy("");
    }
  }
  return (
    <Sheet title="Rules" onClose={onClose}>
      <div className={s.rulesIntro}>
        <p className={s.caption}>
          Active rules run on each sync, in this order. The first matching rule
          fills a blank category.
        </p>
        <button
          type="button"
          className={s.ruleSecondary}
          onClick={() => onEdit()}
        >
          <Plus size={16} aria-hidden="true" />
          New rule
        </button>
      </div>
      {notice && <output className={s.ruleNotice}>{notice}</output>}
      {error && (
        <p role="alert" className={s.ruleError}>
          {error}
        </p>
      )}
      {loading ? (
        <output>Loading rules…</output>
      ) : rules.length === 0 ? (
        <p className={s.muted}>
          No rules yet. Create one here or from a transaction’s category editor.
        </p>
      ) : (
        <div className={s.ruleList}>
          {rules.map((rule) => (
            <Panel key={rule.id}>
              <div className={s.ruleHeading}>
                <div>
                  <small>
                    {rule.matchType === "exact" ? "Exact match" : "Contains"}
                  </small>
                  <strong>{rule.pattern}</strong>
                </div>
                <label className={s.ruleCheck}>
                  <input
                    type="checkbox"
                    role="switch"
                    aria-label={`Enable rule ${rule.pattern}`}
                    aria-checked={rule.active}
                    checked={rule.active}
                    disabled={!!busy}
                    onChange={() => void mutate(rule)}
                  />
                  <span>{rule.active ? "On" : "Paused"}</span>
                </label>
              </div>
              <p className={s.ruleTarget}>
                {ruleCategory(rule.categoryId).label}
              </p>
              <div className={s.ruleActions}>
                <button
                  type="button"
                  className={s.ruleSecondary}
                  disabled={!!busy}
                  onClick={() => onEdit(rule)}
                >
                  Edit
                </button>
                <button
                  type="button"
                  className={s.ruleSecondary}
                  disabled={!!busy}
                  onClick={() => onEdit(rule, true)}
                >
                  Apply to existing
                </button>
                <button
                  type="button"
                  className={s.textButton}
                  disabled={!!busy}
                  onClick={() => void mutate(rule, true)}
                >
                  Delete
                </button>
              </div>
            </Panel>
          ))}
        </div>
      )}
    </Sheet>
  );
}
