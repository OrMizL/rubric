import { describe, it, expect, beforeEach, vi } from "vitest";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { EngineCall, Review } from "@rubric/core";
import { BudgetExceededError, runEval, type Reviewer, type RunOptions } from "./run.js";
import { CONFIGS } from "./configs.js";
import { makeCase } from "./fixtures.js";

const review: Review = {
    verdict: "aligned",
    summary: "ok",
    statedClaims: [],
    inferredClaims: [],
    unstatedChanges: [],
    truncated: false,
    signalScore: { total: 80, band: "high", components: [] },
    inference: { ran: true },
};

// $0.25 per call at opus-5-5 prices: 0 input, 12_500 output tokens.
const call: EngineCall = {
    stage: "review",
    model: "claude-opus-5-5",
    usage: { input_tokens: 0, output_tokens: 12_500 } as EngineCall["usage"],
    ms: 3,
};

let cacheDir: string;
beforeEach(async () => {
    cacheDir = await mkdtemp(join(tmpdir(), "rubric-run-"));
});

function opts(over: Partial<RunOptions> = {}): RunOptions {
    const reviewer: Reviewer = async (_c, _cfg, onCall) => {
        onCall(call);
        return review;
    };
    return {
        cases: [makeCase({ id: "a" }), makeCase({ id: "b" })],
        config: CONFIGS.default!,
        samples: 1,
        maxUsd: 10,
        concurrency: 2,
        cacheDir,
        reviewer,
        estimator: async () => 0.25,
        prompts: { review: "R", infer: "I" },
        engineFingerprint: "F",
        log: () => {},
        ...over,
    };
}

describe("runEval", () => {
    it("runs every case × sample and records cost", async () => {
        const out = await runEval(opts({ samples: 2 }));
        expect(out.results).toHaveLength(4);
        expect(out.spentUsd).toBeCloseTo(1.0);
        expect(out.results.every((r) => r.review?.verdict === "aligned")).toBe(true);
    });

    it("serves a rerun entirely from cache at zero cost", async () => {
        await runEval(opts());
        const reviewer = vi.fn<Reviewer>();
        const again = await runEval(opts({ reviewer }));
        expect(reviewer).not.toHaveBeenCalled();
        expect(again.spentUsd).toBe(0);
        expect(again.results.every((r) => r.cached)).toBe(true);
    });

    it("aborts before any call when the estimate exceeds the cap", async () => {
        const reviewer = vi.fn<Reviewer>();
        await expect(runEval(opts({ reviewer, maxUsd: 0.4 }))).rejects.toBeInstanceOf(
            BudgetExceededError,
        );
        expect(reviewer).not.toHaveBeenCalled();
    });

    it("excludes cached work from the estimate", async () => {
        await runEval(opts());
        // Both cases cached; a zero cap must still pass.
        await expect(runEval(opts({ maxUsd: 0 }))).resolves.toBeDefined();
    });

    it("stops starting new jobs once actual spend would pass the cap", async () => {
        // Estimate says $0.01 each, reality is $0.25 each; cap $0.255, concurrency 1.
        // After job 1, $0.25 spent + $0.01 estimate > cap, so job 2 never starts.
        const out = await runEval(
            opts({ estimator: async () => 0.01, maxUsd: 0.255, concurrency: 1 }),
        );
        expect(out.stoppedForBudget).toBe(true);
        expect(out.results).toHaveLength(1);
    });

    it("records a reviewer error as an outcome and caches it", async () => {
        const reviewer: Reviewer = async (_c, _cfg, onCall) => {
            onCall(call);
            throw new Error("Review parse failed (stop_reason: max_tokens)");
        };
        const out = await runEval(opts({ reviewer }));
        expect(out.results.every((r) => r.review === null)).toBe(true);
        expect(out.results[0]!.error).toMatch(/parse failed/);
        expect(out.spentUsd).toBeCloseTo(0.5);
    });

    it("does not serve a run from cache when the engine fingerprint differs", async () => {
        await runEval(opts());
        const reviewer = vi.fn<Reviewer>(async (_c, _cfg, onCall) => {
            onCall(call);
            return review;
        });
        const again = await runEval(opts({ reviewer, engineFingerprint: "G" }));
        expect(reviewer).toHaveBeenCalledTimes(2);
        expect(again.results.every((r) => !r.cached)).toBe(true);
    });

    it("does not cache transport errors, so the next run retries them", async () => {
        const failing: Reviewer = async (_c, _cfg, onCall) => {
            onCall(call);
            throw new Error("Connection error.");
        };
        const first = await runEval(opts({ reviewer: failing }));
        expect(first.results.every((r) => r.error === "Connection error.")).toBe(true);
        expect(first.spentUsd).toBeCloseTo(0.5);
        const reviewer = vi.fn<Reviewer>(async (_c, _cfg, onCall) => {
            onCall(call);
            return review;
        });
        await runEval(opts({ reviewer }));
        expect(reviewer).toHaveBeenCalledTimes(2);
    });

    it("attributes cache hits to the requesting case, not the stored one", async () => {
        await runEval(opts());
        const again = await runEval(opts());
        expect(again.results.every((r) => r.cached)).toBe(true);
        expect(again.results.map((r) => r.caseId).sort()).toEqual(["a", "b"]);
    });

    it.each([Number.NaN, -1, Number.POSITIVE_INFINITY])(
        "rejects a bad estimate (%s) naming the case, before any call",
        async (bad) => {
            const reviewer = vi.fn<Reviewer>();
            await expect(runEval(opts({ reviewer, estimator: async () => bad }))).rejects.toThrow(
                /"a"|\ba\b/,
            );
            expect(reviewer).not.toHaveBeenCalled();
        },
    );

    it("serves a cached parse failure on rerun without calling the reviewer", async () => {
        const failing: Reviewer = async (_c, _cfg, onCall) => {
            onCall(call);
            throw new Error("Review parse failed (stop_reason: max_tokens)");
        };
        await runEval(opts({ reviewer: failing }));
        const reviewer = vi.fn<Reviewer>();
        const again = await runEval(opts({ reviewer }));
        expect(reviewer).not.toHaveBeenCalled();
        expect(again.results.every((r) => r.cached && r.error !== null)).toBe(true);
    });
});
