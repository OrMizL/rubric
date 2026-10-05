import { describe, it, expect } from "vitest";
import { reachedCap, smuggleRotation, stableIndex } from "./generate.js";

describe("smuggleRotation", () => {
    const keys = Array.from({ length: 20 }, (_, i) => `o__r__${i}`);

    it("adding a source leaves existing sources' template and size unchanged", () => {
        const before = keys.map((k) => smuggleRotation(k));
        const withNew = ["o__a__0", ...keys].map((k) => smuggleRotation(k));
        expect(withNew.slice(1)).toEqual(before);
    });

    it("spreads sources across templates and sizes", () => {
        const rotations = keys.map((k) => smuggleRotation(k));
        expect(new Set(rotations.map((r) => r.template.id)).size).toBeGreaterThan(1);
        expect(new Set(rotations.map((r) => r.size)).size).toBeGreaterThan(1);
    });

    it("is salted so template and size are not locked together", () => {
        expect(stableIndex("k", "template", 1000)).not.toBe(stableIndex("k", "size", 1000));
    });
});

describe("reachedCap", () => {
    it("stops at or above the cap", () => {
        expect(reachedCap(4.99, 5)).toBe(false);
        expect(reachedCap(5, 5)).toBe(true);
        expect(reachedCap(7, 5)).toBe(true);
    });
});
