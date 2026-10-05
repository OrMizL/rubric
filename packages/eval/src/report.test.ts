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

describe("fmtRate n/a", () => {
    it("prints n/a for an empty rate", () => {
        expect(fmtRate(wilson(0, 0))).toBe("n/a (0/0)");
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

    it("flags an incomplete run by counts even when the cap flag is false", () => {
        const o = [obs("a", true)];
        const md = renderReport(manifest, computeMetrics(o), o);
        expect(md).toContain("ran 1 of 2 planned cases");
        expect(md).toContain("1 of 2 planned cases");
        expect(md).not.toMatch(/spend cap/i);
    });

    it("shows n/a for the false-alarm rate when no controls ran", () => {
        const o = [obs("a", true)];
        const md = renderReport(manifest, computeMetrics(o), o);
        expect(md).toMatch(/False alarm.*n\/a \(0\/0\)/);
    });

    it("reports failing samples only, with the first failing sample's reason", () => {
        const pass = obs("a", true);
        const fail1 = { ...obs("a", false), sampleIndex: 1 };
        const fail2 = { ...obs("a", false), sampleIndex: 2, error: "boom", score: null };
        const o = [pass, fail1, fail2];
        const md = renderReport({ ...manifest, caseIds: ["a"] }, computeMetrics(o), o);
        expect(md).toContain("**a** (swap) (2 of 3 samples failed) — verdict fail: verdict x");
        expect(md).not.toContain("boom");
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
        const toFail = md.slice(md.indexOf("## pass → fail"), md.indexOf("## fail → pass"));
        const toPass = md.slice(md.indexOf("## fail → pass"));
        expect(toFail).toContain("- a");
        expect(toFail).not.toContain("- b");
        expect(toPass).toContain("- b");
        expect(toPass).not.toContain("- a");
    });

    const run = (m: Manifest, o: Observation[]) => ({
        manifest: m,
        metrics: computeMetrics(o),
        obs: o,
    });

    it("shows n and the delta for each side", () => {
        const md = renderCompare(
            run(manifest, [obs("a", true), obs("b", false)]),
            run({ ...manifest, runId: "r2" }, [obs("a", true), obs("b", true)]),
        );
        expect(md).toContain("50.0% (n=2) → 100.0% (n=2) (+50.0)");
        expect(md).toContain("Differences within the intervals are noise");
        expect(md).not.toContain("## Warnings");
    });

    it("warns on cap, split, samples, config, and unmatched cases", () => {
        const md = renderCompare(
            run({ ...manifest, stoppedForBudget: true }, [obs("a", true), obs("b", true)]),
            run(
                {
                    ...manifest,
                    runId: "r2",
                    split: "test",
                    samples: 3,
                    config: { ...manifest.config, name: "other" },
                },
                [obs("a", true), obs("c", true)],
            ),
        );
        expect(md).toContain("## Warnings");
        expect(md).toMatch(/r1 stopped at the spend cap/);
        expect(md).toContain("split differs: dev vs test");
        expect(md).toContain("samples differ: 1 vs 3");
        expect(md).toContain("config differs: default vs other");
        expect(md).toContain("1 case(s) only in r1");
        expect(md).toContain("1 case(s) only in r2");
    });
});
