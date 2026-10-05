import { describe, it, expect, beforeEach } from "vitest";
import { mkdtemp, writeFile, mkdir, rename } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { listCaseIds, loadSplitCases, readCase, writeCase } from "./store.js";
import { makeCase } from "./fixtures.js";

let dir: string;
beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "rubric-eval-"));
});

describe("store", () => {
    it("writes and reads a case by id", async () => {
        await writeCase(dir, makeCase());
        expect((await readCase(dir, "o__r__1.control")).sourceId).toBe("o__r__1");
        expect(await listCaseIds(dir)).toEqual(["o__r__1.control"]);
    });

    it("loads the cases a split names", async () => {
        await writeCase(dir, makeCase());
        await writeFile(
            join(dir, "splits.json"),
            JSON.stringify({ dev: ["o__r__1.control"], full: ["o__r__1.control"] }),
        );
        expect(await loadSplitCases(dir, "dev")).toHaveLength(1);
    });

    it("fails loudly when a split names a missing case", async () => {
        await mkdir(join(dir, "cases"), { recursive: true });
        await writeFile(join(dir, "splits.json"), JSON.stringify({ dev: ["ghost"], full: [] }));
        await expect(loadSplitCases(dir, "dev")).rejects.toThrow(/ghost/);
    });

    it("fails loudly when a loaded case is invalid", async () => {
        const bad = makeCase();
        bad.input.files[0]!.additions = 9;
        await writeCase(dir, bad);
        await writeFile(
            join(dir, "splits.json"),
            JSON.stringify({ dev: ["o__r__1.control"], full: [] }),
        );
        await expect(loadSplitCases(dir, "dev")).rejects.toThrow(/additions/);
    });

    it("rejects a case file whose id differs from the requested id", async () => {
        await writeCase(dir, makeCase({ id: "other" }));
        await rename(join(dir, "cases", "other.json"), join(dir, "cases", "wanted.json"));
        await expect(readCase(dir, "wanted")).rejects.toThrow(/wanted.*other|other.*wanted/);
    });
});
