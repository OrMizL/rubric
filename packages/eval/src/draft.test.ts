import { describe, it, expect, vi, beforeEach } from "vitest";
import { mkdtemp, mkdir, readdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildClaimDropPrompt, buildSmugglePrompt, cachedDrafter, type Drafter } from "./draft.js";
import { SMUGGLE_TEMPLATES } from "./templates.js";
import { makeCase } from "./fixtures.js";

const pr = makeCase().input;

describe("prompts", () => {
    it("claim-drop prompt lists hunks by id with their bodies", () => {
        const { user } = buildClaimDropPrompt(pr);
        expect(user).toContain("src/a.ts#0");
        expect(user).toContain("+b");
        expect(user).toContain(pr.title);
    });

    it("smuggle prompt names the file, template, and size, and shows the file's patch", () => {
        const { user } = buildSmugglePrompt(pr, SMUGGLE_TEMPLATES[2]!, "src/a.ts", 10);
        expect(user).toContain("src/a.ts");
        expect(user).toContain(SMUGGLE_TEMPLATES[2]!.instruction);
        expect(user).toContain("10");
        expect(user).toContain("+b");
    });

    it("smuggle prompt numbers each hunk's lines so the model can pick an anchor", () => {
        const { user } = buildSmugglePrompt(pr, SMUGGLE_TEMPLATES[2]!, "src/a.ts", 10);
        expect(user).toContain("Hunk 0");
        expect(user).toMatch(/L1 \| \+b/);
        expect(user).toMatch(/inside existing code/i);
    });
});

it("claim-drop prompt omits files the reviewer never sees", () => {
    const withLock = {
        ...pr,
        files: [
            ...pr.files,
            {
                filename: "pnpm-lock.yaml",
                status: "modified" as const,
                additions: 1,
                deletions: 1,
                patch: "@@ -1 +1 @@\n-q\n+zzz",
            },
        ],
    };
    const { user } = buildClaimDropPrompt(withLock);
    expect(user).not.toContain("pnpm-lock.yaml");
    expect(user).not.toContain("+zzz");
});

function stubDrafter(): Drafter {
    return {
        claimDrop: vi.fn(async () => ({
            draft: { applicable: true, claim: "c", keywords: ["c"], hunkIds: ["src/a.ts#0"] },
            promptHash: "h",
        })),
        smuggle: vi.fn(async () => ({
            draft: { lines: ["x"], description: "d", hunk: 0, afterLine: 0 },
            promptHash: "h",
        })),
    };
}

describe("cachedDrafter", () => {
    let dir: string;
    beforeEach(async () => {
        dir = await mkdtemp(join(tmpdir(), "rubric-draft-"));
    });

    it("calls the inner drafter once per distinct request", async () => {
        const inner = stubDrafter();
        const d = cachedDrafter(inner, dir);
        await d.claimDrop(pr);
        await d.claimDrop(pr);
        await d.smuggle(pr, SMUGGLE_TEMPLATES[0]!, "src/a.ts", 3);
        await d.smuggle(pr, SMUGGLE_TEMPLATES[0]!, "src/a.ts", 3);
        await d.smuggle(pr, SMUGGLE_TEMPLATES[0]!, "src/a.ts", 10);
        expect(inner.claimDrop).toHaveBeenCalledTimes(1);
        expect(inner.smuggle).toHaveBeenCalledTimes(2);
    });

    it("keys on the real request: sources differing only in title are distinct", async () => {
        const inner = stubDrafter();
        const d = cachedDrafter(inner, dir);
        await d.claimDrop(pr);
        await d.claimDrop({ ...pr, title: "feat: something else" });
        await d.smuggle(pr, SMUGGLE_TEMPLATES[0]!, "src/a.ts", 3);
        await d.smuggle(
            { ...pr, title: "feat: something else" },
            SMUGGLE_TEMPLATES[0]!,
            "src/a.ts",
            3,
        );
        expect(inner.claimDrop).toHaveBeenCalledTimes(2);
        expect(inner.smuggle).toHaveBeenCalledTimes(2);
    });

    it("treats a truncated cache file as a miss and rewrites it", async () => {
        const inner = stubDrafter();
        await cachedDrafter(inner, dir).claimDrop(pr);
        const [name] = await readdir(dir);
        await writeFile(join(dir, name!), '{"draft": ');
        const d = cachedDrafter(inner, dir);
        await d.claimDrop(pr);
        await d.claimDrop(pr);
        expect(inner.claimDrop).toHaveBeenCalledTimes(2);
    });

    it("surfaces non-ENOENT read errors instead of silently regenerating", async () => {
        const inner = stubDrafter();
        await cachedDrafter(inner, dir).claimDrop(pr);
        const [name] = await readdir(dir);
        // A directory where the cache file should be reads as EISDIR.
        const dir2 = await mkdtemp(join(tmpdir(), "rubric-draft-"));
        await mkdir(join(dir2, name!));
        await expect(cachedDrafter(stubDrafter(), dir2).claimDrop(pr)).rejects.toThrow(/EISDIR/);
    });
});
