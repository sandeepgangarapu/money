import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";

// Guards the build boundary: the household build must not contain the demo
// household, and the demo build must. Usage: node scripts/check-build.mjs <dir> <household|demo>
const [directory, edition] = process.argv.slice(2);
const marker = "Lakeside Home Loans";
const assets = path.join(directory, "assets");
const found = readdirSync(assets)
  .filter((file) => file.endsWith(".js"))
  .some((file) =>
    readFileSync(path.join(assets, file), "utf8").includes(marker),
  );
if (found !== (edition === "demo")) {
  console.error(
    edition === "demo"
      ? `${directory} is missing the demo household`
      : `${directory} contains demo data; the demo transport leaked into the household build`,
  );
  process.exit(1);
}
console.log(`${directory}: ${edition} build boundary OK`);
