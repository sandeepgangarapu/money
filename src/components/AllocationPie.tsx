import { ChevronRight } from "lucide-react";
import { type CSSProperties, Fragment, useId, useRef, useState } from "react";
import s from "../App.module.css";
import type { AllocationNode } from "../data/allocation";
import { money } from "../data/finance";

function sector(start: number, end: number) {
  const r = 144;
  const c = 150;
  const x0 = c + r * Math.cos(start);
  const y0 = c + r * Math.sin(start);
  const x1 = c + r * Math.cos(end);
  const y1 = c + r * Math.sin(end);
  return `M${c},${c} L${x0},${y0} A${r},${r} 0 ${end - start > Math.PI ? 1 : 0} 1 ${x1},${y1} Z`;
}
export function AllocationPie({
  root,
  label,
}: { root: AllocationNode; label: string }) {
  const [path, setPath] = useState<string[]>([]);
  const stack: AllocationNode[] = [];
  for (const id of path) {
    const node = (stack.at(-1) ?? root).children?.find(
      (node) => node.id === id,
    );
    if (!node) break;
    stack.push(node);
  }
  const current = stack.at(-1) ?? root;
  const slices = current.children ?? [];
  const total = slices.reduce(
    (sum, slice) => sum + Math.max(0, slice.cents),
    0,
  );
  const titleId = useId();
  const pointerStart = useRef<{ x: number; y: number } | null>(null);
  let angle = -Math.PI / 2;
  const layout = slices
    .filter((slice) => slice.cents > 0)
    .map((slice) => {
      const share = slice.cents / total;
      const start = angle;
      angle += share * Math.PI * 2;
      const center = (start + angle) / 2;
      const narrow = share < 0.045;
      const shortName = narrow
        ? (slice.code ?? slice.shortName.split(" ")[0])
        : slice.shortName;
      const radius = share === 1 ? 0 : share < 0.1 ? 115 : 83;
      return {
        slice,
        share,
        start,
        end: angle,
        x: 150 + radius * Math.cos(center),
        y: 150 + radius * Math.sin(center),
        shortName,
        narrow,
      };
    });
  function drill(node: AllocationNode) {
    if (node.children?.length)
      setPath([...stack.map((node) => node.id), node.id]);
  }
  return (
    <div className={s.allocationExplorer}>
      <div className={s.pieHeading}>
        <h2>{label}</h2>
        <span>{money(total)}</span>
      </div>
      {stack.length > 0 && (
        <nav className={s.pieBreadcrumb} aria-label={`${label} path`}>
          <button type="button" onClick={() => setPath([])}>
            {root.name}
          </button>
          {stack.map((node, index) => (
            <span key={node.id}>
              ›{" "}
              {index === stack.length - 1 ? (
                <strong>{node.name}</strong>
              ) : (
                <button
                  type="button"
                  onClick={() => setPath(path.slice(0, index + 1))}
                >
                  {node.name}
                </button>
              )}
            </span>
          ))}
        </nav>
      )}
      {current.note && <p className={s.caption}>{current.note}</p>}
      <div
        className={`${s.filledPie} ${slices.some((slice) => slice.children?.length) ? s.expandablePie : ""}`}
        data-pie-level={current.id}
        onPointerDown={(event) => {
          pointerStart.current = { x: event.clientX, y: event.clientY };
        }}
        onPointerCancel={() => {
          pointerStart.current = null;
        }}
        onPointerUp={(event) => {
          const start = pointerStart.current;
          pointerStart.current = null;
          if (
            !start ||
            Math.hypot(event.clientX - start.x, event.clientY - start.y) > 12
          )
            return;
          const bounds = event.currentTarget.getBoundingClientRect();
          const x = ((event.clientX - bounds.left) / bounds.width) * 300 - 150;
          const y = ((event.clientY - bounds.top) / bounds.height) * 300 - 150;
          if (Math.hypot(x, y) > 144) return;
          const raw = Math.atan2(y, x);
          const angle = raw < -Math.PI / 2 ? raw + Math.PI * 2 : raw;
          const selected = layout.find(
            (item) => angle >= item.start && angle <= item.end,
          );
          if (selected) drill(selected.slice);
        }}
      >
        <svg viewBox="0 0 300 300" role="img" aria-labelledby={titleId}>
          <title id={titleId}>
            {label}, {current.name}:{" "}
            {layout
              .map(
                ({ slice, share }) =>
                  `${slice.name} ${(share * 100).toFixed(1)}%`,
              )
              .join(", ")}
          </title>
          {layout.map(({ slice, start, end }) =>
            layout.length === 1 ? (
              <circle
                key={slice.id}
                cx="150"
                cy="150"
                r="144"
                fill={`var(--pie-${slice.color})`}
              />
            ) : (
              <path
                key={slice.id}
                d={sector(start, end)}
                fill={`var(--pie-${slice.color})`}
              />
            ),
          )}
        </svg>
        {layout
          .filter(({ share }) => share >= 0.045)
          .map(({ slice, share, x, y, shortName, narrow }) => {
            const style = {
              left: `${x / 3}%`,
              top: `${y / 3}%`,
            } as CSSProperties;
            const content = (
              <Fragment key={slice.id}>
                <span>{shortName}</span>
                {!narrow && (
                  <small>{(share * 100).toFixed(share < 0.1 ? 1 : 0)}%</small>
                )}
              </Fragment>
            );
            return slice.children?.length ? (
              <button
                type="button"
                key={slice.id}
                className={s.pieLabel}
                style={style}
                aria-label={`Expand ${slice.name}, ${money(slice.cents)}`}
                onClick={() => drill(slice)}
              >
                {content}
              </button>
            ) : (
              <div
                key={slice.id}
                className={s.pieLabel}
                style={style}
                title="No further breakdown"
              >
                {content}
              </div>
            );
          })}
      </div>
      <div>
        {slices.map((slice) => {
          const content = (
            <Fragment key={slice.id}>
              <i
                className={s.dot}
                style={{ background: `var(--${slice.color})` }}
              />
              <span>
                {slice.name}
                <small>
                  {slice.code ? `${slice.code} · ` : ""}
                  {total > 0 && slice.cents > 0
                    ? `${((slice.cents / total) * 100).toFixed(1)}%`
                    : ""}
                </small>
                {slice.detail && <small>{slice.detail}</small>}
              </span>
              <strong>{slice.valueLabel ?? money(slice.cents)}</strong>
              {slice.children?.length && <ChevronRight size={16} />}
            </Fragment>
          );
          return slice.children?.length ? (
            <button
              type="button"
              key={slice.id}
              className={s.assetRow}
              onClick={() => drill(slice)}
              aria-label={`Expand ${slice.name} allocation`}
            >
              {content}
            </button>
          ) : (
            <div
              key={slice.id}
              className={`${s.assetRow} ${s.assetLeaf}`}
              title="No further breakdown"
            >
              {content}
            </div>
          );
        })}
      </div>
    </div>
  );
}
