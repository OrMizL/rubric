import { describe, it, expect } from "vitest";
import type { Review } from "@rubric/core";
import { matchesKeywords, normalize, scoreCase } from "./score.js";

function review(over: Partial<Review> = {}): Review {
    return {
        verdict: "aligned",
        summary: "",
        statedClaims: [],
        inferredClaims: [],
        unstatedChanges: [],
        truncated: false,
        signalScore: { total: 50, band: "medium", components: [] },
        inference: { ran: true },
        ...over,
    };
}

const claim = (text: string, status: "implemented" | "partial" | "missing" | "contradicted") => ({
    id: "c",
    text,
    status,
    evidence: [],
    explanation: "",
});

describe("normalize / matchesKeywords", () => {
    it("lowercases and strips punctuation", () => {
        expect(normalize("No-Behavior  Change!")).toBe("no behavior change");
    });
    it("matches any keyword as a phrase", () => {
        expect(matchesKeywords("States there is NO behavior change.", ["no behavior change"])).toBe(
            true,
        );
        expect(matchesKeywords("Adds retries", ["timeout", "backoff"])).toBe(false);
    });
});

describe("scoreCase verdict", () => {
    it("passes when verdict is not in `not`", () => {
        const s = scoreCase({ verdict: { not: ["misaligned"] } }, review());
        expect(s.pass).toBe(true);
    });
    it("fails when verdict is in `not`", () => {
        const s = scoreCase(
            { verdict: { not: ["misaligned"] } },
            review({ verdict: "misaligned" }),
        );
        expect(s.pass).toBe(false);
        expect(s.anchors[0]!.outcome).toBe("fail");
    });
    it("requires membership in `oneOf`", () => {
        const s = scoreCase(
            { verdict: { oneOf: ["misaligned"] } },
            review({ verdict: "partially_aligned" }),
        );
        expect(s.pass).toBe(false);
    });
});

describe("scoreCase claims", () => {
    const label = {
        verdict: {},
        claims: [{ keywords: ["no behavior change"], status: ["contradicted" as const] }],
    };

    it("passes on keyword + allowed status, in stated claims", () => {
        const r = review({ statedClaims: [claim("Claims no behavior change", "contradicted")] });
        expect(scoreCase(label, r).pass).toBe(true);
    });

    it("also searches inferred claims", () => {
        const r = review({
            inferredClaims: [
                {
                    ...claim("No behavior change expected", "contradicted"),
                    confidence: "high",
                    kind: "behavior",
                },
            ],
        });
        expect(scoreCase(label, r).pass).toBe(true);
    });

    it("distinguishes found_wrong_status from not_found", () => {
        const wrong = review({ statedClaims: [claim("No behavior change", "implemented")] });
        expect(scoreCase(label, wrong).anchors[0]!.outcome).toBe("found_wrong_status");
        expect(scoreCase(label, review()).anchors[0]!.outcome).toBe("not_found");
    });
});

describe("scoreCase unstated", () => {
    const label = { verdict: {}, unstated: [{ file: "src/auth.ts", minRisk: "medium" as const }] };

    it("passes on matching file at or above minRisk", () => {
        const r = review({
            unstatedChanges: [{ file: "src/auth.ts", description: "", risk: "high" }],
        });
        expect(scoreCase(label, r).pass).toBe(true);
    });

    it("tolerates a leading ./ on the model's path", () => {
        const r = review({
            unstatedChanges: [{ file: "./src/auth.ts", description: "", risk: "medium" }],
        });
        expect(scoreCase(label, r).pass).toBe(true);
    });

    it("reports found_low_risk below the threshold", () => {
        const r = review({
            unstatedChanges: [{ file: "src/auth.ts", description: "", risk: "low" }],
        });
        expect(scoreCase(label, r).anchors[0]!.outcome).toBe("found_low_risk");
    });

    it("reports not_found when the file is absent", () => {
        expect(scoreCase(label, review()).anchors[0]!.outcome).toBe("not_found");
    });
});
