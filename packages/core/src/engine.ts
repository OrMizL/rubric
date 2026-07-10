import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { ReviewSchema, type Review } from "./schema.js";
import { buildSystemPrompt, buildUserPrompt } from "./prompt.js";
import { filterFiles, rankFiles, truncateToBudget } from "./budget.js";
import type { ChangedFile, LinkedIssue } from "./types.js";

export const DEFAULT_MODEL = "claude-opus-4-8";
export const DEFAULT_MAX_DIFF_TOKENS = 50_000;
export const DEFAULT_MAX_OUTPUT_TOKENS = 16_000;

export interface EngineOptions {
    anthropicApiKey: string;
    /** Claude model id. Default: claude-opus-4-8. */
    model?: string;
    /** Input-token budget for the assembled diff. Default: 50000. */
    maxDiffTokens?: number;
    /** Max output tokens for the review. Default: 16000. */
    maxOutputTokens?: number;
    /** Log sink; defaults to stderr. */
    logger?: (message: string) => void;
}

/** The intent + diff the engine reviews (owner/repo/sha live in PullRequestData). */
export interface ReviewInput {
    title: string;
    body: string;
    linkedIssue: LinkedIssue | null;
    files: ChangedFile[];
}

/**
 * Review a PR in one structured-output call: filter and rank the diff, budget it
 * with real Claude token counts, assemble the prompt, then parse the response
 * against ReviewSchema. `truncated` is set deterministically from the budgeter,
 * not trusted from the model.
 */
export async function reviewPullRequest(input: ReviewInput, opts: EngineOptions): Promise<Review> {
    const model = opts.model ?? DEFAULT_MODEL;
    const maxDiffTokens = opts.maxDiffTokens ?? DEFAULT_MAX_DIFF_TOKENS;
    const log = opts.logger ?? ((m: string) => console.error(`[rubric] ${m}`));

    const client = new Anthropic({ apiKey: opts.anthropicApiKey });
    const system = buildSystemPrompt();

    // countTokens is free and uses Claude's real tokenizer — no estimates.
    const countTokens = async (text: string): Promise<number> => {
        const { input_tokens } = await client.messages.countTokens({
            model,
            messages: [{ role: "user", content: text }],
        });
        return input_tokens;
    };

    const ranked = rankFiles(filterFiles(input.files));
    const budget = await truncateToBudget(ranked, maxDiffTokens, countTokens);
    if (budget.truncated) {
        log(
            `diff truncated: kept ${budget.files.length} file(s), omitted ${budget.omitted.length}`,
        );
    }

    const user = buildUserPrompt({
        title: input.title,
        body: input.body,
        linkedIssue: input.linkedIssue,
        diffText: budget.diffText,
        truncated: budget.truncated,
    });

    const { input_tokens } = await client.messages.countTokens({
        model,
        system,
        messages: [{ role: "user", content: user }],
    });
    log(`assembled prompt: ${input_tokens} input tokens (diff budget ${maxDiffTokens})`);

    const response = await client.messages.parse({
        model,
        max_tokens: opts.maxOutputTokens ?? DEFAULT_MAX_OUTPUT_TOKENS,
        thinking: { type: "adaptive" },
        system,
        messages: [{ role: "user", content: user }],
        output_config: { format: zodOutputFormat(ReviewSchema) },
    });

    if (!response.parsed_output) {
        throw new Error(`Review parse failed (stop_reason: ${response.stop_reason})`);
    }

    return { ...response.parsed_output, truncated: budget.truncated };
}
