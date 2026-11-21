const assert = require("node:assert/strict");
const { readdirSync, readFileSync } = require("node:fs");
const path = require("node:path");
const { test } = require("node:test");

const root = path.resolve(__dirname, "../src");
function cssFiles(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const file = path.join(directory, entry.name);
    return entry.isDirectory()
      ? cssFiles(file)
      : file.endsWith(".css")
        ? [file]
        : [];
  });
}
for (const file of cssFiles(root)) {
  test(`${path.relative(root, file)} uses the design foundation`, () => {
    const css = readFileSync(file, "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
    for (const match of css.matchAll(/\bfont-size\s*:\s*([^;}]+)/gi))
      assert.match(
        match[1].trim(),
        /^(?:var\(--fs-(?:display|hero|title|headline|body|sub|caption|micro)\)|inherit)$/,
        `${file}: ${match[0]}`,
      );
    if (file !== path.join(root, "index.css"))
      assert.doesNotMatch(
        css,
        /#[\da-f]{3,8}\b/i,
        "Colors belong in index.css tokens",
      );
    assert.doesNotMatch(css, /text-transform\s*:\s*uppercase\b/i);
  });
}
