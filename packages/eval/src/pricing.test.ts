import { describe, it, expect } from "vitest";
import { callsCostUsd, costUsd } from "./pricing.js";

describe("costUsd", () => {
    it("prices input and output per million tokens", () => {
        expect(costUsd("claude-opus-4-8", { input_tokens: 1_000_000, output_tokens: 0 })).toBe(5);
        expect(costUsd("claude-sonnet-5-5", { input_tokens: 0, output_tokens: 1_000_000 })).toBe(
            10,
        );
    });

    it("throws on an unknown model rather than reporting $0", () => {
        expect(() => costUsd("mystery", { input_tokens: 1, output_tokens: 1 })).toThrow(/mystery/);
    });
});

describe("callsCostUsd", () => {
    it("sums across calls", () => {
        const usage = (i: number, o: number) => ({ input_tokens: i, output_tokens: o }) as never;
        const total = callsCostUsd([
            { stage: "infer", model: "claude-opus-5-5", usage: usage(1_000_000, 0), ms: 1 },
            { stage: "review", model: "claude-opus-5-5", usage: usage(0, 1_000_000), ms: 1 },
        ]);
        expect(total).toBe(24);
    });
});
