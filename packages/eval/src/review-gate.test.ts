import { describe, it, expect } from "vitest";
import { formatDraft } from "./review-gate.js";
import { makeCase } from "./fixtures.js";

describe("formatDraft", () => {
    it("shows id, mutation, label, and only the patches that changed", () => {
        const source = makeCase().input;
        source.files.push({
            filename: "src/untouched.ts",
            status: "modified",
            additions: 1,
            deletions: 0,
            patch: "@@ -1 +1,2 @@\n a\n+z",
        });
        const mutated = makeCase({
            id: "o__r__1.smuggle.telemetry-call",
            mutation: "smuggle",
            label: { verdict: {}, unstated: [{ file: "src/a.ts", minRisk: "medium" }] },
        });
        mutated.input.files = [
            {
                ...source.files[0]!,
                patch: source.files[0]!.patch + "\n@@ -1,0 +2 @@\n+send()",
                additions: 2,
            },
            source.files[1]!,
        ];
        const text = formatDraft(mutated, source);
        expect(text).toContain("o__r__1.smuggle.telemetry-call");
        expect(text).toContain("src/a.ts");
        expect(text).toContain("+send()");
        expect(text).not.toContain("src/untouched.ts");
        expect(text).toContain("minRisk");
    });
});
