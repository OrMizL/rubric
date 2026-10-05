import { describe, it, expect } from "vitest";
import { checkSource, parseSourceList, sourceId } from "./sources.js";
import { makeCase } from "./fixtures.js";

describe("parseSourceList", () => {
    it("parses refs and skips comments and blanks", () => {
        const refs = parseSourceList(
            "# repos\ncolinhacks/zod#4512\n\n  sindresorhus/slugify#73  \n",
        );
        expect(refs).toEqual([
            { owner: "colinhacks", repo: "zod", number: 4512 },
            { owner: "sindresorhus", repo: "slugify", number: 73 },
        ]);
    });
    it("rejects a malformed line with its line number", () => {
        expect(() => parseSourceList("ok/repo#1\nnot a ref")).toThrow(/line 2/);
    });
});

describe("parseSourceList duplicates", () => {
    it("rejects a duplicate ref with its line number", () => {
        expect(() => parseSourceList("a/b#1\nc/d#2\na/b#1")).toThrow(/line 3/);
    });
});

describe("sourceId", () => {
    it("is filesystem-safe", () => {
        expect(sourceId({ owner: "a", repo: "b.js", number: 3 })).toBe("a__b.js__3");
    });
});

describe("checkSource", () => {
    const base = () => {
        const pr = makeCase().input;
        pr.body = "Adds a retry loop around the fetch call.";
        pr.files.push({ ...pr.files[0]!, filename: "src/b.ts" });
        return pr;
    };

    it("accepts a merged, described, TS-majority PR with 2–30 files", () => {
        expect(checkSource(base(), true)).toEqual([]);
    });
    it("rejects unmerged", () => {
        expect(checkSource(base(), false).join()).toMatch(/merged/);
    });
    it("rejects an empty description", () => {
        const pr = base();
        pr.body = "  ";
        expect(checkSource(pr, true).join()).toMatch(/description/);
    });
    it("rejects a non-TS/JS-majority diff", () => {
        const pr = base();
        pr.files = pr.files.map((f) => ({ ...f, filename: f.filename.replace(".ts", ".py") }));
        expect(checkSource(pr, true).join()).toMatch(/TS\/JS/);
    });
    it("rejects too few files", () => {
        const pr = base();
        pr.files = pr.files.slice(0, 1);
        expect(checkSource(pr, true).join()).toMatch(/2–30/);
    });
    it("rejects a file whose patch GitHub omitted", () => {
        const pr = base();
        pr.files[1] = { ...pr.files[1]!, patch: undefined };
        expect(checkSource(pr, true).join()).toMatch(/omitted/);
    });
});
