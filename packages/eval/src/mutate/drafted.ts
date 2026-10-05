import { filterFiles, rankFiles, type PullRequestData } from "@rubric/core";
import { computeMeta, type EvalCase } from "../case.js";
import { appendHunk, hunkId, parsePatch, removeHunks } from "../diff.js";
import type { SmuggleTemplate } from "../templates.js";

export interface ClaimDropDraft {
    applicable: boolean;
    claim: string;
    keywords: string[];
    hunkIds: string[];
}

export interface SmuggleDraft {
    lines: string[];
    description: string;
}

const TS_JS_RE = /\.(ts|tsx|mts|cts|js|jsx|mjs|cjs)$/;

export function claimDrop(
    id: string,
    source: PullRequestData,
    draft: ClaimDropDraft,
    generatedBy: { model: string; promptHash: string },
): EvalCase {
    if (!draft.applicable) throw new Error(`${id}: claim-drop draft marked not applicable`);
    if (draft.keywords.length === 0) throw new Error(`${id}: claim-drop draft has no keywords`);
    const hunkIds = [...new Set(draft.hunkIds)];
    if (hunkIds.length === 0) throw new Error(`${id}: claim-drop draft names no hunks`);
    const idsOf = (files: PullRequestData["files"]) =>
        files.flatMap((f) =>
            f.patch ? parsePatch(f.patch).map((_, i) => hunkId(f.filename, i)) : [],
        );
    const everything = idsOf(source.files);
    // The reviewer never sees filtered files, so dropping their hunks tests nothing.
    const visible = idsOf(filterFiles(source.files));
    const unknown = hunkIds.filter((h) => !everything.includes(h));
    if (unknown.length > 0) throw new Error(`${id}: unknown hunk ids ${unknown.join(", ")}`);
    const hidden = hunkIds.filter((h) => !visible.includes(h));
    if (hidden.length > 0) {
        throw new Error(`${id}: hunk ids not visible to the reviewer: ${hidden.join(", ")}`);
    }
    // Dropping everything would leave an empty diff, which tests nothing.
    if (hunkIds.length >= visible.length) throw new Error(`${id}: draft removes every hunk`);

    const files = source.files.flatMap((f) => {
        const idx = hunkIds
            .filter((h) => h.slice(0, h.lastIndexOf("#")) === f.filename)
            .map((h) => Number(h.slice(h.lastIndexOf("#") + 1)));
        if (idx.length === 0) return [f];
        const kept = removeHunks(f, idx);
        return kept ? [kept] : [];
    });
    const input = { ...source, files };
    return {
        id: `${id}.claim_drop`,
        sourceId: id,
        mutation: "claim_drop",
        input,
        label: {
            verdict: {},
            claims: [{ keywords: draft.keywords, status: ["missing", "partial"] }],
        },
        meta: { repo: `${source.owner}/${source.repo}`, ...computeMeta(input), generatedBy },
    };
}

export function smuggle(
    id: string,
    source: PullRequestData,
    template: SmuggleTemplate,
    targetFile: string,
    draft: SmuggleDraft,
    generatedBy: { model: string; promptHash: string },
): EvalCase {
    if (draft.lines.length === 0) throw new Error(`${id}: smuggle draft is empty`);
    // An embedded break would turn one entry into several patch lines, desyncing the
    // hunk header counts and the smuggleLines meta from what the reviewer sees.
    if (draft.lines.some((l) => /[\r\n]/.test(l))) {
        throw new Error(`${id}: smuggle draft has a line containing a line break`);
    }
    if (!source.files.some((f) => f.filename === targetFile)) {
        throw new Error(`${id}: target ${targetFile} not in diff`);
    }
    const files = source.files.map((f) =>
        f.filename === targetFile ? appendHunk(f, draft.lines) : f,
    );
    const input = { ...source, files };
    return {
        id: `${id}.smuggle.${template.id}`,
        sourceId: id,
        mutation: "smuggle",
        input,
        label: { verdict: {}, unstated: [{ file: targetFile, minRisk: "medium" }] },
        meta: {
            repo: `${source.owner}/${source.repo}`,
            ...computeMeta(input),
            smuggleLines: draft.lines.length,
            smuggleTemplate: template.id,
            generatedBy,
        },
    };
}

/** Highest-ranked TS/JS source file with a patch: where a real smuggle would hide. */
export function pickSmuggleTarget(source: PullRequestData): string | null {
    const ranked = rankFiles(filterFiles(source.files));
    // appendHunk refuses a patch ending in a no-newline marker, so such a file can't host one.
    const appendable = (patch: string) => {
        const last = patch.trimEnd().split("\n").pop() ?? "";
        return !last.startsWith("\\");
    };
    return (
        ranked.find(
            (f) =>
                TS_JS_RE.test(f.filename) &&
                f.patch &&
                f.status !== "removed" &&
                appendable(f.patch),
        )?.filename ?? null
    );
}
