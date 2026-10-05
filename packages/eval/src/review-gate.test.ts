import { describe, it, expect } from "vitest";
import { mkdtemp, readFile, readdir, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PassThrough } from "node:stream";
import { formatDraft, reviewDrafts } from "./review-gate.js";
import { makeCase } from "./fixtures.js";

describe("formatDraft", () => {
    it("shows id, mutation, label, and only the patches that changed", () => {
        const source = makeCase().input;
        source.files.push({
            filename: "src/untouched.ts",
            status: "modified",
            additions: 1,
            deletions: 0,
            patch: "@@ -1 +1,2 @@\n a\n+z",
        });
        const mutated = makeCase({
            id: "o__r__1.smuggle.telemetry-call",
            mutation: "smuggle",
            label: { verdict: {}, unstated: [{ file: "src/a.ts", minRisk: "medium" }] },
        });
        mutated.input.files = [
            {
                ...source.files[0]!,
                patch: source.files[0]!.patch + "\n@@ -1,0 +2 @@\n+send()",
                additions: 2,
            },
            source.files[1]!,
        ];
        const text = formatDraft(mutated, source);
        expect(text).toContain("o__r__1.smuggle.telemetry-call");
        expect(text).toContain("src/a.ts");
        expect(text).toContain("+send()");
        expect(text).not.toContain("src/untouched.ts");
        expect(text).toContain("minRisk");
    });
});

async function setup(drafts: Record<string, unknown>) {
    const dir = await mkdtemp(join(tmpdir(), "rubric-gate-"));
    await mkdir(join(dir, "sources"), { recursive: true });
    await mkdir(join(dir, "drafts"), { recursive: true });
    await writeFile(join(dir, "sources", "o__r__1.json"), JSON.stringify(makeCase().input));
    for (const [name, c] of Object.entries(drafts)) {
        await writeFile(
            join(dir, "drafts", `${name}.json`),
            JSON.stringify({ case: c, sourceId: "o__r__1" }),
        );
    }
    return dir;
}

async function review(dir: string, answers: string[] | null) {
    const input = new PassThrough();
    const output = new PassThrough();
    output.resume();
    if (answers) input.end(answers.map((a) => a + "\n").join(""));
    else input.end();
    return reviewDrafts(dir, "tester", { input, output });
}

const valid = (id: string) => makeCase({ id, mutation: "claim_drop" });
const names = (dir: string, sub: string) => readdir(join(dir, sub)).catch(() => []);

describe("reviewDrafts", () => {
    it("accept writes the case with reviewedBy and removes the draft", async () => {
        const dir = await setup({ "o__r__1.control": valid("o__r__1.control") });
        expect(await review(dir, ["a"])).toEqual({ accepted: 1, rejected: 0 });
        const written = JSON.parse(
            await readFile(join(dir, "cases", "o__r__1.control.json"), "utf8"),
        );
        expect(written.meta.reviewedBy).toBe("tester");
        expect(await names(dir, "drafts")).toEqual([]);
    });

    it("accepting an invalid draft writes nothing", async () => {
        const bad = valid("x");
        bad.meta = { ...bad.meta, diffLines: 999 };
        const dir = await setup({ x: bad });
        expect(await review(dir, ["a", "s"])).toEqual({ accepted: 0, rejected: 0 });
        expect(await names(dir, "cases")).toEqual([]);
        expect(await names(dir, "drafts")).toEqual(["x.json"]);
    });

    it("reject removes the draft; skip leaves it", async () => {
        const dir = await setup({ a: valid("a"), b: valid("b") });
        expect(await review(dir, ["r", "s"])).toEqual({ accepted: 0, rejected: 1 });
        expect(await names(dir, "drafts")).toEqual(["b.json"]);
    });

    it("a malformed draft offers skip instead of aborting", async () => {
        const dir = await setup({ a: { nonsense: true }, b: valid("b") });
        expect(await review(dir, ["a", "s", "a"])).toEqual({ accepted: 1, rejected: 0 });
        expect(await names(dir, "drafts")).toEqual(["a.json"]);
    });

    it("EOF mid-session returns counts without hanging", async () => {
        const dir = await setup({ a: valid("a"), b: valid("b") });
        expect(await review(dir, ["a"])).toEqual({ accepted: 1, rejected: 0 });
        expect(await review(dir, null)).toEqual({ accepted: 0, rejected: 0 });
    });
});
