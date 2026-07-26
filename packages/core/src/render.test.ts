import { describe, it, expect } from "vitest";
import { reviewToMarkdown, type RenderContext } from "./render.js";
import { RUBRIC_COMMENT_MARKER } from "./types.js";
import type { Review } from "./schema.js";
import alignedJson from "./__fixtures__/slugify-73.review.json";
import misalignedJson from "./__fixtures__/slugify-73-misaligned.review.json";

const aligned = alignedJson as unknown as Review;
const misaligned = misalignedJson as unknown as Review;

const ctx: RenderContext = {
    owner: "sindresorhus",
    repo: "slugify",
    headSha: "5fc6af2",
    model: "claude-opus-4-8",
    inputTokens: 1463,
};

describe("reviewToMarkdown", () => {
    it("embeds the hidden upsert marker", () => {
        expect(reviewToMarkdown(aligned, ctx)).toContain(RUBRIC_COMMENT_MARKER);
    });

    it("shows a ✅ aligned badge for an aligned verdict", () => {
        const md = reviewToMarkdown(aligned, ctx);
        expect(md).toContain("✅");
        expect(md).toMatch(/aligned/i);
    });

    it("shows a ❌ misaligned badge for a misaligned verdict", () => {
        expect(reviewToMarkdown(misaligned, ctx)).toContain("❌");
    });

    it("includes the summary text", () => {
        expect(reviewToMarkdown(aligned, ctx)).toContain(aligned.summary);
    });

    it("renders each claim's text with a status emoji", () => {
        const md = reviewToMarkdown(misaligned, ctx);
        // c1 is missing, c2 is contradicted
        expect(md).toContain("Adds an Installation section to the README");
        expect(md).toContain("⭕"); // missing
        expect(md).toContain("❌"); // contradicted
    });

    it("renders evidence as GitHub blob permalinks with line anchors", () => {
        const md = reviewToMarkdown(aligned, ctx);
        // Derive the expectation from the fixture instead of hardcoding a line range.
        // Which lines the model cites is its call and changes whenever fixtures are
        // regenerated; that must not fail a test about how render.ts builds a URL.
        const e = aligned.statedClaims
            .flatMap((c) => c.evidence)
            .find((e) => /^\d+-\d+$/.test(e.lines))!;
        const [start, end] = e.lines.split("-");
        expect(md).toContain(
            `https://github.com/sindresorhus/slugify/blob/5fc6af2/${e.file}#L${start}-L${end}`,
        );
    });

    it("renders a dash for a claim with no evidence", () => {
        // Construct the empty-evidence case rather than relying on a fixture claim
        // happening to have none — the model cites evidence even for missing claims.
        const noEvidence: Review = {
            ...misaligned,
            statedClaims: [
                {
                    id: "c1",
                    text: "Adds an Installation section to the README",
                    status: "missing",
                    evidence: [],
                    explanation: "The diff contains no README changes.",
                },
            ],
            inferredClaims: [],
        };
        expect(reviewToMarkdown(noEvidence, ctx)).toMatch(/Adds an Installation section.*\|\s*—/s);
    });

    it("includes an unstated-changes section only when there are any", () => {
        expect(reviewToMarkdown(misaligned, ctx).toLowerCase()).toContain("unstated changes");
        // Empty the array explicitly: an aligned verdict does not imply the model
        // found nothing unstated, so the fixture can't stand in for the empty case.
        const none: Review = { ...aligned, unstatedChanges: [] };
        expect(reviewToMarkdown(none, ctx).toLowerCase()).not.toContain("unstated changes");
    });

    it("lists unstated changes with file and risk", () => {
        const md = reviewToMarkdown(misaligned, ctx);
        expect(md).toContain("index.js");
        expect(md).toMatch(/high/i);
        expect(md).toMatch(/test\.js/);
    });

    it("shows a truncation warning only when truncated", () => {
        expect(reviewToMarkdown(aligned, ctx).toLowerCase()).not.toContain("truncat");
        expect(reviewToMarkdown({ ...aligned, truncated: true }, ctx).toLowerCase()).toContain(
            "truncat",
        );
    });

    it("footer names the model and input token count", () => {
        const md = reviewToMarkdown(aligned, ctx);
        expect(md).toContain("claude-opus-4-8");
        expect(md).toContain("1463");
    });

    it("escapes pipe characters in claim text so the table isn't broken", () => {
        const withPipe: Review = {
            ...aligned,
            statedClaims: [
                {
                    id: "x",
                    text: "handle a | b in input",
                    status: "implemented",
                    evidence: [],
                    explanation: "",
                },
            ],
        };
        const md = reviewToMarkdown(withPipe, ctx);
        expect(md).toContain("a \\| b");
    });
});

describe("inferred claims rendering", () => {
    const ctx = { owner: "o", repo: "r", headSha: "abc123", model: "claude-opus-4-8" };

    const withInferred = {
        verdict: "partially_aligned" as const,
        summary: "Mostly there.",
        statedClaims: [
            {
                id: "s1",
                text: "Disables submit on click",
                status: "implemented" as const,
                evidence: [{ file: "src/submit.tsx", lines: "24" }],
                explanation: "Done.",
            },
        ],
        inferredClaims: [
            {
                id: "i1",
                text: "In-flight state is visible",
                status: "missing" as const,
                evidence: [],
                explanation: "No spinner found.",
                confidence: "high" as const,
                kind: "behavior" as const,
            },
        ],
        unstatedChanges: [],
        truncated: false,
        signalScore: {
            total: 48,
            band: "low" as const,
            components: [
                {
                    key: "tests" as const,
                    label: "Tests touched",
                    earned: 0,
                    max: 20,
                    note: "no test files changed",
                },
            ],
        },
        inference: { ran: true },
    };

    it("renders one table with a Source column", () => {
        const md = reviewToMarkdown(withInferred, ctx);
        expect(md).toContain("| | Claim | Source | Evidence |");
        expect(md).toContain("| stated |");
        expect(md).toContain("inferred · HIGH");
    });

    it("puts stated claims before inferred ones", () => {
        const md = reviewToMarkdown(withInferred, ctx);
        expect(md.indexOf("Disables submit on click")).toBeLessThan(
            md.indexOf("In-flight state is visible"),
        );
    });

    it("shows the signal score in the footer when inference ran", () => {
        expect(reviewToMarkdown(withInferred, ctx)).toContain("Signal 48/100");
    });

    it("hides the signal score when inference did not run", () => {
        const off = { ...withInferred, inferredClaims: [], inference: { ran: false } };
        expect(reviewToMarkdown(off, ctx)).not.toContain("Signal 48/100");
    });

    it("promotes a low-signal disclaimer above the claims", () => {
        const md = reviewToMarkdown(withInferred, ctx);
        expect(md).toContain("Low signal (48/100)");
        expect(md.indexOf("Low signal")).toBeLessThan(md.indexOf("### Claims"));
    });

    it("omits the disclaimer once signal clears the threshold", () => {
        const strong = {
            ...withInferred,
            signalScore: { ...withInferred.signalScore, total: 85, band: "high" as const },
        };
        expect(reviewToMarkdown(strong, ctx)).not.toContain("Low signal");
    });

    it("keeps the marker first", () => {
        expect(reviewToMarkdown(withInferred, ctx).startsWith("<!-- rubric-review -->")).toBe(true);
    });
});
