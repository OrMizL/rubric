import { access, readdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { createInterface } from "node:readline";
import type { Readable, Writable } from "node:stream";
import { spawnSync } from "node:child_process";
import type { PullRequestData } from "@rubric/core";
import { CaseSchema, validateCase, type EvalCase } from "./case.js";
import { casesDir, readJson, writeCase, writeJsonAtomic } from "./store.js";

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

export interface ReviewIo {
    input: Readable;
    output: Writable;
    /** Opens the draft file for hand-editing; blocks until done. */
    edit?: (path: string) => void;
}

const message = (err: unknown) => (err instanceof Error ? err.message : String(err));

/**
 * Only human-accepted drafts become cases. An LLM wrote these mutations; a person
 * confirming each one is what lets the label count as ground truth.
 */
export async function reviewDrafts(
    dataDir: string,
    reviewer: string,
    io: ReviewIo = { input: process.stdin, output: process.stdout },
): Promise<{ accepted: number; rejected: number }> {
    const edit =
        io.edit ??
        ((path: string) => {
            spawnSync(process.env.EDITOR ?? "vi", [path], { stdio: "inherit" });
        });
    const say = (text: string) => io.output.write(text + "\n");
    const draftsDir = join(dataDir, "drafts");
    const names = (await readdir(draftsDir).catch(() => [] as string[])).filter((n) =>
        n.endsWith(".json"),
    );
    const rl = createInterface({ input: io.input, output: io.output });
    // The async iterator ends on close, so EOF reads as null instead of a question that never resolves.
    const lines = rl[Symbol.asyncIterator]();
    const ask = async (prompt: string): Promise<string | null> => {
        io.output.write(prompt);
        const next = await lines.next();
        return next.done ? null : next.value.trim();
    };
    let accepted = 0;
    let rejected = 0;
    try {
        for (const name of names.sort()) {
            const path = join(draftsDir, name);
            const st: { c: EvalCase | null; source: PullRequestData | null } = {
                c: null,
                source: null,
            };
            let sourceId = "";
            let loadError = "";
            // A hand-edited draft can be malformed; that must not abort the whole session.
            const load = async () => {
                try {
                    const raw = await readJson<{ case: unknown; sourceId: string }>(path);
                    sourceId = raw.sourceId;
                    st.c = CaseSchema.parse(raw.case);
                    st.source = await readJson<PullRequestData>(
                        join(dataDir, "sources", `${sourceId}.json`),
                    );
                    loadError = "";
                } catch (err) {
                    st.c = null;
                    loadError = message(err);
                }
            };
            await load();
            for (;;) {
                const { c: current, source } = st;
                let problems: string[] = [];
                if (current && source) {
                    say("\n" + formatDraft(current, source));
                    problems = validateCase(current);
                    if (problems.length > 0) say(`!! invalid: ${problems.join("; ")}`);
                } else {
                    say(`\n!! cannot load ${name}: ${loadError}`);
                }
                const answer = await ask(
                    current
                        ? "[a]ccept / [r]eject / [e]dit / [s]kip / [q]uit: "
                        : "[e]dit / [s]kip / [q]uit: ",
                );
                if (answer === null || answer === "q") return { accepted, rejected };
                if (current && answer === "a" && problems.length === 0) {
                    // A case id is a frozen label: overwriting one would rewrite past runs' ground truth.
                    const exists = await access(join(casesDir(dataDir), `${current.id}.json`)).then(
                        () => true,
                        () => false,
                    );
                    if (exists) {
                        say(`!! case ${current.id} already exists, not overwriting; draft kept`);
                        break;
                    }
                    await writeCase(dataDir, {
                        ...current,
                        meta: { ...current.meta, reviewedBy: reviewer },
                    });
                    await rm(path);
                    accepted++;
                    break;
                }
                if (current && answer === "r") {
                    await rm(path);
                    rejected++;
                    break;
                }
                if (answer === "e") {
                    if (current) await writeJsonAtomic(path, { case: current, sourceId });
                    edit(path);
                    await load();
                    continue;
                }
                if (answer === "s") break;
            }
        }
    } finally {
        rl.close();
    }
    return { accepted, rejected };
}
