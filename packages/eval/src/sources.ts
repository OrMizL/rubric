import type { PullRequestData } from "@rubric/core";

export interface SourceRef {
    owner: string;
    repo: string;
    number: number;
}

const REF_RE = /^([\w.-]+)\/([\w.-]+)#(\d+)$/;
const TS_JS_RE = /\.(ts|tsx|mts|cts|js|jsx|mjs|cjs)$/;

export function parseSourceList(text: string): SourceRef[] {
    const refs: SourceRef[] = [];
    text.split("\n").forEach((raw, i) => {
        const line = raw.trim();
        if (line === "" || line.startsWith("#")) return;
        const m = REF_RE.exec(line);
        if (!m)
            throw new Error(`sources.txt line ${i + 1}: expected owner/repo#123, got "${line}"`);
        refs.push({ owner: m[1]!, repo: m[2]!, number: Number(m[3]) });
    });
    return refs;
}

export function sourceId(ref: SourceRef): string {
    return `${ref.owner}__${ref.repo}__${ref.number}`;
}

/**
 * A source must be an honest, reviewable baseline: merged (the maintainers accepted
 * it), described (controls need real stated intent), mostly TS/JS (Rubric's target),
 * a size a reviewer could hold, and with every patch present (a missing patch would
 * hide part of the change from the engine and from the mutators).
 */
export function checkSource(pr: PullRequestData, merged: boolean): string[] {
    const reasons: string[] = [];
    if (!merged) reasons.push("not merged");
    if (pr.body.trim().length < 20) reasons.push("description shorter than one sentence");
    if (pr.files.length < 2 || pr.files.length > 30) {
        reasons.push(`${pr.files.length} files, need 2–30`);
    }
    const total = pr.files.reduce((s, f) => s + f.additions + f.deletions, 0);
    const tsjs = pr.files
        .filter((f) => TS_JS_RE.test(f.filename))
        .reduce((s, f) => s + f.additions + f.deletions, 0);
    if (total === 0 || tsjs / total < 0.5)
        reasons.push("TS/JS is not the majority of changed lines");
    const omitted = pr.files.filter((f) => f.patch === undefined).map((f) => f.filename);
    if (omitted.length > 0) reasons.push(`patch omitted by GitHub: ${omitted.join(", ")}`);
    return reasons;
}
