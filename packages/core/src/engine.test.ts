import { describe, it, expect, vi } from "vitest";
import type { EngineCall } from "./infer.js";

// The engine constructs its own client, so the SDK module is replaced wholesale.
// zodOutputFormat lives in a separate helper module and stays real.
const { parse } = vi.hoisted(() => ({ parse: vi.fn() }));
vi.mock("@anthropic-ai/sdk", () => ({
    default: class {
        messages = {
            countTokens: async () => ({ input_tokens: 10 }),
            parse,
        };
    },
}));

const { reviewPullRequest } = await import("./engine.js");

const context = {
    title: "fix: thing",
    body: "Fixes the thing.",
    linkedIssue: null,
    labels: [],
    commits: [],
    fileSummary: [{ filename: "src/a.ts", status: "modified", additions: 1, deletions: 0 }],
};
const files = [
    {
        filename: "src/a.ts",
        status: "modified",
        additions: 1,
        deletions: 0,
        patch: "@@ -1 +1 @@\n+x",
    },
];
const reviewOutput = {
    verdict: "aligned",
    summary: "ok",
    statedClaims: [],
    inferredClaims: [],
    unstatedChanges: [],
};

describe("reviewPullRequest onCall", () => {
    it("reports both the infer and the review call", async () => {
        parse.mockReset();
        parse
            .mockResolvedValueOnce({
                parsed_output: { items: [] },
                stop_reason: "end_turn",
                usage: { input_tokens: 100, output_tokens: 20 },
            })
            .mockResolvedValueOnce({
                parsed_output: reviewOutput,
                stop_reason: "end_turn",
                usage: { input_tokens: 900, output_tokens: 300 },
            });
        const calls: EngineCall[] = [];
        await reviewPullRequest(context, files, {
            anthropicApiKey: "k",
            model: "claude-test",
            logger: () => {},
            onCall: (c) => calls.push(c),
        });
        expect(calls.map((c) => c.stage).sort()).toEqual(["infer", "review"]);
        const review = calls.find((c) => c.stage === "review")!;
        expect(review.usage.output_tokens).toBe(300);
        expect(review.model).toBe("claude-test");
    });

    it("reports only the review call when inference is disabled", async () => {
        parse.mockReset();
        parse.mockResolvedValueOnce({
            parsed_output: reviewOutput,
            stop_reason: "end_turn",
            usage: { input_tokens: 900, output_tokens: 300 },
        });
        const calls: EngineCall[] = [];
        await reviewPullRequest(context, files, {
            anthropicApiKey: "k",
            infer: false,
            logger: () => {},
            onCall: (c) => calls.push(c),
        });
        expect(calls.map((c) => c.stage)).toEqual(["review"]);
    });

    it("retries the review once when the structured output fails to parse", async () => {
        parse.mockReset();
        parse
            .mockRejectedValueOnce(new Error("Failed to parse structured output: bad enum"))
            .mockResolvedValueOnce({
                parsed_output: reviewOutput,
                stop_reason: "end_turn",
                usage: { input_tokens: 900, output_tokens: 300 },
            });
        const review = await reviewPullRequest(context, files, {
            anthropicApiKey: "k",
            infer: false,
            logger: () => {},
        });
        expect(review.verdict).toBe("aligned");
        expect(parse).toHaveBeenCalledTimes(2);
    });
});
