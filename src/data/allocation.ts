import { assetGroups } from "./demo";

export type AllocationNode = {
  id: string;
  name: string;
  shortName: string;
  color: string;
  cents: number;
  code?: string;
  detail?: string;
  note?: string;
  valueLabel?: string;
  children?: AllocationNode[];
};
const shortHolding = (name: string) =>
  name.includes(" · ")
    ? name.split(" · ")[0]
    : name === "Brokerage cash"
      ? "Cash"
      : name === "Bond funds"
        ? "Bonds"
        : name === "Our home"
          ? "Home"
          : name;
const colors = ["blue", "purple", "green", "orange", "pink", "gray"];
export const assetAllocation: AllocationNode = {
  id: "assets",
  name: "All assets",
  shortName: "Assets",
  color: "blue",
  cents: 0,
  children: assetGroups.map((group) => {
    const names = [...new Set(group.holdings.map((h) => h.name))];
    const children = names.map((name, index) => {
      const positions = group.holdings.filter((h) => h.name === name);
      return {
        id: `${group.id}:${name}`,
        name,
        shortName: shortHolding(name),
        color: colors[index],
        cents: positions.reduce((sum, h) => sum + h.valueCents, 0),
        children:
          positions.length > 1
            ? positions.map((h, i) => ({
                id: `${group.id}:${name}:${h.account}`,
                name: h.account,
                shortName: h.account,
                color: colors[i],
                cents: h.valueCents,
              }))
            : undefined,
      };
    });
    return {
      id: group.id,
      name: group.name,
      shortName: (
        {
          index: "Index funds",
          stocks: "Stocks",
          property: "Real estate",
          cash: "Cash",
          other: "Other",
        } as Record<string, string>
      )[group.id],
      color: group.color,
      cents: children.reduce((sum, h) => sum + h.cents, 0),
      children,
    };
  }),
};
assetAllocation.cents =
  assetAllocation.children?.reduce((sum, g) => sum + g.cents, 0) ?? 0;

const accounts = [
  ...new Set(assetGroups.flatMap((g) => g.holdings.map((h) => h.account))),
];
export const accountAllocation: AllocationNode = {
  id: "accounts",
  name: "All accounts",
  shortName: "Accounts",
  color: "blue",
  cents: assetAllocation.cents,
  children: accounts.map((account, index) => {
    const positions = assetGroups.flatMap((group) =>
      group.holdings
        .filter((h) => h.account === account)
        .map((h) => ({ ...h, group: group.id })),
    );
    return {
      id: account,
      name: account,
      shortName: account,
      color: colors[index],
      code: `A${index + 1}`,
      cents: positions.reduce((sum, h) => sum + h.valueCents, 0),
      children: positions.map((h, i) => ({
        id: `${account}:${h.name}`,
        name: h.name,
        shortName: shortHolding(h.name),
        color: colors[i],
        cents: h.valueCents,
      })),
    };
  }),
};
