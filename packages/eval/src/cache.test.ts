import { describe, it, expect, beforeEach } from "vitest";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { cacheKey, readCache, stableStringify, writeCache, type CachedResult } from "./cache.js";
import { CONFIGS } from "./configs.js";
import { makeCase } from "./fixtures.js";

const base = {
    input: makeCase().input,
    config: CONFIGS.default!,
    reviewSystemPrompt: "R",
    inferSystemPrompt: "I",
    sampleIndex: 0,
};

describe("stableStringify", () => {
    it("ignores key order", () => {
        expect(stableStringify({ b: 1, a: [{ d: 2, c: 3 }] })).toBe(
            stableStringify({ a: [{ c: 3, d: 2 }], b: 1 }),
        );
    });
});

describe("cacheKey", () => {
    it("is stable for identical parts", () => {
        expect(cacheKey(base)).toBe(cacheKey({ ...base }));
    });

    it.each([
        ["review prompt", { reviewSystemPrompt: "R2" }],
        ["infer prompt", { inferSystemPrompt: "I2" }],
        ["sample", { sampleIndex: 1 }],
        ["config", { config: CONFIGS["no-infer"]! }],
        ["input", { input: { ...base.input, title: "other" } }],
    ])("changes when the %s changes", (_name, over) => {
        expect(cacheKey({ ...base, ...over })).not.toBe(cacheKey(base));
    });
});

describe("readCache / writeCache", () => {
    let dir: string;
    beforeEach(async () => {
        dir = await mkdtemp(join(tmpdir(), "rubric-cache-"));
    });

    const result: CachedResult = {
        key: "ab".padEnd(64, "0"),
        caseId: "c",
        config: "default",
        sampleIndex: 0,
        review: null,
        calls: [],
        ms: 5,
        error: "parse_failed",
    };

    it("round-trips a result", async () => {
        await writeCache(dir, result);
        expect(await readCache(dir, result.key)).toEqual(result);
    });

    it("returns null on a miss", async () => {
        expect(await readCache(dir, "cd".padEnd(64, "0"))).toBeNull();
    });

    it("treats a corrupt file as a miss", async () => {
        const key = "ef".padEnd(64, "0");
        await mkdir(join(dir, "ef"), { recursive: true });
        await writeFile(join(dir, "ef", `${key}.json`), "{ half-writ");
        expect(await readCache(dir, key)).toBeNull();
    });
});
