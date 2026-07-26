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

/** An expected behavior the model derived from context, then graded. */
export const InferredClaimSchema = ClaimSchema.extend({
    confidence: z
        .enum(["high", "medium", "low"])
        .describe("How directly the PR context supports this expectation"),
    kind: z.enum(["behavior", "edge_case", "acceptance"]),
});
export type InferredClaim = z.infer<typeof InferredClaimSchema>;

/** One mechanical signal and what it contributed to the score. */
export const SignalComponentSchema = z.object({
    key: z.enum(["description", "linkedIssue", "commits", "tests", "focus"]),
    label: z.string(),
    earned: z.number(),
    max: z.number(),
    note: z.string(),
});

export const SignalScoreSchema = z.object({
    total: z.number(),
    band: z.enum(["high", "medium", "low"]),
    components: z.array(SignalComponentSchema),
});

/** Whether the inference stage ran, and why not when it didn't. */
export const InferenceStatusSchema = z.object({
    ran: z.boolean(),
    reason: z.string().optional(),
});
export type InferenceStatus = z.infer<typeof InferenceStatusSchema>;

/**
 * The half of the review the model produces. Kept separate from ReviewSchema so
 * the model is never asked for facts the code already knows — asking it for
 * `truncated` or a signal breakdown invites it to invent them.
 */
export const ReviewOutputSchema = z.object({
    verdict: z.enum(["aligned", "partially_aligned", "misaligned"]),
    summary: z.string().describe("2-3 sentence overall assessment"),
    statedClaims: z.array(ClaimSchema).describe("Claims the PR description makes explicitly"),
    inferredClaims: z
        .array(InferredClaimSchema)
        .describe("Expected behaviors derived from context, graded against the diff"),
    unstatedChanges: z.array(UnstatedChangeSchema),
});
export type ReviewOutput = z.infer<typeof ReviewOutputSchema>;

/** The full review: the model's judgment plus the facts the code owns. */
export const ReviewSchema = ReviewOutputSchema.extend({
    truncated: z.boolean().describe("true if the diff was truncated to fit budget"),
    signalScore: SignalScoreSchema,
    inference: InferenceStatusSchema,
});
export type Review = z.infer<typeof ReviewSchema>;
