import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { join } from "node:path";
import {
    DEFAULT_MAX_DIFF_TOKENS,
    DEFAULT_MAX_OUTPUT_TOKENS,
    type EngineCall,
    type PullRequestData,
    type Review,
} from "@rubric/core";
import type { EvalConfig } from "./configs.js";
import { readJson, writeJsonAtomic } from "./store.js";

export interface CachedResult {
    key: string;
    caseId: string;
    config: string;
    sampleIndex: number;
    review: Review | null;
    calls: EngineCall[];
    ms: number;
    error: string | null;
}

export function stableStringify(value: unknown): string {
    if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
    if (value && typeof value === "object") {
        const entries = Object.entries(value as Record<string, unknown>)
            .filter(([, v]) => v !== undefined)
            .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
        return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${stableStringify(v)}`).join(",")}}`;
    }
    return JSON.stringify(value);
}

/**
 * Hash of the built @rubric/core bundle. Any engine change must invalidate cached
 * outputs, and the prompts alone don't cover user-prompt assembly or the
 * filter/rank/budget logic.
 */
export async function engineFingerprint(): Promise<string> {
    const file = createRequire(import.meta.url).resolve("@rubric/core");
    return createHash("sha256")
        .update(await readFile(file))
        .digest("hex");
}

/**
 * The key covers the PR input, the resolved config (defaults filled in so an absent
 * budget and an explicit default are the same run), both system prompts, the engine
 * fingerprint, and sampleIndex. Editing prompts or engine code therefore invalidates
 * the cache by construction, so a stale output can never be scored as current.
 * sampleIndex makes repeat samples distinct calls while keeping reruns free.
 */
export function cacheKey(parts: {
    input: PullRequestData;
    config: EvalConfig;
    reviewSystemPrompt: string;
    inferSystemPrompt: string;
    engineFingerprint: string;
    sampleIndex: number;
}): string {
    const resolved = {
        ...parts,
        config: {
            ...parts.config,
            maxDiffTokens: parts.config.maxDiffTokens ?? DEFAULT_MAX_DIFF_TOKENS,
            maxOutputTokens: DEFAULT_MAX_OUTPUT_TOKENS,
        },
    };
    return createHash("sha256").update(stableStringify(resolved)).digest("hex");
}

function pathFor(cacheDir: string, key: string): string {
    return join(cacheDir, key.slice(0, 2), `${key}.json`);
}

export async function readCache(cacheDir: string, key: string): Promise<CachedResult | null> {
    try {
        return await readJson<CachedResult>(pathFor(cacheDir, key));
    } catch (err) {
        // Only a missing or unparseable file (hand-edited or truncated) is a miss;
        // permission or IO errors must surface rather than silently recompute.
        const code = (err as NodeJS.ErrnoException).code;
        if (code === "ENOENT" || err instanceof SyntaxError) return null;
        throw err;
    }
}

export async function writeCache(cacheDir: string, result: CachedResult): Promise<void> {
    await writeJsonAtomic(pathFor(cacheDir, result.key), result);
}
