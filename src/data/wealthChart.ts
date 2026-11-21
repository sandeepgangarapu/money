import type { AllocationNode } from "./allocation";

export function allocationChildren(parent: AllocationNode): AllocationNode[] {
  const positive = parent.children?.filter((node) => node.cents > 0) ?? [];
  const small = positive.filter((node) => node.cents < parent.cents * 0.01);
  const children = positive.filter((node) => node.cents >= parent.cents * 0.01);
  if (small.length) {
    children.push({
      id: `${parent.id}:other`,
      name: `Other (${small.length})`,
      shortName: `Other (${small.length})`,
      color: "gray",
      cents: small.reduce((sum, node) => sum + node.cents, 0),
    });
  }
  return children.sort((a, b) => b.cents - a.cents);
}

export type Ribbon = {
  x0: number;
  x1: number;
  y0: number;
  y1: number;
  width: number;
};

export function allocationRibbon({ x0, x1, y0, y1, width }: Ribbon) {
  const middle = (x0 + x1) / 2;
  const half = width / 2;
  // Separate edges keep wide flows inside their nodes, even on narrow phones.
  // A thick curved stroke can self-intersect when its bend radius is too small.
  return `M${x0},${y0 - half} C${middle},${y0 - half} ${middle},${y1 - half} ${x1},${y1 - half} L${x1},${y1 + half} C${middle},${y1 + half} ${middle},${y0 + half} ${x0},${y0 + half} Z`;
}
