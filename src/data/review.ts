import type { Transaction, TransactionPatch } from "./finance";

export const isCashFlowTransaction = (transaction: Transaction) =>
  transaction.kind === "income" || transaction.kind === "expense";

export const isRefund = (transaction: Transaction) =>
  transaction.kind === "expense" && transaction.amountCents > 0;

export function suggestionLabel(categorization: Transaction["categorization"]) {
  switch (categorization?.source) {
    case "rule":
      return "From your rule";
    case "history":
      return "From your confirmed history";
    case "copilot_history":
      return "From your Copilot history";
    case "ollama":
      return categorization.confidence === null
        ? "Suggested by AI"
        : `Suggested by AI · ${Math.round(categorization.confidence * 100)}%`;
    case "provider":
      return "Bank's category — check it";
    default:
      return "Needs a category";
  }
}

export function confidentTransactionIds(transactions: Transaction[]) {
  return transactions
    .filter(
      (transaction) =>
        isCashFlowTransaction(transaction) &&
        !transaction.reviewed &&
        !needsCategory(transaction) &&
        transaction.categorization?.confident,
    )
    .map((transaction) => transaction.id);
}

export function applyTransactionPatch(
  transaction: Transaction,
  patch: TransactionPatch,
): Transaction {
  const { flow, transfer, ...fields } = patch;
  let kind = transaction.kind;
  if (transfer) kind = "transfer";
  else if (flow) kind = flow === "refund" ? "expense" : "income";
  else if (transfer === false)
    kind = transaction.amountCents > 0 ? "income" : "expense";
  return { ...transaction, ...fields, kind, reviewed: true };
}

// The owner's answer to "what is this?". Investment activity has no choice.
export type TransactionType = "income" | "refund" | "spending" | "transfer";

export const transactionTypeOptions = (
  transaction: Transaction,
): { value: TransactionType; label: string }[] =>
  transaction.amountCents > 0
    ? [
        { value: "income", label: "Income" },
        { value: "refund", label: "Refund" },
        { value: "transfer", label: "Transfer" },
      ]
    : [
        { value: "spending", label: "Spending" },
        { value: "transfer", label: "Transfer" },
      ];

export function transactionType(transaction: Transaction): TransactionType {
  if (transaction.kind === "transfer") return "transfer";
  if (transaction.amountCents > 0)
    return isRefund(transaction) ? "refund" : "income";
  return "spending";
}

export function transactionTypePatch(
  transaction: Transaction,
  type: TransactionType,
): TransactionPatch {
  if (type === "transfer") return { transfer: true };
  if (type === "spending") return { transfer: false };
  return transaction.kind === "transfer"
    ? { transfer: false, flow: type }
    : { flow: type };
}

export const needsCategory = (transaction: Transaction) =>
  transaction.kind === "expense" &&
  (!transaction.category || transaction.category === "uncategorized");

export function reviewSections(transactions: Transaction[]) {
  const remaining = transactions.filter(
    (transaction) =>
      !transaction.reviewed && isCashFlowTransaction(transaction),
  );
  const ready = new Set(confidentTransactionIds(remaining));
  return {
    ready: remaining.filter((transaction) => ready.has(transaction.id)),
    needsCall: remaining.filter((transaction) => !ready.has(transaction.id)),
  };
}
