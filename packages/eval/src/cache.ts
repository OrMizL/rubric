import { createHash } from "node:crypto";
import { join } from "node:path";
import type { EngineCall, PullRequestData, Review } from "@rubric/core";
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
 * Prompt text is part of the key, so editing prompt.ts or infer.ts invalidates the
 * cache by construction — a stale cached output can never be scored as current.
 * sampleIndex makes repeat samples distinct calls while keeping reruns free.
 */
export function cacheKey(parts: {
    input: PullRequestData;
    config: EvalConfig;
    reviewSystemPrompt: string;
    inferSystemPrompt: string;
    sampleIndex: number;
}): string {
    return createHash("sha256").update(stableStringify(parts)).digest("hex");
}

function pathFor(cacheDir: string, key: string): string {
    return join(cacheDir, key.slice(0, 2), `${key}.json`);
}

export async function readCache(cacheDir: string, key: string): Promise<CachedResult | null> {
    try {
        return await readJson<CachedResult>(pathFor(cacheDir, key));
    } catch {
        // Missing or unparseable (a crash before rename can't produce this, but a
        // hand-edited or truncated file can): either way, recompute.
        return null;
    }
}

export async function writeCache(cacheDir: string, result: CachedResult): Promise<void> {
    await writeJsonAtomic(pathFor(cacheDir, result.key), result);
}
