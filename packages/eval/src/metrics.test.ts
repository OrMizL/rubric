import { describe, it, expect } from "vitest";
import type { EngineCall, Review } from "@rubric/core";
import {
    caseOutcomes,
    computeMetrics,
    toObservations,
    wilson,
    type Observation,
} from "./metrics.js";
import { makeCase } from "./fixtures.js";
import type { ResultLine } from "./run.js";

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

const FAIL = { pass: false, anchors: [] };

function samples(caseId: string, mutation: Observation["mutation"], passes: boolean[]) {
    return passes.map((p, i) =>
        obs({ caseId, mutation, sampleIndex: i, score: p ? { pass: true, anchors: [] } : FAIL }),
    );
}

describe("multi-sample aggregation", () => {
    it("uses n = cases for catch rate, with per-case majority", () => {
        const m = computeMetrics([
            ...samples("a", "swap", [true, true, false]),
            ...samples("b", "swap", [true, false, false]),
        ]);
        expect(m.catchRate.swap).toMatchObject({ k: 1, n: 2 });
        expect(m.observations).toBe(6);
        expect(m.cases).toBe(2);
    });

    it("passes a case on a 2-of-3 majority", () => {
        const out = caseOutcomes(samples("a", "swap", [true, false, true]));
        expect(out.get("a")!.pass).toBe(true);
    });

    it("breaks verdict ties toward severity across all three verdicts", () => {
        const verdictOf = (vs: Observation["verdict"][]) =>
            caseOutcomes(vs.map((v, i) => obs({ caseId: "a", sampleIndex: i, verdict: v }))).get(
                "a",
            )!.verdict;
        expect(verdictOf(["aligned", "partially_aligned"])).toBe("partially_aligned");
        expect(verdictOf(["partially_aligned", "misaligned"])).toBe("misaligned");
        expect(verdictOf([null, "aligned"])).toBe("aligned");
    });

    it("computes false alarm over cases using majority verdicts", () => {
        const v = (id: string, vs: Observation["verdict"][]) =>
            vs.map((verdict, i) => obs({ caseId: id, sampleIndex: i, verdict }));
        const m = computeMetrics([
            ...v("c1", ["misaligned", "aligned", "misaligned"]),
            ...v("c2", ["aligned", "aligned", "misaligned"]),
        ]);
        expect(m.falseAlarm).toMatchObject({ k: 1, n: 2 });
    });

    it("treats a fully errored case as not passing without crashing", () => {
        const errored = [0, 1, 2].map((i) =>
            obs({
                caseId: "e",
                mutation: "swap",
                sampleIndex: i,
                verdict: null,
                error: "boom",
                score: null,
            }),
        );
        const m = computeMetrics(errored);
        expect(m.catchRate.swap).toMatchObject({ k: 0, n: 1 });
        expect(caseOutcomes(errored).get("e")).toMatchObject({ pass: false, verdict: null });
        expect(m.errors.failed).toMatchObject({ k: 3, n: 3 });
    });

    it("excludes all-errored cases from mean agreement but not from flips", () => {
        const errored = [0, 1].map((i) =>
            obs({ caseId: "e", sampleIndex: i, verdict: null, error: "x", score: null }),
        );
        const split = [0, 1, 2].map((i) =>
            obs({ caseId: "a", sampleIndex: i, verdict: i === 2 ? "misaligned" : "aligned" }),
        );
        const m = computeMetrics([...errored, ...split]);
        expect(m.stability!.meanAgreement).toBeCloseTo(2 / 3);
        const onlyErrored = computeMetrics(errored);
        expect(onlyErrored.stability!.meanAgreement).toBe(0);
        expect(onlyErrored.stability!.flipRate.n).toBe(1);
    });
});

describe("toObservations", () => {
    const calls: EngineCall[] = [
        {
            stage: "infer",
            model: "claude-opus-5-5",
            usage: { input_tokens: 1_000_000, output_tokens: 0 } as EngineCall["usage"],
            ms: 100,
        },
        {
            stage: "review",
            model: "claude-opus-5-5",
            usage: { input_tokens: 0, output_tokens: 1_000_000 } as EngineCall["usage"],
            ms: 700,
        },
    ];
    const review = (inference: Review["inference"]): Review => ({
        verdict: "aligned",
        summary: "ok",
        statedClaims: [],
        inferredClaims: [],
        unstatedChanges: [],
        truncated: false,
        signalScore: { total: 80, band: "high", components: [] },
        inference,
    });
    const line = (inference: Review["inference"]): ResultLine => ({
        key: "k",
        caseId: makeCase().id,
        config: "cfg",
        sampleIndex: 0,
        review: review(inference),
        calls,
        ms: 900,
        error: null,
        cached: false,
        costUsd: 24,
    });

    it("splits cost and latency by stage and flags failed inference", () => {
        const [failed] = toObservations([makeCase()], [line({ ran: false, reason: "boom" })]);
        expect(failed!.stageCost.infer).toBeCloseTo(4);
        expect(failed!.stageCost.review).toBeCloseTo(20);
        expect(failed!.costUsd).toBeCloseTo(24);
        expect(failed!.stageMs).toEqual({ infer: 100, review: 700 });
        expect(failed!.inferenceFailed).toBe(true);
        const [disabled] = toObservations([makeCase()], [line({ ran: false, reason: "disabled" })]);
        expect(disabled!.inferenceFailed).toBe(false);
    });
});
