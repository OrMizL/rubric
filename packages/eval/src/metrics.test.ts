import { describe, it, expect } from "vitest";
import { caseOutcomes, computeMetrics, wilson, type Observation } from "./metrics.js";

function obs(over: Partial<Observation>): Observation {
    return {
        caseId: "c",
        mutation: "control",
        sampleIndex: 0,
        diffLines: 100,
        verdict: "aligned",
        error: null,
        score: { pass: true, anchors: [] },
        statedClaimTexts: [],
        labelKeywords: [],
        costUsd: 0.1,
        ms: 1000,
        stageCost: { infer: 0.02, review: 0.08 },
        stageMs: { infer: 200, review: 800 },
        inferenceFailed: false,
        ...over,
    };
}

describe("wilson", () => {
    it("matches a known interval", () => {
        const r = wilson(8, 10);
        expect(r.rate).toBeCloseTo(0.8);
        expect(r.lo).toBeCloseTo(0.4902, 3);
        expect(r.hi).toBeCloseTo(0.9433, 3);
    });
    it("handles n = 0 without NaN", () => {
        expect(wilson(0, 0)).toEqual({ k: 0, n: 0, rate: 0, lo: 0, hi: 1 });
    });
});

describe("caseOutcomes", () => {
    it("takes the majority across samples; ties fail", () => {
        const out = caseOutcomes([
            obs({ caseId: "a", sampleIndex: 0, score: { pass: true, anchors: [] } }),
            obs({ caseId: "a", sampleIndex: 1, score: { pass: false, anchors: [] } }),
        ]);
        expect(out.get("a")!.pass).toBe(false);
    });
    it("breaks verdict ties toward the more severe verdict", () => {
        const out = caseOutcomes([
            obs({ caseId: "a", sampleIndex: 0, verdict: "aligned" }),
            obs({ caseId: "a", sampleIndex: 1, verdict: "misaligned" }),
        ]);
        expect(out.get("a")!.verdict).toBe("misaligned");
    });
});

describe("computeMetrics", () => {
    it("computes false alarms from control verdicts only", () => {
        const m = computeMetrics([
            obs({ caseId: "c1", verdict: "misaligned", score: { pass: false, anchors: [] } }),
            obs({ caseId: "c2", verdict: "partially_aligned" }),
            obs({ caseId: "c3", mutation: "control_stripped" }),
            obs({ caseId: "s1", mutation: "swap", verdict: "misaligned" }),
        ]);
        expect(m.falseAlarm).toMatchObject({ k: 1, n: 3 });
        expect(m.partialOnControls).toMatchObject({ k: 1, n: 3 });
        expect(m.catchRate.swap).toMatchObject({ k: 1, n: 1 });
    });

    it("buckets smuggles by smuggle size and diff size", () => {
        const m = computeMetrics([
            obs({ caseId: "a", mutation: "smuggle", smuggleLines: 3, diffLines: 150 }),
            obs({
                caseId: "b",
                mutation: "smuggle",
                smuggleLines: 25,
                diffLines: 1500,
                score: { pass: false, anchors: [] },
            }),
        ]);
        const small = m.smuggleBySize.find((b) => b.smuggle === "≤5" && b.diff === "<200")!;
        const large = m.smuggleBySize.find((b) => b.smuggle === ">20" && b.diff === ">1000")!;
        expect(small.rate).toMatchObject({ k: 1, n: 1 });
        expect(large.rate).toMatchObject({ k: 0, n: 1 });
    });

    it("pools claim recall over claim anchors", () => {
        const m = computeMetrics([
            obs({
                caseId: "a",
                mutation: "scope_lie",
                score: {
                    pass: false,
                    anchors: [
                        { kind: "claim", index: 0, outcome: "pass", detail: "" },
                        { kind: "claim", index: 1, outcome: "not_found", detail: "" },
                        { kind: "verdict", index: 0, outcome: "pass", detail: "" },
                    ],
                },
            }),
        ]);
        expect(m.claimRecall).toMatchObject({ k: 1, n: 2 });
    });

    it("computes precision on real cases only", () => {
        const m = computeMetrics([
            obs({
                caseId: "r",
                mutation: "real",
                statedClaimTexts: ["Adds retry with backoff", "Renames the config flag"],
                labelKeywords: [["retry"]],
            }),
            obs({ caseId: "x", statedClaimTexts: ["Unlabeled claim"], labelKeywords: [] }),
        ]);
        expect(m.claimPrecision).toMatchObject({ k: 1, n: 2 });
    });

    it("reports stability across samples", () => {
        const m = computeMetrics([
            obs({ caseId: "a", sampleIndex: 0, verdict: "aligned" }),
            obs({ caseId: "a", sampleIndex: 1, verdict: "aligned" }),
            obs({
                caseId: "a",
                sampleIndex: 2,
                verdict: "misaligned",
                score: { pass: false, anchors: [] },
            }),
        ]);
        expect(m.stability!.meanAgreement).toBeCloseTo(2 / 3);
        expect(m.stability!.flipRate).toMatchObject({ k: 1, n: 1 });
    });

    it("survives errored observations", () => {
        const m = computeMetrics([
            obs({
                caseId: "a",
                mutation: "swap",
                verdict: null,
                error: "parse_failed",
                score: null,
            }),
            obs({ caseId: "b", mutation: "swap", verdict: "misaligned" }),
        ]);
        expect(m.catchRate.swap).toMatchObject({ k: 1, n: 2 });
        expect(m.errors.failed).toMatchObject({ k: 1, n: 2 });
        expect(m.stability).toBeNull();
    });

    it("summarizes cost and latency", () => {
        const m = computeMetrics([
            obs({ caseId: "a", costUsd: 0.1, ms: 1000 }),
            obs({ caseId: "b", costUsd: 0.3, ms: 3000 }),
        ]);
        expect(m.cost.meanUsd).toBeCloseTo(0.2);
        expect(m.cost.p90Usd).toBeCloseTo(0.3);
        expect(m.cost.byStage.review.meanUsd).toBeCloseTo(0.08);
    });
});
