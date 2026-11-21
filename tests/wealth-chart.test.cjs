const assert = require("node:assert/strict");
const { execFileSync } = require("node:child_process");
const { mkdtempSync, rmSync } = require("node:fs");
const { tmpdir } = require("node:os");
const path = require("node:path");
const { after, test } = require("node:test");
const { sankey } = require("d3-sankey");

const output = mkdtempSync(path.join(tmpdir(), "money-wealth-chart-"));
after(() => rmSync(output, { recursive: true, force: true }));
execFileSync(
  process.execPath,
  [
    path.resolve(__dirname, "../node_modules/typescript/bin/tsc"),
    "--ignoreConfig",
    "--target",
    "es2022",
    "--module",
    "commonjs",
    "--skipLibCheck",
    "--outDir",
    output,
    "src/data/wealthChart.ts",
  ],
  { cwd: path.resolve(__dirname, ".."), stdio: "pipe" },
);
const { allocationChildren, allocationRibbon } = require(
  path.join(output, "wealthChart.js"),
);

const node = (id, cents, children) => ({
  id,
  name: id,
  shortName: id,
  cents,
  color: "blue",
  children,
});

test("sub-1% children combine into one non-drillable Other at every level", () => {
  const small = [
    node("tiny-one", 99, [node("detail", 99)]),
    node("tiny-two", 1),
  ];
  const parent = node("assets", 10000, [
    node("large", 9800),
    node("exact-one-percent", 100),
    ...small,
    node("zero", 0),
    node("negative", -10),
  ]);
  const original = structuredClone(parent);
  const children = allocationChildren(parent);
  assert.deepEqual(
    children.map((item) => [item.name, item.cents]),
    [
      ["large", 9800],
      ["exact-one-percent", 100],
      ["Other (2)", 100],
    ],
  );
  assert.equal(children.at(-1).children, undefined);
  assert.equal(
    children.reduce((sum, item) => sum + item.cents, 0),
    10000,
  );
  assert.deepEqual(parent, original);
  assert.equal(
    allocationChildren(
      node("account", 1000, [node("small", 9), node("big", 991)]),
    )[1].name,
    "Other (1)",
  );
  assert.deepEqual(allocationChildren(node("empty", 0)), []);
});

test("wide Home ribbons remain within node boundaries on phone and desktop charts", () => {
  const children = [
    node("Home", 450000),
    node("Investments", 300000),
    node("Retirement", 200000),
    node("Cash", 50000),
  ];
  for (const width of [264, 350, 390, 800]) {
    const graph = sankey()
      .nodeId((item) => item.id)
      .nodeWidth(5)
      .nodePadding(62)
      .nodeSort(null)
      .iterations(0)
      .extent([
        [7, 42],
        [Math.max(50, width - 151), 312 - 28],
      ])({
      nodes: [node("source", 1000000), ...structuredClone(children)],
      links: children.map((item) => ({
        source: "source",
        target: item.id,
        value: item.cents,
      })),
    });
    const home = graph.links[0];
    assert.equal(home.value / graph.nodes[0].value, 0.45);
    for (const link of graph.links) {
      const { source, target } = link;
      const half = link.width / 2;
      const epsilon = 1e-8;
      assert.ok(link.y0 - half >= source.y0 - epsilon);
      assert.ok(link.y0 + half <= source.y1 + epsilon);
      assert.ok(link.y1 - half >= target.y0 - epsilon);
      assert.ok(link.y1 + half <= target.y1 + epsilon);
      const ribbon = allocationRibbon({
        x0: source.x1,
        x1: target.x0,
        y0: link.y0,
        y1: link.y1,
        width: link.width,
      });
      assert.ok(ribbon.endsWith(" Z"));
      const points = [...ribbon.matchAll(/(-?[\d.]+),(-?[\d.]+)/g)].map(
        (match) => [+match[1], +match[2]],
      );
      // Bezier curves stay in the convex hull of these control points. Filled
      // upper/lower edges therefore cannot fold past the target like a stroke.
      for (const [x, y] of points) {
        assert.ok(x >= source.x1 && x <= target.x0);
        assert.ok(y >= Math.min(source.y0, target.y0) - epsilon);
        assert.ok(y <= Math.max(source.y1, target.y1) + epsilon);
      }
      assert.equal(points[3][0], target.x0);
      assert.equal(points[4][0], target.x0);
      assert.ok(Math.abs(points[3][1] - target.y0) < epsilon);
      assert.ok(Math.abs(points[4][1] - target.y1) < epsilon);
    }
  }
});
