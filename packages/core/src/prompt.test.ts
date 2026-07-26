import { describe, it, expect } from "vitest";
import { buildSystemPrompt, buildUserPrompt } from "./prompt.js";
import type { PromptInput } from "./prompt.js";

const base: PromptInput = {
    title: "Add retry to fetchUser",
    body: "Retries transient failures up to 3 times.",
    linkedIssue: null,
    diffText: "### src/user.ts (modified, +8/-1)\n@@ -1 +1 @@\n+retry logic",
    truncated: false,
};

describe("buildSystemPrompt", () => {
    it("states the alignment mission and the three tasks", () => {
        const s = buildSystemPrompt();
        expect(s).toMatch(/Rubric/);
        expect(s.toLowerCase()).toContain("intent");
        expect(s.toLowerCase()).toContain("unstated");
    });
});

describe("buildUserPrompt", () => {
    it("includes the PR title and body", () => {
        const p = buildUserPrompt(base);
        expect(p).toContain("Add retry to fetchUser");
        expect(p).toContain("Retries transient failures up to 3 times.");
    });

    it("wraps the diff in <diff> tags", () => {
        const p = buildUserPrompt(base);
        expect(p).toContain("<diff>");
        expect(p).toContain("</diff>");
        expect(p).toContain("+retry logic");
    });

    it("includes the linked issue title and body when present", () => {
        const p = buildUserPrompt({
            ...base,
            linkedIssue: {
                number: 42,
                title: "fetchUser flakes on 503",
                body: "It throws on transient 503s.",
            },
        });
        expect(p).toContain("#42");
        expect(p).toContain("fetchUser flakes on 503");
        expect(p).toContain("It throws on transient 503s.");
    });

    it("omits the linked-issue section when there is none", () => {
        const p = buildUserPrompt(base);
        expect(p.toLowerCase()).not.toContain("linked issue");
    });

    it("notes truncation only when the diff was truncated", () => {
        expect(buildUserPrompt(base).toLowerCase()).not.toContain("truncat");
        expect(buildUserPrompt({ ...base, truncated: true }).toLowerCase()).toContain("truncat");
    });

    it("uses a placeholder when the body is empty", () => {
        const p = buildUserPrompt({ ...base, body: "" });
        expect(p).toMatch(/no description/i);
    });
});

describe("buildUserPrompt with an implied spec", () => {
    const specBase: PromptInput = {
        title: "fix: prevent double submit",
        body: "Users could submit twice.",
        linkedIssue: null,
        diffText: "### src/submit.tsx (modified, +1/-0)\n@@ -1 +1 @@\n+x",
        truncated: false,
    };

    it("includes each spec item with its kind and confidence", () => {
        const prompt = buildUserPrompt({
            ...specBase,
            impliedSpec: {
                items: [
                    { text: "Submit disables on click", kind: "behavior", confidence: "high" },
                    { text: "Repeat submits are ignored", kind: "edge_case", confidence: "medium" },
                ],
            },
        });
        expect(prompt).toContain("Implied specification");
        expect(prompt).toContain("Submit disables on click");
        expect(prompt).toContain("behavior");
        expect(prompt).toContain("high");
        expect(prompt).toContain("Repeat submits are ignored");
    });

    it("omits the section entirely when inference did not run", () => {
        const prompt = buildUserPrompt({ ...specBase, impliedSpec: null });
        expect(prompt).not.toContain("Implied specification");
    });
});
