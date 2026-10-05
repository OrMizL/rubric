import Anthropic from "@anthropic-ai/sdk";
import {
    DEFAULT_MAX_DIFF_TOKENS,
    buildInferSystemPrompt,
    buildInferUserPrompt,
    buildSystemPrompt,
    buildUserPrompt,
    filterFiles,
    gatherContext,
    rankFiles,
    renderFilePatch,
    reviewPullRequest,
} from "@rubric/core";
import { costUsd } from "./pricing.js";
import type { Estimator, Reviewer } from "./run.js";

export function realReviewer(apiKey: string): Reviewer {
    return (c, config, onCall) =>
        reviewPullRequest(gatherContext(c.input), c.input.files, {
            anthropicApiKey: apiKey,
            model: config.model,
            infer: config.infer,
            maxDiffTokens: config.maxDiffTokens,
            logger: () => {},
            onCall,
        });
}

/**
 * Input is counted for real (countTokens is free); output is an assumption, because
 * the worst case (max_tokens on every call) would make every cap fail. The diff is
 * capped at the config's budget since the engine never sends more than that.
 */
export function realEstimator(apiKey: string, assumeOutputTokens: number): Estimator {
    const client = new Anthropic({ apiKey });
    return async (c, config) => {
        const ctx = gatherContext(c.input);
        const diffText = rankFiles(filterFiles(c.input.files)).map(renderFilePatch).join("\n\n");
        const user = buildUserPrompt({
            title: ctx.title,
            body: ctx.body,
            linkedIssue: ctx.linkedIssue,
            diffText,
            truncated: false,
            impliedSpec: null,
        });
        const { input_tokens: reviewIn } = await client.messages.countTokens({
            model: config.model,
            system: buildSystemPrompt(),
            messages: [{ role: "user", content: user }],
        });
        const diffBudget = config.maxDiffTokens ?? DEFAULT_MAX_DIFF_TOKENS;
        const systemTokens = 4_000; // generous allowance for system prompt + spec section
        let input = Math.min(reviewIn, diffBudget + systemTokens);
        if (config.infer) {
            const { input_tokens: inferIn } = await client.messages.countTokens({
                model: config.model,
                system: buildInferSystemPrompt(),
                messages: [{ role: "user", content: buildInferUserPrompt(ctx) }],
            });
            input += inferIn;
        }
        return costUsd(config.model, { input_tokens: input, output_tokens: assumeOutputTokens });
    };
}
