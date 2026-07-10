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
        expect(md).toContain(
            "https://github.com/sindresorhus/slugify/blob/5fc6af2/index.js#L78-L84",
        );
    });

    it("renders a dash for a claim with no evidence", () => {
        const md = reviewToMarkdown(misaligned, ctx);
        // c1 (missing) has empty evidence — the row should still render.
        expect(md).toMatch(/Adds an Installation section.*\|\s*—/s);
    });

    it("includes an unstated-changes section only when there are any", () => {
        expect(reviewToMarkdown(misaligned, ctx).toLowerCase()).toContain("unstated changes");
        expect(reviewToMarkdown(aligned, ctx).toLowerCase()).not.toContain("unstated changes");
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
            claims: [
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
