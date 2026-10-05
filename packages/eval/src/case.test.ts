import { describe, it, expect } from "vitest";
import { CaseSchema, computeMeta, validateCase } from "./case.js";
import { makeCase } from "./fixtures.js";

describe("CaseSchema", () => {
    it("accepts a well-formed case", () => {
        expect(CaseSchema.parse(makeCase()).id).toBe("o__r__1.control");
    });

    it("rejects an unknown mutation", () => {
        expect(() => CaseSchema.parse({ ...makeCase(), mutation: "nope" })).toThrow();
    });
});

describe("computeMeta", () => {
    it("sums additions and deletions across files", () => {
        expect(computeMeta(makeCase().input)).toEqual({ diffLines: 2, fileCount: 1 });
    });
});

describe("validateCase", () => {
    it("returns no problems for a valid case", () => {
        expect(validateCase(makeCase())).toEqual([]);
    });

    it("flags counts that disagree with the patch", () => {
        const c = makeCase();
        c.input.files[0]!.additions = 7;
        expect(validateCase(c).join()).toMatch(/src\/a\.ts.*additions/);
    });

    it("flags a patch that does not parse", () => {
        const c = makeCase();
        c.input.files[0]!.patch = "garbage";
        expect(validateCase(c).join()).toMatch(/does not parse/);
    });

    it("flags an unstated label pointing at a file not in the diff", () => {
        const c = makeCase({
            label: { verdict: {}, unstated: [{ file: "src/missing.ts", minRisk: "medium" }] },
        });
        expect(validateCase(c).join()).toMatch(/src\/missing\.ts/);
    });

    it("flags a label with no anchors at all", () => {
        expect(validateCase(makeCase({ label: { verdict: {} } })).join()).toMatch(/no anchors/);
    });

    it("flags meta.diffLines that disagrees with the files", () => {
        const c = makeCase();
        c.meta.diffLines = 99;
        expect(validateCase(c).join()).toMatch(/diffLines/);
    });

    it("flags meta.fileCount that disagrees with the files", () => {
        const c = makeCase();
        c.meta.fileCount = 4;
        expect(validateCase(c).join()).toMatch(/fileCount/);
    });

    it("flags a patch-less file that claims changes", () => {
        const c = makeCase();
        delete c.input.files[0]!.patch;
        expect(validateCase(c).join()).toMatch(/src\/a\.ts has counts but no patch/);
    });

    it("allows a patch-less file with zero counts (binary)", () => {
        const c = makeCase();
        c.input.files[0] = { filename: "img.png", status: "added", additions: 0, deletions: 0 };
        c.meta.diffLines = 0;
        expect(validateCase(c)).toEqual([]);
    });

    it("flags hunk header counts that disagree with the body", () => {
        const c = makeCase();
        c.input.files[0]!.patch = "@@ -1,5 +1 @@\n-a\n+b";
        expect(validateCase(c).join()).toMatch(
            /src\/a\.ts hunk 0 header counts disagree with body/,
        );
    });
});
