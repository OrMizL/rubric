import type Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { z } from "zod";
import type { ReviewContext } from "./context.js";

/** One expected behavior derived from PR context, before any code is seen. */
export const SpecItemSchema = z.object({
    text: z.string().describe("A single expected behavior, stated concretely"),
    kind: z.enum(["behavior", "edge_case", "acceptance"]),
    confidence: z
        .enum(["high", "medium", "low"])
        .describe("How directly the PR context supports this expectation"),
});
export type SpecItem = z.infer<typeof SpecItemSchema>;

export const ImpliedSpecSchema = z.object({
    items: z.array(SpecItemSchema),
});
export type ImpliedSpec = z.infer<typeof ImpliedSpecSchema>;

export interface InferOptions {
    client: Anthropic;
    model: string;
    maxOutputTokens?: number;
}

export const DEFAULT_INFER_MAX_OUTPUT_TOKENS = 4_000;

const INFER_SYSTEM_PROMPT = `You are Rubric's spec-inference stage. Given only a pull request's stated intent and the shape of its changes, describe what the finished change should do.

You will not see the code. You are given file names, statuses, and line counts, but never the diff itself. Do not speculate about how something is implemented — describe only observable expected behavior. If the context does not support a claim, either omit it or mark it low confidence.

Produce a flat list of items across three kinds:
- behavior: the happy path. What should be true once this change works.
- edge_case: what should happen in unusual or failure situations the intent implies.
- acceptance: how a reviewer could verify the change is complete.

Rate each item's confidence by how directly the context supports it:
- high: stated outright in the title, description, or linked issue.
- medium: a normal, near-certain consequence of what was stated.
- low: a reasonable expectation that the context only hints at.

Derive consequences the author did not write down — that is the entire value here. "Prevent double-click on submit" implies the control becomes disabled, in-flight state is visible, and repeat submissions cannot fire. But stay proportionate to the change's stated scope: a one-line fix does not imply a redesign.`;

export function buildInferSystemPrompt(): string {
    return INFER_SYSTEM_PROMPT;
}

export function buildInferUserPrompt(ctx: ReviewContext): string {
    const sections: string[] = [];

    const intent = [
        `# PR intent`,
        ``,
        `Title: ${ctx.title}`,
        ``,
        `Description:`,
        ctx.body.trim() || "(no description provided)",
    ];
    if (ctx.labels.length > 0) intent.push(``, `Labels: ${ctx.labels.join(", ")}`);
    if (ctx.linkedIssue) {
        intent.push(
            ``,
            `Linked issue #${ctx.linkedIssue.number}: ${ctx.linkedIssue.title}`,
            ctx.linkedIssue.body.trim() || "(no issue body)",
        );
    }
    sections.push(intent.join("\n"));

    if (ctx.commits.length > 0) {
        const lines = ctx.commits.map((c) => `- ${c.message.split("\n", 1)[0]}`);
        sections.push([`# Commit messages`, ...lines].join("\n"));
    }

    // Shapes only — filenames and line counts, never patch bodies.
    const files = ctx.fileSummary.map(
        (f) => `- ${f.filename} (${f.status}, +${f.additions}/-${f.deletions})`,
    );
    sections.push(
        [
            `# Files changed (shape only, no contents)`,
            ...(files.length > 0 ? files : ["(no files changed)"]),
        ].join("\n"),
    );

    sections.push(`Infer the implied specification for this pull request.`);
    return sections.join("\n\n");
}

/** Run the diff-blind inference call. Throws on parse failure; the engine degrades. */
export async function inferSpec(ctx: ReviewContext, opts: InferOptions): Promise<ImpliedSpec> {
    const response = await opts.client.messages.parse({
        model: opts.model,
        max_tokens: opts.maxOutputTokens ?? DEFAULT_INFER_MAX_OUTPUT_TOKENS,
        thinking: { type: "adaptive" },
        system: buildInferSystemPrompt(),
        messages: [{ role: "user", content: buildInferUserPrompt(ctx) }],
        output_config: { format: zodOutputFormat(ImpliedSpecSchema) },
    });

    if (!response.parsed_output) {
        throw new Error(`Spec inference parse failed (stop_reason: ${response.stop_reason})`);
    }
    return response.parsed_output;
}
