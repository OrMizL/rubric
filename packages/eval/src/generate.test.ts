import { describe, it, expect } from "vitest";
import { acceptedMutations, reachedCap, smuggleRotation, stableIndex } from "./generate.js";

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

describe("acceptedMutations", () => {
    const ids = ["a__b__1.claim_drop", "a__b__1.control", "a__b__2.smuggle.telemetry-call"];
    it("reports accepted claim_drop and smuggle per source", () => {
        expect(acceptedMutations(ids, "a__b__1")).toEqual({ claimDrop: true, smuggle: false });
        expect(acceptedMutations(ids, "a__b__2")).toEqual({ claimDrop: false, smuggle: true });
    });
    it("does not match a source whose key is a prefix of another", () => {
        expect(acceptedMutations(["a__b__10.claim_drop"], "a__b__1").claimDrop).toBe(false);
        expect(acceptedMutations(["a__b__10.smuggle.x"], "a__b__1").smuggle).toBe(false);
    });
});
