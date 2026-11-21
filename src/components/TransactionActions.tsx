import { type PointerEvent, type ReactNode, useRef, useState } from "react";
import s from "../App.module.css";
import type { Transaction } from "../data/finance";
import {
  shouldConfirmSwipe,
  shouldExcludeSwipe,
  swipeIntent,
} from "../data/swipe";
import type { TransactionPatch } from "./Transactions";

type Change = (patch: TransactionPatch) => void;

export function SwipeToExclude({
  transaction,
  disabled,
  onChange,
  onConfirm,
  children,
}: {
  transaction: Transaction;
  disabled: boolean;
  onChange: Change;
  onConfirm?: () => void;
  children: ReactNode;
}) {
  const gesture = useRef<{
    id: number;
    x: number;
    y: number;
    dragging: boolean;
  } | null>(null);
  const suppressClickUntil = useRef(0);
  const [offset, setOffset] = useState(0);
  const enabled =
    !disabled &&
    (transaction.kind === "income" || transaction.kind === "expense");
  function finish(event: PointerEvent<HTMLDivElement>, cancelled = false) {
    const start = gesture.current;
    gesture.current = null;
    setOffset(0);
    if (!start || start.id !== event.pointerId || !start.dragging) return;
    suppressClickUntil.current = Date.now() + 400;
    if (
      !cancelled &&
      enabled &&
      !transaction.excluded &&
      shouldExcludeSwipe(event.clientX - start.x, event.clientY - start.y)
    ) {
      // The undo toast comes from the shared edit queue.
      onChange({ excluded: true });
    } else if (
      !cancelled &&
      enabled &&
      onConfirm &&
      shouldConfirmSwipe(event.clientX - start.x, event.clientY - start.y)
    ) {
      onConfirm();
    }
  }
  return (
    <div className={s.swipeFrame}>
      {offset !== 0 && (
        <div
          className={s.swipeHint}
          style={{ justifyContent: offset > 0 ? "flex-start" : "flex-end" }}
          aria-hidden="true"
        >
          {offset > 0 ? "Confirm" : "Exclude"}
        </div>
      )}
      <div
        className={s.swipeSurface}
        style={{ transform: `translateX(${offset}px)` }}
        data-swiping={offset !== 0}
        onPointerDown={(event) => {
          if (
            !enabled ||
            !event.isPrimary ||
            event.pointerType === "mouse" ||
            !(event.target as Element).closest("[data-swipe-handle]")
          )
            return;
          gesture.current = {
            id: event.pointerId,
            x: event.clientX,
            y: event.clientY,
            dragging: false,
          };
        }}
        onPointerMove={(event) => {
          const start = gesture.current;
          if (!start || start.id !== event.pointerId) return;
          const dx = event.clientX - start.x;
          const intent = swipeIntent(dx, event.clientY - start.y);
          if (intent === "scroll") {
            finish(event, true);
            return;
          }
          if (
            ((intent === "left" && !transaction.excluded) ||
              (intent === "right" && onConfirm)) &&
            !start.dragging
          ) {
            start.dragging = true;
            event.currentTarget.setPointerCapture(event.pointerId);
          }
          if (start.dragging) {
            event.preventDefault();
            setOffset(
              Math.max(
                transaction.excluded ? 0 : -112,
                Math.min(onConfirm ? 112 : 0, dx),
              ),
            );
          }
        }}
        onPointerUp={(event) => finish(event)}
        onPointerCancel={(event) => finish(event, true)}
        onClickCapture={(event) => {
          if (Date.now() < suppressClickUntil.current) {
            event.preventDefault();
            event.stopPropagation();
          }
        }}
      >
        {children}
      </div>
    </div>
  );
}
