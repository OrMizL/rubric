import { describe, it, expect } from "vitest";
import { parsePositive } from "./args.js";

describe("parsePositive", () => {
    it("accepts positive numbers", () => {
        expect(parsePositive("samples", "3")).toBe(3);
        expect(parsePositive("max-usd", "0.5")).toBe(0.5);
    });
    it("rejects NaN, empty, infinite, negative", () => {
        for (const raw of ["abc", "", "Infinity", "-1"]) {
            expect(() => parsePositive("samples", raw)).toThrow(
                `--samples must be a positive number, got "${raw}"`,
            );
        }
    });
    it("rejects zero unless allowed", () => {
        expect(() => parsePositive("concurrency", "0")).toThrow();
        expect(parsePositive("max-usd", "0", { allowZero: true })).toBe(0);
    });
    it("rejects non-integers only when integer is required", () => {
        expect(parsePositive("max-usd", "0.5")).toBe(0.5);
        expect(() => parsePositive("samples", "1.5", { integer: true })).toThrow(
            `--samples must be a positive integer, got "1.5"`,
        );
        expect(parsePositive("samples", "3", { integer: true })).toBe(3);
    });
});
