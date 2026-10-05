import { readdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { createInterface } from "node:readline/promises";
import { spawnSync } from "node:child_process";
import type { PullRequestData } from "@rubric/core";
import { CaseSchema, validateCase, type EvalCase } from "./case.js";
import { readJson, writeCase, writeJsonAtomic } from "./store.js";

export function formatDraft(c: EvalCase, source: PullRequestData): string {
    const before = new Map(source.files.map((f) => [f.filename, f.patch]));
    const changed = c.input.files.filter((f) => before.get(f.filename) !== f.patch);
    const removed = source.files.filter(
        (f) => !c.input.files.some((g) => g.filename === f.filename),
    );
    return [
        `=== ${c.id} (${c.mutation}) ===`,
        `label: ${JSON.stringify(c.label)}`,
        ...removed.map((f) => `--- file removed entirely: ${f.filename}`),
        ...changed.flatMap((f) => [
            `--- ${f.filename} (before)`,
            before.get(f.filename) ?? "(none)",
            `--- ${f.filename} (after)`,
            f.patch ?? "(none)",
        ]),
    ].join("\n");
}

/**
 * Only human-accepted drafts become cases. An LLM wrote these mutations; a person
 * confirming each one is what lets the label count as ground truth.
 */
export async function reviewDrafts(
    dataDir: string,
    reviewer: string,
): Promise<{ accepted: number; rejected: number }> {
    const draftsDir = join(dataDir, "drafts");
    const names = (await readdir(draftsDir).catch(() => [] as string[])).filter((n) =>
        n.endsWith(".json"),
    );
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    let accepted = 0;
    let rejected = 0;
    try {
        for (const name of names.sort()) {
            const path = join(draftsDir, name);
            const { case: raw, sourceId } = await readJson<{ case: EvalCase; sourceId: string }>(
                path,
            );
            const source = await readJson<PullRequestData>(
                join(dataDir, "sources", `${sourceId}.json`),
            );
            let c = CaseSchema.parse(raw);
            for (;;) {
                console.log("\n" + formatDraft(c, source));
                const problems = validateCase(c);
                if (problems.length > 0) console.log(`!! invalid: ${problems.join("; ")}`);
                const answer = (
                    await rl.question("[a]ccept / [r]eject / [e]dit / [s]kip / [q]uit: ")
                ).trim();
                if (answer === "a" && problems.length === 0) {
                    await writeCase(dataDir, { ...c, meta: { ...c.meta, reviewedBy: reviewer } });
                    await rm(path);
                    accepted++;
                    break;
                }
                if (answer === "r") {
                    await rm(path);
                    rejected++;
                    break;
                }
                if (answer === "e") {
                    await writeJsonAtomic(path, { case: c, sourceId });
                    spawnSync(process.env.EDITOR ?? "vi", [path], { stdio: "inherit" });
                    c = CaseSchema.parse((await readJson<{ case: EvalCase }>(path)).case);
                    continue;
                }
                if (answer === "s") break;
                if (answer === "q") return { accepted, rejected };
            }
        }
    } finally {
        rl.close();
    }
    return { accepted, rejected };
}
