import { describe, it, expect } from "vitest";
import { caseHash, checkCaseHashes, hashCases, validateManifest } from "./manifest.js";
import { makeCase } from "./fixtures.js";

describe("caseHash", () => {
    it("is stable under key order and ignores meta", () => {
        const a = makeCase();
        const reordered = { ...a, input: { ...a.input }, meta: { ...a.meta, diffLines: 99 } };
        expect(caseHash(reordered)).toBe(caseHash(a));
    });
    it("changes when input or label changes", () => {
        const a = makeCase();
        expect(caseHash(makeCase({ label: { verdict: { oneOf: ["misaligned"] } } }))).not.toBe(
            caseHash(a),
        );
        const b = makeCase();
        b.input.title = "edited";
        expect(caseHash(b)).not.toBe(caseHash(a));
    });
});

describe("checkCaseHashes", () => {
    const a = makeCase({ id: "a" });
    const b = makeCase({ id: "b" });
    const manifest = { caseIds: ["a", "b"], caseHashes: hashCases([a, b]) };

    it("returns nothing when cases are unchanged", () => {
        expect(checkCaseHashes(manifest, [a, b])).toEqual([]);
    });
    it("lists edited and missing cases", () => {
        const edited = makeCase({ id: "a", label: { verdict: { oneOf: ["aligned"] } } });
        expect(checkCaseHashes(manifest, [edited, b])).toEqual(["a"]);
        expect(checkCaseHashes(manifest, [a])).toEqual(["b"]);
    });
});

describe("validateManifest", () => {
    it("names missing fields", () => {
        expect(() => validateManifest({ runId: "x" }, "/p/manifest.json")).toThrow(
            /\/p\/manifest.json is missing split, config/,
        );
    });
});
