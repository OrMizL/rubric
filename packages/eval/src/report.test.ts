import { describe, it, expect } from "vitest";
import { fmtRate, renderCompare, renderReport, type Manifest } from "./report.js";
import { computeMetrics, wilson, type Observation } from "./metrics.js";
import { CONFIGS } from "./configs.js";

const manifest: Manifest = {
    runId: "r1",
    createdAt: "2026-10-05T00:00:00Z",
    rubricSha: "abc123",
    split: "dev",
    config: CONFIGS.default!,
    samples: 1,
    caseIds: ["a", "b"],
    estimatedUsd: 1,
    spentUsd: 0.5,
    stoppedForBudget: false,
};

function obs(
    caseId: string,
    pass: boolean,
    mutation: Observation["mutation"] = "swap",
): Observation {
    return {
        caseId,
        mutation,
        sampleIndex: 0,
        diffLines: 100,
        verdict: pass ? "misaligned" : "aligned",
        error: null,
        score: {
            pass,
            anchors: [
                { kind: "verdict", index: 0, outcome: pass ? "pass" : "fail", detail: "verdict x" },
            ],
        },
        statedClaimTexts: [],
        labelKeywords: [],
        costUsd: 0.25,
        ms: 1000,
        stageCost: { infer: 0.05, review: 0.2 },
        stageMs: { infer: 200, review: 800 },
        inferenceFailed: false,
    };
}

describe("fmtRate", () => {
    it("shows rate, interval, and counts", () => {
        expect(fmtRate(wilson(8, 10))).toBe("80.0% [49.0–94.3] (8/10)");
    });
});

describe("renderReport", () => {
    it("includes header facts, catch rates, and failing cases", () => {
        const o = [obs("a", true), obs("b", false)];
        const md = renderReport(manifest, computeMetrics(o), o);
        expect(md).toContain("abc123");
        expect(md).toContain("swap");
        expect(md).toContain("50.0%");
        expect(md).toMatch(/## Failing cases[\s\S]*\bb\b/);
        expect(md).toContain("±"); // the interval caveat
    });

    it("warns when the run stopped on the spend cap", () => {
        const o = [obs("a", true)];
        const md = renderReport({ ...manifest, stoppedForBudget: true }, computeMetrics(o), o);
        expect(md).toMatch(/spend cap/i);
    });
});

describe("renderCompare", () => {
    it("shows metric deltas and lists flipped cases", () => {
        const before = [obs("a", true), obs("b", false)];
        const after = [obs("a", false), obs("b", true)];
        const md = renderCompare(
            { manifest, metrics: computeMetrics(before), obs: before },
            { manifest: { ...manifest, runId: "r2" }, metrics: computeMetrics(after), obs: after },
        );
        expect(md).toContain("r1");
        expect(md).toContain("r2");
        expect(md).toMatch(/pass → fail[\s\S]*\ba\b/);
        expect(md).toMatch(/fail → pass[\s\S]*\bb\b/);
    });
});
