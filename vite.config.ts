import react from "@vitejs/plugin-react";
import { type Plugin, defineConfig } from "vite";

// `vite build --mode demo` builds the public demo: the gateway transport is
// replaced by an in-browser fictional household, and assets use relative URLs
// so the site works from any static host path (GitHub Pages).
function demoEdition(): Plugin {
  return {
    name: "money-demo-edition",
    enforce: "pre",
    async resolveId(source, importer, options) {
      if (!/\/transport(\.ts)?$/.test(source)) return null;
      const resolved = await this.resolve(source, importer, {
        ...options,
        skipSelf: true,
      });
      return resolved?.id.endsWith("/src/data/transport.ts")
        ? resolved.id.replace(
            /\/src\/data\/transport\.ts$/,
            "/src/demo/transport.ts",
          )
        : null;
    },
    transformIndexHtml: (html) =>
      html
        .replace(/<title>[^<]*<\/title>/, "<title>Money · Demo</title>")
        .replace(
          /(<meta name="description" content=")[^"]*"/,
          '$1Demo of a household money app with a fictional household"',
        ),
  };
}

export default defineConfig(({ mode }) => {
  const demo = mode === "demo";
  return {
    plugins: [react(), ...(demo ? [demoEdition()] : [])],
    base: demo ? "./" : "/",
    server: { host: "0.0.0.0", port: 5173, strictPort: true },
    build: { target: "es2022", outDir: demo ? "dist-demo" : "dist" },
  };
});
