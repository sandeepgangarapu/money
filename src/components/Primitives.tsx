import { ChevronDown, X } from "lucide-react";
import {
  type ButtonHTMLAttributes,
  type CSSProperties,
  type PointerEvent,
  type ReactNode,
  createContext,
  useCallback,
  useContext,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import s from "../App.module.css";
import p from "./Primitives.module.css";

export function EmojiTile({
  emoji,
  color,
  size = 36,
  dot = false,
  label,
}: {
  emoji: string;
  color: string;
  size?: 28 | 36 | 56;
  dot?: boolean;
  label?: string;
}) {
  return (
    <span
      className={p.emojiTile}
      data-size={size}
      style={{ "--category-color": color } as CSSProperties}
      role={label ? "img" : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
    >
      {emoji}
      {dot && <span className={p.dot} />}
    </span>
  );
}

export function SegmentedControl<T extends string>({
  value,
  options,
  onChange,
  label,
  size = "md",
}: {
  value: T;
  options: { value: T; label: string }[];
  onChange: (value: T) => void;
  label: string;
  size?: "sm" | "md";
}) {
  const buttons = useRef<(HTMLButtonElement | null)[]>([]);
  const selected = Math.max(
    0,
    options.findIndex((option) => option.value === value),
  );
  return (
    <div
      className={p.segmented}
      role="radiogroup"
      aria-label={label}
      data-size={size}
    >
      {options.map((option, index) => (
        <button
          key={option.value}
          ref={(element) => {
            buttons.current[index] = element;
          }}
          type="button"
          // biome-ignore lint/a11y/useSemanticElements: Button radios share the same keyboard and focus behavior.
          role="radio"
          aria-checked={option.value === value}
          tabIndex={index === selected ? 0 : -1}
          onClick={() => {
            if (option.value !== value) onChange(option.value);
          }}
          onKeyDown={(event) => {
            if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
            event.preventDefault();
            const next =
              (index + (event.key === "ArrowRight" ? 1 : -1) + options.length) %
              options.length;
            buttons.current[next]?.focus();
            if (options[next].value !== value) onChange(options[next].value);
          }}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

export function Button({
  variant = "primary",
  size = "md",
  className = "",
  type = "button",
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "primary" | "secondary" | "ghost";
  size?: "sm" | "md";
}) {
  return (
    <button
      type={type}
      className={`${p.button} ${className}`}
      data-variant={variant}
      data-size={size}
      {...props}
    />
  );
}
export function PickerButton({
  children,
  className = "",
  showChevron = true,
  trailing,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  showChevron?: boolean;
  trailing?: ReactNode;
}) {
  return (
    <button
      type="button"
      className={`${s.pickerButton} ${className}`}
      {...props}
    >
      <span className={s.pickerButtonLabel}>{children}</span>
      {trailing ??
        (showChevron && <ChevronDown size={14} aria-hidden="true" />)}
    </button>
  );
}
export function Panel({
  children,
  className = "",
}: { children: ReactNode; className?: string }) {
  return <section className={`${s.panel} ${className}`}>{children}</section>;
}
export function PanelHeading({
  children,
  action,
}: { children: ReactNode; action?: ReactNode }) {
  return (
    <div className={s.panelHeading}>
      <h2>{children}</h2>
      {action}
    </div>
  );
}
// Open sheets, innermost last: toasts render inside the top one because a
// modal dialog covers everything else on the page.
let openSheets: string[] = [];
const sheetListeners = new Set<() => void>();
const subscribeSheets = (listener: () => void) => {
  sheetListeners.add(listener);
  return () => {
    sheetListeners.delete(listener);
  };
};
const setOpenSheets = (next: string[]) => {
  openSheets = next;
  for (const listener of sheetListeners) listener();
};
export const useTopSheet = () =>
  useSyncExternalStore(
    subscribeSheets,
    () => openSheets.at(-1) ?? null,
    () => null,
  );
const SheetContext = createContext<{ id: string; close: () => void } | null>(
  null,
);
// Content in a sheet closes it with the slide-down animation.
export const useSheet = () => useContext(SheetContext);
const SheetExtras = createContext<ReactNode>(null);
export const SheetExtrasProvider = SheetExtras.Provider;

const CLOSE_MS = 200;
const reducedMotion = () =>
  window.matchMedia("(prefers-reduced-motion: reduce)").matches;

export function Sheet({
  title,
  titleHidden = false,
  icon,
  subtitle,
  size = "auto",
  children,
  onClose,
}: {
  title: string;
  // Keeps the dialog's accessible name when the content shows its own heading.
  titleHidden?: boolean;
  // A leading tile and a one-line caption keep detail headers in one row.
  icon?: ReactNode;
  subtitle?: ReactNode;
  // Tall sheets keep their height so a list inside can fill and scroll it.
  size?: "auto" | "tall";
  children: ReactNode;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const id = useId();
  const extras = useContext(SheetExtras);
  const [closing, setClosing] = useState(false);
  const closed = useRef(false);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  const drag = useRef<{ pointer: number; y: number; time: number } | null>(
    null,
  );
  useEffect(() => {
    const trigger = document.activeElement;
    const dialog = ref.current;
    dialog?.showModal();
    setOpenSheets([...openSheets, id]);
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      dialog?.close();
      setOpenSheets(openSheets.filter((sheet) => sheet !== id));
      document.body.style.overflow = previous;
      if (trigger instanceof HTMLElement && trigger.isConnected)
        trigger.focus({ preventScroll: true });
    };
  }, [id]);
  // Slides the sheet away before the parent unmounts it.
  const close = useCallback(() => {
    if (closed.current) return;
    closed.current = true;
    if (reducedMotion()) {
      onCloseRef.current();
      return;
    }
    setClosing(true);
    window.setTimeout(() => onCloseRef.current(), CLOSE_MS);
  }, []);
  const context = useMemo(() => ({ id, close }), [id, close]);
  function endDrag(event: PointerEvent<HTMLElement>) {
    const start = drag.current;
    const dialog = ref.current;
    if (!start || start.pointer !== event.pointerId || !dialog) return;
    drag.current = null;
    const offset = Math.max(0, event.clientY - start.y);
    const speed = offset / Math.max(1, event.timeStamp - start.time);
    if (offset > 120 || (offset > 32 && speed > 0.5)) {
      dialog.style.setProperty("--sheet-drag", `${offset}px`);
      dialog.style.transform = "";
      close();
    } else {
      dialog.dataset.settling = "true";
      dialog.style.transform = "";
      window.setTimeout(() => delete dialog.dataset.settling, CLOSE_MS);
    }
  }
  return (
    <dialog
      ref={ref}
      className={s.sheet}
      data-size={size}
      data-closing={closing || undefined}
      aria-labelledby={id}
      onKeyDown={(event) => {
        if (event.key === "Escape" && !event.nativeEvent.isComposing) {
          event.preventDefault();
          event.stopPropagation();
          close();
        }
      }}
      onCancel={(event) => {
        event.preventDefault();
        close();
      }}
      onPointerDown={(event) => {
        if (event.target === event.currentTarget) {
          const bounds = event.currentTarget.getBoundingClientRect();
          if (
            event.clientX < bounds.left ||
            event.clientX > bounds.right ||
            event.clientY < bounds.top ||
            event.clientY > bounds.bottom
          ) {
            event.preventDefault();
            close();
          }
        }
      }}
    >
      <SheetContext.Provider value={context}>
        <header
          className={s.sheetHeader}
          data-title-hidden={titleHidden}
          data-compact={!!subtitle}
          // Dragging the header down dismisses the sheet, as on iOS.
          onPointerDown={(event) => {
            if (
              !event.isPrimary ||
              (event.target as Element).closest("button, a, input")
            )
              return;
            drag.current = {
              pointer: event.pointerId,
              y: event.clientY,
              time: event.timeStamp,
            };
            event.currentTarget.setPointerCapture(event.pointerId);
          }}
          onPointerMove={(event) => {
            const start = drag.current;
            const dialog = ref.current;
            if (!start || start.pointer !== event.pointerId || !dialog) return;
            const offset = Math.max(0, event.clientY - start.y);
            dialog.style.transform = offset ? `translateY(${offset}px)` : "";
          }}
          onPointerUp={endDrag}
          onPointerCancel={endDrag}
        >
          <span className={s.sheetGrabber} aria-hidden="true" />
          {icon}
          <div className={s.sheetTitle}>
            <h2 id={id} className={titleHidden ? s.visuallyHidden : undefined}>
              {title}
            </h2>
            {subtitle && <p>{subtitle}</p>}
          </div>
          <button
            type="button"
            className={s.iconButton}
            onClick={close}
            aria-label="Close details"
          >
            <X size={20} />
          </button>
        </header>
        <div className={s.sheetBody}>{children}</div>
        {extras}
      </SheetContext.Provider>
    </dialog>
  );
}
