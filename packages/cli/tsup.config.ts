import { defineConfig } from "tsup";

// Self-contained CJS bundle so `rubric` can run standalone (e.g. installed
// globally) with no install step. A shebang makes dist/rubric.cjs executable.
export default defineConfig({
    entry: { rubric: "src/main.ts" },
    format: ["cjs"],
    platform: "node",
    target: "node20",
    noExternal: [/./],
    clean: true,
    outDir: "dist",
    banner: { js: "#!/usr/bin/env node" },
    outExtension() {
        return { js: ".cjs" };
    },
});
