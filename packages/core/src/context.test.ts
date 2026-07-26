import { describe, it, expect } from "vitest";
import { gatherContext, summarizeFiles } from "./context.js";
import type { ChangedFile, PullRequestData } from "./types.js";

function pr(overrides: Partial<PullRequestData> = {}): PullRequestData {
    return {
        owner: "o",
        repo: "r",
        number: 1,
        title: "fix: prevent double submit",
        body: "Body text.",
        baseRef: "main",
        headRef: "fix/double-submit",
        headSha: "abc123",
        linkedIssue: null,
        labels: ["bug"],
        commits: [{ sha: "deadbee", message: "prevent double submit on the form" }],
        files: [
            {
                filename: "src/submit.tsx",
                status: "modified",
                additions: 12,
                deletions: 3,
                patch: "@@ -1,3 +1,12 @@\n+const SECRET_IMPLEMENTATION = true;",
            },
        ],
        ...overrides,
    };
}

describe("summarizeFiles", () => {
    it("strips the patch from every file", () => {
        const files: ChangedFile[] = [
            { filename: "a.ts", status: "modified", additions: 1, deletions: 0, patch: "@@ x" },
        ];
        const summary = summarizeFiles(files);
        expect(summary).toEqual([
            { filename: "a.ts", status: "modified", additions: 1, deletions: 0 },
        ]);
        expect(Object.keys(summary[0]!)).not.toContain("patch");
    });
});

describe("gatherContext", () => {
    it("carries intent, labels, and commits through", () => {
        const ctx = gatherContext(pr());
        expect(ctx.title).toBe("fix: prevent double submit");
        expect(ctx.labels).toEqual(["bug"]);
        expect(ctx.commits).toHaveLength(1);
        expect(ctx.fileSummary).toHaveLength(1);
    });

    it("never exposes patch text anywhere in the context", () => {
        const ctx = gatherContext(pr());
        expect(JSON.stringify(ctx)).not.toContain("SECRET_IMPLEMENTATION");
        expect(JSON.stringify(ctx)).not.toContain("@@");
    });
});
