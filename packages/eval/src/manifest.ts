import { createHash } from "node:crypto";
import type { EvalCase } from "./case.js";
import { stableStringify } from "./cache.js";
import type { Manifest } from "./report.js";

/** Covers exactly what scoring depends on: the PR the engine sees and the label it is scored against. */
export function caseHash(c: Pick<EvalCase, "input" | "label">): string {
    return createHash("sha256")
        .update(stableStringify({ input: c.input, label: c.label }))
        .digest("hex");
}

export function hashCases(cases: EvalCase[]): Record<string, string> {
    return Object.fromEntries(cases.map((c) => [c.id, caseHash(c)]));
}

/**
 * Ids whose case is missing from `cases` or differs from the run-time hash. A report
 * re-reads cases from disk, so without this an edited case would silently rescore old results.
 */
export function checkCaseHashes(
    manifest: Pick<Manifest, "caseIds" | "caseHashes">,
    cases: EvalCase[],
): string[] {
    const current = hashCases(cases);
    return manifest.caseIds.filter((id) => current[id] !== manifest.caseHashes[id]);
}

export function validateManifest(raw: unknown, path: string): Manifest {
    const m = raw as Partial<Manifest> | null;
    const missing = (
        [
            "runId",
            "split",
            "config",
            "samples",
            "caseIds",
            "caseHashes",
            "spentUsd",
            "estimatedUsd",
        ] as const
    ).filter((k) => !m || typeof m !== "object" || m[k] === undefined);
    if (missing.length > 0) {
        throw new Error(
            `manifest ${path} is missing ${missing.join(", ")} (run predates this version? re-run it)`,
        );
    }
    return m as Manifest;
}
