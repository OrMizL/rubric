import { describe, it, expect } from "vitest";
import { filterFiles, rankFiles, truncateToBudget } from "./budget.js";
import type { ChangedFile } from "./types.js";

function file(
    filename: string,
    patch: string | undefined = "@@ -1 +1 @@\n+x",
    extra: Partial<ChangedFile> = {},
): ChangedFile {
    return { filename, status: "modified", additions: 1, deletions: 0, patch, ...extra };
}

describe("filterFiles", () => {
    it("drops lockfiles", () => {
        const kept = filterFiles([
            file("pnpm-lock.yaml"),
            file("package-lock.json"),
            file("yarn.lock"),
            file("Cargo.lock"),
            file("src/index.ts"),
        ]).map((f) => f.filename);
        expect(kept).toEqual(["src/index.ts"]);
    });

    it("drops minified, dist, and snapshot files", () => {
        const kept = filterFiles([
            file("app.min.js"),
            file("styles.min.css"),
            file("dist/index.cjs"),
            file("packages/core/dist/bundle.js"),
            file("__snapshots__/render.test.ts.snap"),
            file("src/real.ts"),
        ]).map((f) => f.filename);
        expect(kept).toEqual(["src/real.ts"]);
    });

    it("drops files GitHub omits a patch for (binary/generated)", () => {
        const kept = filterFiles([
            { ...file("logo.png"), patch: undefined },
            file("src/keep.ts", "@@ -1 +1 @@\n+ok"),
        ]).map((f) => f.filename);
        expect(kept).toEqual(["src/keep.ts"]);
    });
});

describe("rankFiles", () => {
    it("orders src before config before tests before docs, stable within a category", () => {
        const ranked = rankFiles([
            file("README.md"),
            file("src/a.test.ts"),
            file("package.json"),
            file("src/b.ts"),
            file("src/a.ts"),
            file("docs/guide.md"),
            file("tsconfig.json"),
        ]).map((f) => f.filename);
        expect(ranked).toEqual([
            "src/b.ts",
            "src/a.ts",
            "package.json",
            "tsconfig.json",
            "src/a.test.ts",
            "README.md",
            "docs/guide.md",
        ]);
    });
});

describe("truncateToBudget", () => {
    // Deterministic fake counter: 1 token per character.
    const countChars = (text: string) => text.length;

    it("passes through unchanged when under budget", async () => {
        const files = [file("src/a.ts", "aaa"), file("src/b.ts", "bbb")];
        const result = await truncateToBudget(files, 10_000, countChars);
        expect(result.truncated).toBe(false);
        expect(result.omitted).toEqual([]);
        expect(result.files.map((f) => f.filename)).toEqual(["src/a.ts", "src/b.ts"]);
        expect(result.diffText).toContain("src/a.ts");
        expect(result.diffText).toContain("src/b.ts");
    });

    it("omits lowest-priority files over budget and emits an omission summary", async () => {
        const big = "z".repeat(1000);
        const files = [
            file("src/keep1.ts", big),
            file("src/keep2.ts", big),
            file("docs/drop.md", big, { additions: 40, deletions: 3 }),
        ];
        // Budget fits two ~1000-char blocks but not the third.
        const result = await truncateToBudget(files, 2500, countChars);
        expect(result.truncated).toBe(true);
        expect(result.files.map((f) => f.filename)).toEqual(["src/keep1.ts", "src/keep2.ts"]);
        expect(result.omitted.map((f) => f.filename)).toEqual(["docs/drop.md"]);
        expect(result.diffText).toContain("1 file");
        expect(result.diffText).toContain("docs/drop.md");
        expect(result.diffText).toContain("+40/-3");
    });
});
