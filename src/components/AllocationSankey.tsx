import { type SankeyNode, sankey } from "d3-sankey";
import {
  type CSSProperties,
  Fragment,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import s from "../App.module.css";
import type { AllocationNode } from "../data/allocation";
import { money } from "../data/finance";
import { allocationChildren, allocationRibbon } from "../data/wealthChart";
import w from "./Wealth.module.css";

type FlowLink = { source: string; target: string; value: number };

export function AllocationSankey({
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
  const destinations = useMemo(() => allocationChildren(current), [current]);
  const total = destinations.reduce((sum, node) => sum + node.cents, 0);
  const ref = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  const titleId = useId();
  useLayoutEffect(() => {
    const element = ref.current;
    if (!element) return;
    const observer = new ResizeObserver(([entry]) =>
      setWidth(entry.contentRect.width),
    );
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  const height = Math.max(220, destinations.length * 78);
  const graph = useMemo(() => {
    if (width < 1 || total <= 0) return null;
    return sankey<AllocationNode, FlowLink>()
      .nodeId((node) => node.id)
      .nodeWidth(5)
      .nodePadding(62)
      .nodeSort(null)
      .iterations(0)
      .extent([
        [7, 42],
        [Math.max(50, width - 151), height - 28],
      ])({
      nodes: [
        { ...current, id: "source" },
        ...destinations.map((node) => ({ ...node })),
      ],
      links: destinations.map((node) => ({
        source: "source",
        target: node.id,
        value: node.cents,
      })),
    });
  }, [width, height, total, current, destinations]);
  const source = graph?.nodes[0];
  const sourceY = source ? Math.max(16, (source.y0 ?? 0) - 30) : 16;
  return (
    <div>
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
        ref={ref}
        className={s.flowChart}
        data-wealth-chart={label}
        data-allocation-level={current.id}
      >
        <svg
          width="100%"
          height={height}
          viewBox={`0 0 ${width || 320} ${height}`}
          role="img"
          aria-labelledby={titleId}
        >
          <title id={titleId}>
            {current.name}: {money(total)}.{" "}
            {destinations
              .map((node) => `${node.name} ${money(node.cents)}`)
              .join(", ")}
          </title>
          <text x="7" y={sourceY} className={s.chartSourceLabel}>
            {current.shortName}
          </text>
          <text x="7" y={sourceY + 17} className={s.chartSourceAmount}>
            {money(total)}
          </text>
          {graph?.links.map((link) => {
            const source = link.source as SankeyNode<AllocationNode, FlowLink>;
            const target = link.target as SankeyNode<AllocationNode, FlowLink>;
            return (
              <path
                key={target.id}
                d={allocationRibbon({
                  x0: source.x1 ?? 0,
                  x1: target.x0 ?? 0,
                  y0: link.y0 ?? 0,
                  y1: link.y1 ?? 0,
                  width: link.width ?? 0,
                })}
                fill={`var(--${target.color})`}
                fillOpacity=".36"
              />
            );
          })}
          {graph?.nodes.map((node) => (
            <rect
              key={node.id}
              x={node.x0}
              y={node.y0}
              width="5"
              height={Math.max(1, (node.y1 ?? 0) - (node.y0 ?? 0))}
              fill={`var(--${node.color})`}
              rx="1"
            />
          ))}
        </svg>
        {graph?.nodes
          .filter((node) => node.id !== "source")
          .map((node) => {
            const style = {
              top: ((node.y0 ?? 0) + (node.y1 ?? 0)) / 2,
              "--category-color": `var(--${node.color})`,
            } as CSSProperties;
            const content = (
              <Fragment key={node.id}>
                <span>{node.shortName}</span>
                <strong>
                  {money(node.cents)} ·{" "}
                  {((node.cents / total) * 100).toFixed(1)}%
                </strong>
                {node.children?.length ? (
                  <span className={s.expandIndicator}>›</span>
                ) : null}
              </Fragment>
            );
            return node.children?.length ? (
              <button
                key={node.id}
                type="button"
                className={`${s.flowLabel} ${w.allocationLabel}`}
                style={style}
                onClick={() =>
                  setPath([...stack.map((item) => item.id), node.id])
                }
                aria-label={`Expand ${node.name} allocation`}
                title={node.name}
              >
                {content}
              </button>
            ) : (
              <div
                key={node.id}
                className={`${s.flowLabel} ${s.flowLeaf} ${w.allocationLabel}`}
                style={style}
                title={node.name}
              >
                {content}
              </div>
            );
          })}
      </div>
      {stack.length > 0 &&
        !destinations.some((node) => node.children?.length) && (
          <div className={w.positionNotes}>
            {destinations
              .filter((node) => node.detail)
              .map((node) => (
                <p key={node.id}>
                  <strong>{node.name}</strong> · {node.detail}
                </p>
              ))}
          </div>
        )}
    </div>
  );
}
