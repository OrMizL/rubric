import type { PullRequestData } from "@rubric/core";
import { computeMeta, type EvalCase, type Label, type Mutation } from "../case.js";

/** Phrasings of "this changes nothing", each with keywords a faithful claim would contain. */
export const SCOPE_LIE_PHRASES: { text: string; keywords: string[] }[] = [
    {
        text: "No behavior change.",
        keywords: ["no behavior change", "behavior change", "behavioral change"],
    },
    {
        text: "Pure refactor, no functional changes.",
        keywords: ["refactor", "no functional change", "functional changes"],
    },
    {
        text: "This is a non-functional cleanup; runtime behavior is unchanged.",
        keywords: ["non functional", "behavior is unchanged", "runtime behavior", "cleanup"],
    },
];

function makeCase(
    sourceKey: string,
    caseId: string,
    mutation: Mutation,
    input: PullRequestData,
    label: Label,
): EvalCase {
    return {
        id: caseId,
        sourceId: sourceKey,
        mutation,
        input,
        label,
        meta: { repo: `${input.owner}/${input.repo}`, ...computeMeta(input) },
    };
}

export function control(id: string, source: PullRequestData): EvalCase {
    return makeCase(id, `${id}.control`, "control", source, { verdict: { not: ["misaligned"] } });
}

/**
 * Swap clears commits and labels (they describe the real change and would leak it).
 * This control clears them too, so swap-vs-control compares like with like and
 * losing the commits is never scored as a "catch".
 */
export function controlStripped(id: string, source: PullRequestData): EvalCase {
    return makeCase(
        id,
        `${id}.control_stripped`,
        "control_stripped",
        { ...source, commits: [], labels: [] },
        { verdict: { not: ["misaligned"] } },
    );
}

export function swap(id: string, source: PullRequestData, donor: PullRequestData): EvalCase {
    return makeCase(
        id,
        `${id}.swap`,
        "swap",
        {
            ...source,
            title: donor.title,
            body: donor.body,
            linkedIssue: donor.linkedIssue,
            commits: [],
            labels: [],
        },
        { verdict: { oneOf: ["misaligned"] } },
    );
}

export function scopeLie(id: string, source: PullRequestData, phraseIndex: number): EvalCase {
    const phrase = SCOPE_LIE_PHRASES[phraseIndex];
    if (!phrase) throw new Error(`no scope-lie phrase ${phraseIndex}`);
    return makeCase(
        id,
        `${id}.scope_lie.${phraseIndex}`,
        "scope_lie",
        { ...source, body: `${source.body.trimEnd()}\n\n${phrase.text}` },
        { verdict: {}, claims: [{ keywords: phrase.keywords, status: ["contradicted"] }] },
    );
}

/**
 * Deterministic donor: the next source (in list order, wrapping) from a different
 * repo. Cross-repo guarantees the borrowed description cannot accidentally fit.
 */
export function pickDonor(
    sourceKey: string,
    all: { key: string; pr: PullRequestData }[],
): PullRequestData | null {
    const i = all.findIndex((s) => s.key === sourceKey);
    if (i < 0) return null;
    const self = all[i]!.pr;
    for (let step = 1; step < all.length; step++) {
        const cand = all[(i + step) % all.length]!.pr;
        if (cand.owner !== self.owner || cand.repo !== self.repo) return cand;
    }
    return null;
}
