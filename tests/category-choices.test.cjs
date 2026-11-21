const assert = require("node:assert/strict");
const { execFileSync } = require("node:child_process");
const { mkdtempSync, rmSync } = require("node:fs");
const { tmpdir } = require("node:os");
const path = require("node:path");
const { after, beforeEach, test } = require("node:test");

const output = mkdtempSync(path.join(tmpdir(), "money-category-choices-"));
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
    "src/data/categoryChoices.ts",
  ],
  { cwd: path.resolve(__dirname, ".."), stdio: "pipe" },
);
const {
  categoryChoiceSections,
  normalizeCategorySearch,
  recentCategoryChoices,
  rememberCategory,
  resetRecentCategories,
} = require(path.join(output, "categoryChoices.js"));
const { categoryAppearance } = require(path.join(output, "appearance.js"));

beforeEach(resetRecentCategories);

function group(id, name, children = [name]) {
  return {
    id,
    name,
    icon: "house",
    color: "blue",
    children,
    childIds: Object.fromEntries(children.map((child) => [child, null])),
  };
}
const keys = (sections) =>
  sections.flatMap((section) => section.choices.map((choice) => choice.key));
const recentKeys = (groups, options = {}) =>
  recentCategoryChoices(groups, {
    selected: "",
    allowUncategorized: true,
    ...options,
  }).map((choice) => choice.key);

test("category search ignores diacritics, punctuation and case", () => {
  assert.equal(normalizeCategorySearch("CÁFÉ & Books — 42!"), "cafebooks42");
  assert.equal(normalizeCategorySearch("東京 42!"), "東京42");
  const groups = [
    group("reading-cafe", "Café & Books", ["Crème-brûlée", "Novels"]),
  ];
  const [section] = categoryChoiceSections(
    groups,
    "  CAFE&BOOKS  CREME-BRULEE!  ",
    true,
  );
  assert.deepEqual(section.choices, [
    {
      key: "reading-cafe|Crème-brûlée",
      category: "reading-cafe",
      subcategory: "Crème-brûlée",
      appearance: categoryAppearance("Café & Books", "Crème-brûlée"),
    },
  ]);
  assert.deepEqual(keys(categoryChoiceSections(groups, "!!!", true)), [
    "reading-cafe|Crème-brûlée",
    "reading-cafe|Novels",
  ]);
});

test("every search term must match the combined group and child name", () => {
  const groups = [
    group("outside-food", "Outside Food", ["Restaurants", "Coffee"]),
    group("pantry", "Indoor Pantry", ["Restaurant kits"]),
    group("reading", "Outdoor Reading", ["Novels"]),
  ];
  for (const query of ["out rest", "  REST\t out\n"]) {
    const sections = categoryChoiceSections(groups, query, true);
    assert.deepEqual(keys(sections), ["outside-food|Restaurants"]);
    assert.equal(sections[0].heading.name, "Outside Food");
  }
});

test("consecutive single-child groups share a grid between headed groups", () => {
  const groups = [
    group("orchard", "Orchard Pantry", ["Herbs"]),
    group("river", "River Workshop", ["Tools"]),
    group("journeys", "Cloud Journeys", ["Flights", "Cabins"]),
    group("meadow", "Meadow Garden", ["Seeds"]),
    group("lantern", "Lantern Studio", ["Candles"]),
    group("leisure", "Harbor Leisure", ["Games", "Music"]),
  ];
  const original = structuredClone(groups);
  const sections = categoryChoiceSections(groups, "", true);
  assert.deepEqual(
    sections.map((section) => ({
      id: section.id,
      heading: section.heading?.name ?? null,
      keys: section.choices.map((choice) => choice.key),
    })),
    [
      { id: "orchard", heading: null, keys: ["orchard|Herbs", "river|Tools"] },
      {
        id: "journeys",
        heading: "Cloud Journeys",
        keys: ["journeys|Flights", "journeys|Cabins"],
      },
      {
        id: "meadow",
        heading: null,
        keys: ["meadow|Seeds", "lantern|Candles"],
      },
      {
        id: "leisure",
        heading: "Harbor Leisure",
        keys: ["leisure|Games", "leisure|Music"],
      },
    ],
  );
  assert.deepEqual(
    sections[1].heading.appearance,
    categoryAppearance("Cloud Journeys"),
  );
  assert.deepEqual(groups, original);
});

test("empty sections are dropped while matching runs keep their first group id", () => {
  const groups = [
    group("orchard", "Orchard Pantry", ["Herbs"]),
    group("river", "River Workshop", ["Tools"]),
    group("journeys", "Cloud Journeys", ["Flights", "Cabins"]),
    group("meadow", "Meadow Garden", ["Seeds"]),
    group("empty", "Empty Studio", []),
  ];
  const [section] = categoryChoiceSections(groups, "tools", true);
  assert.equal(section.id, "orchard");
  assert.equal(section.heading, null);
  assert.deepEqual(keys([section]), ["river|Tools"]);
  assert.deepEqual(categoryChoiceSections(groups, "missing", true), []);
  assert.deepEqual(categoryChoiceSections([], "", true), []);
  assert.ok(
    categoryChoiceSections(groups, "", true).every(
      (section) => section.choices.length > 0,
    ),
  );
});

test("Uncategorized is available only when allowed", () => {
  const groups = [
    group("uncategorized", "Uncategorized"),
    group("orchard", "Orchard Pantry"),
  ];
  assert.deepEqual(keys(categoryChoiceSections(groups, "", true)), [
    "uncategorized|Uncategorized",
    "orchard|Orchard Pantry",
  ]);
  assert.deepEqual(keys(categoryChoiceSections(groups, "", false)), [
    "orchard|Orchard Pantry",
  ]);
  assert.deepEqual(categoryChoiceSections(groups, "uncategorized", false), []);
});

test("recents deduplicate by full key and move the latest choice first", () => {
  const groups = [
    group("lumen", "Lumen Studio", ["Books", "Crafts"]),
    group("nova", "Nova Club", ["Books"]),
  ];
  assert.deepEqual(recentKeys(groups), []);
  rememberCategory("lumen", "Books");
  rememberCategory("lumen", "Crafts");
  rememberCategory("nova", "Books");
  rememberCategory("lumen", "Books");
  assert.deepEqual(recentKeys(groups), [
    "lumen|Books",
    "nova|Books",
    "lumen|Crafts",
  ]);
});

test("recents retain at most six choices in most-recent-first order", () => {
  const groups = [
    "Amber",
    "Birch",
    "Clover",
    "Dune",
    "Elm",
    "Fable",
    "Grove",
  ].map((name) => group(name.toLowerCase(), name));
  for (const item of groups) rememberCategory(item.id, item.children[0]);
  assert.deepEqual(recentKeys(groups), [
    "grove|Grove",
    "fable|Fable",
    "elm|Elm",
    "dune|Dune",
    "clover|Clover",
    "birch|Birch",
  ]);
});

test("remembering Uncategorized never adds or displaces a recent choice", () => {
  const groups = [
    ...["Amber", "Birch", "Clover", "Dune", "Elm", "Fable"].map((name) =>
      group(name.toLowerCase(), name),
    ),
    group("uncategorized", "Uncategorized"),
  ];
  rememberCategory("uncategorized", "Uncategorized");
  assert.deepEqual(recentKeys(groups), []);
  for (const item of groups) rememberCategory(item.id, item.children[0]);
  const expected = [
    "fable|Fable",
    "elm|Elm",
    "dune|Dune",
    "clover|Clover",
    "birch|Birch",
    "amber|Amber",
  ];
  assert.deepEqual(recentKeys(groups), expected);
  assert.deepEqual(recentKeys(groups, { allowUncategorized: false }), expected);
});

test("recents resolve current metadata and drop removed groups and children", () => {
  rememberCategory("orchard", "Herbs");
  rememberCategory("river", "Tools");
  rememberCategory("journeys", "Cabins");
  const groups = [
    group("orchard", "Orchard Books", ["Herbs"]),
    group("river", "River Workshop", ["Supplies"]),
  ];
  assert.deepEqual(recentKeys(groups), ["orchard|Herbs"]);
  assert.deepEqual(recentKeys([]), []);
  assert.deepEqual(
    recentCategoryChoices(groups, { selected: "", allowUncategorized: true })[0]
      .appearance,
    categoryAppearance("Orchard Books", "Herbs"),
  );
});

test("recents exclude only the selected key and can be reset", () => {
  const groups = [group("lumen", "Lumen Studio", ["Books", "Crafts"])];
  rememberCategory("lumen", "Books");
  rememberCategory("lumen", "Crafts");
  assert.deepEqual(recentKeys(groups, { selected: "lumen|Crafts" }), [
    "lumen|Books",
  ]);
  assert.deepEqual(recentKeys(groups), ["lumen|Crafts", "lumen|Books"]);
  resetRecentCategories();
  assert.deepEqual(recentKeys(groups), []);
});
