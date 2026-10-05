import { describe, it, expect } from "vitest";
import { assertPaidAllowed, dataDir } from "./guards.js";

describe("dataDir", () => {
    it("returns RUBRIC_EVAL_DATA", () => {
        expect(dataDir({ RUBRIC_EVAL_DATA: "/d" })).toBe("/d");
    });
    it("throws when unset", () => {
        expect(() => dataDir({})).toThrow(/RUBRIC_EVAL_DATA/);
    });
});

describe("assertPaidAllowed", () => {
    it("refuses under CI", () => {
        expect(() => assertPaidAllowed({ CI: "true", ANTHROPIC_API_KEY: "k" })).toThrow(/CI/);
    });
    it("refuses without a key", () => {
        expect(() => assertPaidAllowed({})).toThrow(/ANTHROPIC_API_KEY/);
    });
    it("returns the key otherwise", () => {
        expect(assertPaidAllowed({ ANTHROPIC_API_KEY: "k" })).toBe("k");
    });
});
