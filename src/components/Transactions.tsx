import { EyeOff } from "lucide-react";
import { useId, useRef } from "react";
import { accountNickname } from "../data/accounts";
import { transactionAppearance } from "../data/appearance";
import { type ActivityFilters, categoryKey } from "../data/filters";
import {
  type Transaction,
  type TransactionPatch,
  shortDate,
  signedMoney,
  transactionKindLabels,
} from "../data/finance";
import { displayName } from "../data/merchant";
import {
  isCashFlowTransaction,
  isRefund,
  needsCategory,
  suggestionLabel,
  transactionType,
  transactionTypeOptions,
  transactionTypePatch,
} from "../data/review";
import { CategoryPicker } from "./CategoryPicker";
import { TransactionRuleButton } from "./MoneyRules";
import { Button, EmojiTile, SegmentedControl } from "./Primitives";
import { SwipeToExclude } from "./TransactionActions";
import s from "./Transactions.module.css";

export type { TransactionPatch } from "../data/finance";
type EditorProps = {
  transaction: Transaction;
  onChange: (patch: TransactionPatch) => void;
  onFilter: (patch: Partial<ActivityFilters>) => void;
};

export function TransactionRow({
  transaction: t,
  expanded,
  onToggle,
  onChange,
  onFilter,
  hideCategory = false,
  showDate = true,
  markConfident = false,
}: EditorProps & {
  expanded: boolean;
  onToggle: () => void;
  hideCategory?: boolean;
  showDate?: boolean;
  markConfident?: boolean;
}) {
  const title = displayName(t.name).title;
  const editorId = useId();
  const trigger = useRef<HTMLButtonElement>(null);
  const review = !t.reviewed && isCashFlowTransaction(t);
  const detail =
    t.kind === "expense"
      ? [isRefund(t) && "Refund", !hideCategory && t.subcategory]
          .filter(Boolean)
          .join(" · ")
      : transactionKindLabels[t.kind];
  const subtitle = [
    t.pending && "Pending",
    t.excluded && "Excluded",
    detail,
    accountNickname(t.account),
    showDate && shortDate(t.date),
  ]
    .filter(Boolean)
    .join(" · ");
  return (
    <article
      className={s.item}
      data-excluded={!!t.excluded}
      data-expanded={expanded}
    >
      <SwipeToExclude transaction={t} disabled={expanded} onChange={onChange}>
        <button
          ref={trigger}
          type="button"
          className={s.row}
          data-swipe-handle
          onClick={onToggle}
          aria-label={`Edit ${title}, ${signedMoney(t.amountCents)}${review ? ", needs review" : ""}`}
          aria-expanded={expanded}
          aria-controls={editorId}
        >
          <EmojiTile {...transactionAppearance(t)} size={36} dot={review} />
          <span className={s.description}>
            <span className={s.title}>{title}</span>
            <span className={s.subtitle}>
              {markConfident && t.categorization?.confident ? "✨ " : ""}
              {subtitle}
            </span>
          </span>
          <strong
            className={s.amount}
            data-positive={isCashFlowTransaction(t) && t.amountCents > 0}
          >
            {signedMoney(t.amountCents)}
          </strong>
        </button>
      </SwipeToExclude>
      <div id={editorId} hidden={!expanded}>
        {expanded && (
          <TransactionEditor
            transaction={t}
            onChange={onChange}
            onFilter={onFilter}
            onClose={() => {
              onToggle();
              trigger.current?.focus({ preventScroll: true });
            }}
          />
        )}
      </div>
    </article>
  );
}

export function TransactionEditor({
  transaction: t,
  onChange,
  onFilter,
  onClose,
}: EditorProps & { onClose: () => void }) {
  const cashFlow = isCashFlowTransaction(t);
  const canConfirm = !t.reviewed && !needsCategory(t);
  const { title, detail } = displayName(t.name);
  const raw = detail ?? (t.name !== title ? t.name : null);
  const date = new Date(`${t.date}T12:00:00`).toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    year: "numeric",
  });
  const metadata = `${date}${raw ? ` · ${raw}` : ""}`;
  return (
    <div
      className={s.editor}
      onKeyDown={(event) => {
        if (event.key === "Escape" && !event.nativeEvent.isComposing) {
          event.preventDefault();
          event.stopPropagation();
          onClose();
        }
      }}
    >
      <p className={s.metadata} title={metadata}>
        {metadata}
      </p>
      {t.kind !== "investment" && (
        <SegmentedControl
          label="Transaction type"
          size="sm"
          value={transactionType(t)}
          options={transactionTypeOptions(t)}
          onChange={(type) => onChange(transactionTypePatch(t, type))}
        />
      )}
      {cashFlow ? (
        <>
          {t.kind === "expense" ? (
            <div className={s.categoryRow}>
              <CategoryPicker
                category={t.category}
                subcategory={t.subcategory}
                onChange={onChange}
              />
              {canConfirm && (
                <Button size="sm" onClick={() => onChange({ reviewed: true })}>
                  Looks right
                </Button>
              )}
            </div>
          ) : (
            canConfirm && (
              <div className={s.categoryRow}>
                <span>{suggestionLabel(t.categorization)}</span>
                <Button size="sm" onClick={() => onChange({ reviewed: true })}>
                  Looks right
                </Button>
              </div>
            )
          )}
          {t.kind === "expense" && canConfirm && (
            <p className={s.caption}>{suggestionLabel(t.categorization)}</p>
          )}
        </>
      ) : (
        <p className={s.caption}>
          {t.kind === "investment"
            ? "Investment activity isn't cash flow. Balances are in Wealth."
            : "Transfers aren't income or spending."}
        </p>
      )}
      <div className={s.strip}>
        {cashFlow && (
          <>
            {t.kind === "expense" && (
              <TransactionRuleButton transaction={t} className={s.pill} />
            )}
            <Button
              variant="ghost"
              size="sm"
              className={s.pill}
              aria-pressed={!!t.excluded}
              onClick={() => onChange({ excluded: !t.excluded })}
            >
              <EyeOff size={16} aria-hidden="true" />
              {t.excluded ? "Include" : "Exclude"}
            </Button>
            <span className={s.divider} aria-hidden="true" />
          </>
        )}
        <Button
          variant="ghost"
          size="sm"
          className={s.pill}
          onClick={() =>
            onFilter(
              t.kind === "expense"
                ? { categories: [categoryKey(t)] }
                : { kinds: [t.kind] },
            )
          }
        >
          All{" "}
          {t.kind === "expense" ? t.subcategory : transactionKindLabels[t.kind]}
        </Button>
        <Button
          variant="ghost"
          size="sm"
          className={s.pill}
          onClick={() => onFilter({ accounts: [t.account] })}
        >
          {accountNickname(t.account)}
        </Button>
        <Button
          variant="ghost"
          size="sm"
          className={s.pill}
          onClick={() => onFilter({ date: t.date })}
        >
          This day
        </Button>
      </div>
    </div>
  );
}
