import type { EngineCall, Review } from "@rubric/core";
import type { EvalCase } from "./case.js";
import type { EvalConfig } from "./configs.js";
import { cacheKey, readCache, writeCache, type CachedResult } from "./cache.js";
import { callsCostUsd } from "./pricing.js";

export type Reviewer = (
    c: EvalCase,
    config: EvalConfig,
    onCall: (call: EngineCall) => void,
) => Promise<Review>;

/** Estimated USD for one (case, sample). */
export type Estimator = (c: EvalCase, config: EvalConfig) => Promise<number>;

export interface ResultLine extends CachedResult {
    cached: boolean;
    costUsd: number;
}

export interface RunOptions {
    cases: EvalCase[];
    config: EvalConfig;
    samples: number;
    maxUsd: number;
    concurrency: number;
    cacheDir: string;
    reviewer: Reviewer;
    estimator: Estimator;
    prompts: { review: string; infer: string };
    engineFingerprint: string;
    log?: (m: string) => void;
}

export interface RunOutcome {
    results: ResultLine[];
    estimatedUsd: number;
    spentUsd: number;
    stoppedForBudget: boolean;
}

export class BudgetExceededError extends Error {}

interface Job {
    c: EvalCase;
    sampleIndex: number;
    key: string;
    estimate: number;
}

export async function runEval(opts: RunOptions): Promise<RunOutcome> {
    // NaN would make every `> maxUsd` comparison false and disable the cap.
    if (!Number.isFinite(opts.maxUsd) || opts.maxUsd < 0) {
        throw new Error(`maxUsd must be a finite number >= 0, got ${opts.maxUsd}`);
    }
    const log = opts.log ?? ((m: string) => console.error(`[eval] ${m}`));
    const results: ResultLine[] = [];
    const pending: Job[] = [];

    for (const c of opts.cases) {
        for (let sampleIndex = 0; sampleIndex < opts.samples; sampleIndex++) {
            const key = cacheKey({
                input: c.input,
                config: opts.config,
                reviewSystemPrompt: opts.prompts.review,
                inferSystemPrompt: opts.prompts.infer,
                sampleIndex,
                engineFingerprint: opts.engineFingerprint,
            });
            const hit = await readCache(opts.cacheDir, key);
            if (hit) {
                // Identity comes from the job: the key ignores case id, so the stored one may be another case's.
                results.push({
                    ...hit,
                    caseId: c.id,
                    sampleIndex,
                    config: opts.config.name,
                    cached: true,
                    costUsd: 0,
                });
            } else {
                pending.push({ c, sampleIndex, key, estimate: 0 });
            }
        }
    }

    // Estimate per case once; samples of the same case cost the same.
    const perCase = new Map<string, number>();
    for (const job of pending) {
        if (!perCase.has(job.c.id)) {
            const est = await opts.estimator(job.c, opts.config);
            // NaN compares false against the cap, which would silently disable it.
            if (!Number.isFinite(est) || est < 0) {
                throw new Error(`estimator returned invalid cost ${est} for case "${job.c.id}"`);
            }
            perCase.set(job.c.id, est);
        }
        job.estimate = perCase.get(job.c.id)!;
    }
    const estimatedUsd = pending.reduce((sum, j) => sum + j.estimate, 0);
    log(
        `${results.length} cached, ${pending.length} to run, estimated $${estimatedUsd.toFixed(2)}`,
    );
    if (estimatedUsd > opts.maxUsd) {
        throw new BudgetExceededError(
            `estimated $${estimatedUsd.toFixed(2)} exceeds --max-usd ${opts.maxUsd}`,
        );
    }

    let spentUsd = 0;
    let committedUsd = 0; // estimates of jobs currently in flight
    let stoppedForBudget = false;
    const queue = [...pending];

    const worker = async (): Promise<void> => {
        for (;;) {
            const job = queue.shift();
            if (!job) return;
            // Estimates can be wrong; actual spend so far plus in-flight estimates is
            // the honest check before committing to another paid job.
            if (spentUsd + committedUsd + job.estimate > opts.maxUsd) {
                stoppedForBudget = true;
                queue.length = 0;
                return;
            }
            committedUsd += job.estimate;
            const calls: EngineCall[] = [];
            const started = Date.now();
            let review: Review | null = null;
            let error: string | null = null;
            try {
                review = await opts.reviewer(job.c, opts.config, (call) => calls.push(call));
            } catch (err) {
                error = err instanceof Error ? err.message : String(err);
            }
            committedUsd -= job.estimate;
            const cost = callsCostUsd(calls);
            spentUsd += cost;
            const result: CachedResult = {
                key: job.key,
                caseId: job.c.id,
                config: opts.config.name,
                sampleIndex: job.sampleIndex,
                review,
                calls,
                ms: Date.now() - started,
                error,
            };
            // A parse failure is a model outcome worth pinning; transport/API errors are
            // transient, so caching them would freeze an outage into every later run.
            if (!error || /parse failed/i.test(error)) await writeCache(opts.cacheDir, result);
            results.push({ ...result, cached: false, costUsd: cost });
            log(
                `${job.c.id}#${job.sampleIndex} ${error ? `ERROR ${error}` : review!.verdict} $${cost.toFixed(3)}`,
            );
        }
    };

    await Promise.all(Array.from({ length: Math.max(1, opts.concurrency) }, worker));
    if (stoppedForBudget) log(`stopped: spend cap $${opts.maxUsd} reached`);
    return { results, estimatedUsd, spentUsd, stoppedForBudget };
}
