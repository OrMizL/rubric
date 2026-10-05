import { z } from "zod";
import type { PullRequestData } from "@rubric/core";
import { countChanges, parsePatch } from "./diff.js";

export const VerdictSchema = z.enum(["aligned", "partially_aligned", "misaligned"]);
export type Verdict = z.infer<typeof VerdictSchema>;

export const MutationSchema = z.enum([
    "control",
    "control_stripped",
    "swap",
    "claim_drop",
    "smuggle",
    "scope_lie",
    "real",
]);
export type Mutation = z.infer<typeof MutationSchema>;

export const RiskSchema = z.enum(["low", "medium", "high"]);
export type Risk = z.infer<typeof RiskSchema>;

export const ClaimStatusSchema = z.enum(["implemented", "partial", "missing", "contradicted"]);
export type ClaimStatus = z.infer<typeof ClaimStatusSchema>;

// Core exposes PullRequestData only as a TS interface; cases are loaded from disk,
// so the shape is re-declared here to be validated at the boundary.
export const PullRequestDataSchema = z.object({
    owner: z.string(),
    repo: z.string(),
    number: z.number(),
    title: z.string(),
    body: z.string(),
    baseRef: z.string(),
    headRef: z.string(),
    headSha: z.string(),
    linkedIssue: z.object({ number: z.number(), title: z.string(), body: z.string() }).nullable(),
    labels: z.array(z.string()),
    commits: z.array(z.object({ sha: z.string(), message: z.string() })),
    files: z.array(
        z.object({
            filename: z.string(),
            status: z.string(),
            additions: z.number(),
            deletions: z.number(),
            patch: z.string().optional(),
        }),
    ),
}) satisfies z.ZodType<PullRequestData>;

export const LabelSchema = z.object({
    verdict: z.object({
        not: z.array(VerdictSchema).optional(),
        oneOf: z.array(VerdictSchema).optional(),
    }),
    claims: z
        .array(
            z.object({
                keywords: z.array(z.string()).min(1),
                status: z.array(ClaimStatusSchema).min(1),
            }),
        )
        .optional(),
    unstated: z.array(z.object({ file: z.string(), minRisk: RiskSchema })).optional(),
});
export type Label = z.infer<typeof LabelSchema>;

export const MetaSchema = z.object({
    repo: z.string(),
    diffLines: z.number(),
    fileCount: z.number(),
    smuggleLines: z.number().optional(),
    smuggleTemplate: z.string().optional(),
    reviewedBy: z.string().optional(),
    generatedBy: z.object({ model: z.string(), promptHash: z.string() }).optional(),
});
export type Meta = z.infer<typeof MetaSchema>;

export const CaseSchema = z.object({
    id: z.string(),
    sourceId: z.string(),
    mutation: MutationSchema,
    input: PullRequestDataSchema,
    label: LabelSchema,
    meta: MetaSchema,
});
export type EvalCase = z.infer<typeof CaseSchema>;

export function computeMeta(input: PullRequestData): { diffLines: number; fileCount: number } {
    return {
        diffLines: input.files.reduce((sum, f) => sum + f.additions + f.deletions, 0),
        fileCount: input.files.length,
    };
}

/**
 * Structural checks a schema cannot express. A case that fails these would make
 * the engine see a different diff than the counts claim — exactly the kind of
 * silent skew that makes an eval number meaningless.
 */
export function validateCase(c: EvalCase): string[] {
    const problems: string[] = [];
    for (const f of c.input.files) {
        if (f.patch === undefined) continue;
        try {
            parsePatch(f.patch);
        } catch {
            problems.push(`${c.id}: patch for ${f.filename} does not parse`);
            continue;
        }
        const counted = countChanges(f.patch);
        if (counted.additions !== f.additions) {
            problems.push(
                `${c.id}: ${f.filename} additions ${f.additions} != patch ${counted.additions}`,
            );
        }
        if (counted.deletions !== f.deletions) {
            problems.push(
                `${c.id}: ${f.filename} deletions ${f.deletions} != patch ${counted.deletions}`,
            );
        }
    }
    const filenames = new Set(c.input.files.map((f) => f.filename));
    for (const u of c.label.unstated ?? []) {
        if (!filenames.has(u.file)) problems.push(`${c.id}: unstated label ${u.file} not in diff`);
    }
    const { verdict, claims, unstated } = c.label;
    const anchors =
        (verdict.not?.length ?? 0) +
        (verdict.oneOf?.length ?? 0) +
        (claims?.length ?? 0) +
        (unstated?.length ?? 0);
    if (anchors === 0) problems.push(`${c.id}: label has no anchors`);
    return problems;
}
