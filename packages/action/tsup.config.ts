import { defineConfig } from "tsup";

// Single self-contained CJS bundle: GitHub Actions run the committed dist/
// directly with no `npm install` step, so every dependency must be inlined.
export default defineConfig({
  entry: { index: "src/main.ts" },
  format: ["cjs"],
  platform: "node",
  target: "node20",
  noExternal: [/./],
  clean: true,
  outDir: "dist",
  outExtension() {
    return { js: ".cjs" };
  },
});
