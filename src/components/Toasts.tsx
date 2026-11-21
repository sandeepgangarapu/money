import { type ReactNode, createContext, useContext } from "react";
import s from "../App.module.css";
import { ErrorToast } from "./ErrorToast";
import { useSheet, useTopSheet } from "./Primitives";

type ToastState = {
  undo: { key: number; label: string } | null;
  onUndo: () => void;
  error: string;
  onRetry: () => void;
};
const Context = createContext<ToastState | null>(null);

export function ToastProvider({
  value,
  children,
}: { value: ToastState; children: ReactNode }) {
  return <Context.Provider value={value}>{children}</Context.Provider>;
}

// A modal sheet covers the page, so the open sheet shows the toast instead.
export function Toasts() {
  const state = useContext(Context);
  const sheet = useSheet();
  const top = useTopSheet();
  if (!state || (sheet?.id ?? null) !== top) return null;
  if (state.error)
    return <ErrorToast message={state.error} onRetry={state.onRetry} />;
  if (!state.undo) return null;
  return (
    <output key={state.undo.key} className={s.toast} data-undo>
      <span>{state.undo.label}</span>
      <button
        type="button"
        aria-label={`Undo: ${state.undo.label}`}
        onClick={state.onUndo}
      >
        Undo
      </button>
    </output>
  );
}
