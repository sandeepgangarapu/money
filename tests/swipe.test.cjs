const assert = require("node:assert/strict");
const { execFileSync } = require("node:child_process");
const { mkdtempSync, rmSync } = require("node:fs");
const { tmpdir } = require("node:os");
const path = require("node:path");
const { after, test } = require("node:test");

const output = mkdtempSync(path.join(tmpdir(), "money-swipe-"));
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
    "src/data/swipe.ts",
  ],
  { cwd: path.resolve(__dirname, ".."), stdio: "pipe" },
);
const { swipeIntent, shouldExcludeSwipe } = require(
  path.join(output, "swipe.js"),
);

test("a deliberate left swipe excludes while a short swipe returns the card", () => {
  assert.equal(swipeIntent(-30, 4), "left");
  assert.equal(shouldExcludeSwipe(-30, 4), false);
  assert.equal(shouldExcludeSwipe(-100, 8), true);
  assert.equal(shouldExcludeSwipe(-72, 0), true);
});

test("vertical scrolling and diagonal movement never exclude a transaction", () => {
  assert.equal(swipeIntent(-20, 90), "scroll");
  assert.equal(shouldExcludeSwipe(-20, 90), false);
  assert.equal(shouldExcludeSwipe(-100, 80), false);
  assert.equal(shouldExcludeSwipe(-120, -100), false);
});

test("right swipes and a left swipe reversed before release leave cash flow unchanged", () => {
  assert.equal(shouldExcludeSwipe(110, 3), false);
  assert.equal(shouldExcludeSwipe(0, 0), false);
  assert.equal(shouldExcludeSwipe(-8, 1), false);
});

test("right confirmation requires the same deliberate threshold as exclusion", () => {
  const { shouldConfirmSwipe } = require(path.join(output, "swipe.js"));
  assert.equal(swipeIntent(30, 4), "right");
  assert.equal(shouldConfirmSwipe(30, 4), false);
  assert.equal(shouldConfirmSwipe(71, 0), false);
  assert.equal(shouldConfirmSwipe(72, 0), true);
  assert.equal(shouldConfirmSwipe(100, 8), true);
  assert.equal(shouldConfirmSwipe(-100, 8), false);
  assert.equal(shouldConfirmSwipe(100, 80), false);
  assert.equal(shouldConfirmSwipe(20, 90), false);
  assert.equal(shouldConfirmSwipe(0, 0), false);
});
