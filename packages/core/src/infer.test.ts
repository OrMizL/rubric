import { describe, it, expect } from "vitest";
import { buildInferSystemPrompt, buildInferUserPrompt } from "./infer.js";
import type { ReviewContext } from "./context.js";

const ctx: ReviewContext = {
    title: "fix: prevent double-click on submit button",
    body: "Users could submit twice.",
    linkedIssue: { number: 42, title: "Double submissions", body: "Reported by support." },
    labels: ["bug"],
    commits: [{ sha: "abc1234", message: "disable submit while the request is in flight" }],
    fileSummary: [
        { filename: "src/submit.tsx", status: "modified", additions: 12, deletions: 3 },
        { filename: "src/submit.test.tsx", status: "added", additions: 40, deletions: 0 },
    ],
};

describe("buildInferUserPrompt", () => {
    it("includes intent, issue, commits, labels, and file shapes", () => {
        const prompt = buildInferUserPrompt(ctx);
        expect(prompt).toContain("fix: prevent double-click on submit button");
        expect(prompt).toContain("#42");
        expect(prompt).toContain("disable submit while the request is in flight");
        expect(prompt).toContain("bug");
        expect(prompt).toContain("src/submit.tsx");
        expect(prompt).toContain("+12/-3");
    });

    it("carries no patch text — diff blindness is the point", () => {
        const prompt = buildInferUserPrompt(ctx);
        expect(prompt).not.toContain("@@");
        expect(prompt).not.toContain("<diff>");
    });

    it("handles an empty description and no linked issue", () => {
        const thin = { ...ctx, body: "  ", linkedIssue: null, labels: [], commits: [] };
        const prompt = buildInferUserPrompt(thin);
        expect(prompt).toContain("(no description provided)");
        expect(prompt).not.toContain("Linked issue");
    });
});

describe("buildInferSystemPrompt", () => {
    it("tells the model it cannot see the code", () => {
        const system = buildInferSystemPrompt();
        expect(system.toLowerCase()).toContain("you will not see the code");
    });
});
