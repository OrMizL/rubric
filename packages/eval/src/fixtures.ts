import type { EvalCase } from "./case.js";

export function makeCase(over: Partial<EvalCase> = {}): EvalCase {
    return {
        id: "o__r__1.control",
        sourceId: "o__r__1",
        mutation: "control",
        input: {
            owner: "o",
            repo: "r",
            number: 1,
            title: "feat: add thing",
            body: "Adds the thing.",
            baseRef: "main",
            headRef: "feat",
            headSha: "abc",
            linkedIssue: null,
            labels: [],
            commits: [],
            files: [
                {
                    filename: "src/a.ts",
                    status: "modified",
                    additions: 1,
                    deletions: 1,
                    patch: "@@ -1 +1 @@\n-a\n+b",
                },
            ],
        },
        label: { verdict: { not: ["misaligned"] } },
        meta: { repo: "o/r", diffLines: 2, fileCount: 1 },
        ...over,
    };
}
