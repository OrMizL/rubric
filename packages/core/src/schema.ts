import { z } from "zod";

/** A single discrete, checkable claim extracted from the PR's stated intent. */
export const ClaimSchema = z.object({
    id: z.string(),
    text: z.string().describe("The claim as stated or implied by the PR description"),
    status: z.enum(["implemented", "partial", "missing", "contradicted"]),
    evidence: z.array(
        z.object({
            file: z.string(),
            lines: z.string().describe("e.g. '42-58', or 'whole file'"),
        }),
    ),
    explanation: z.string(),
});
export type Claim = z.infer<typeof ClaimSchema>;

/** A change present in the diff that no stated claim accounts for. */
export const UnstatedChangeSchema = z.object({
    file: z.string(),
    description: z.string(),
    risk: z.enum(["low", "medium", "high"]),
});
export type UnstatedChange = z.infer<typeof UnstatedChangeSchema>;

/** The full structured review returned by the engine. */
export const ReviewSchema = z.object({
    verdict: z.enum(["aligned", "partially_aligned", "misaligned"]),
    summary: z.string().describe("2-3 sentence overall assessment"),
    claims: z.array(ClaimSchema),
    unstatedChanges: z.array(UnstatedChangeSchema),
    truncated: z.boolean().describe("true if the diff was truncated to fit budget"),
});
export type Review = z.infer<typeof ReviewSchema>;
