import { RUBRIC_COMMENT_MARKER } from "./types.js";
import type { Claim, InferredClaim, Review } from "./schema.js";

/** Repo/run context needed to build permalinks and the footer. */
export interface RenderContext {
    owner: string;
    repo: string;
    /** Commit SHA the evidence permalinks point at (PR head). */
    headSha: string;
    model: string;
    /** Input token count logged by the engine; shown in the footer if given. */
    inputTokens?: number;
}

const VERDICT_BADGE: Record<Review["verdict"], string> = {
    aligned: "✅ Aligned",
    partially_aligned: "⚠️ Partially aligned",
    misaligned: "❌ Misaligned",
};

const STATUS_EMOJI: Record<Claim["status"], string> = {
    implemented: "✅",
    partial: "🟡",
    missing: "⭕",
    contradicted: "❌",
};

const RISK_EMOJI: Record<"low" | "medium" | "high", string> = {
    low: "⚪",
    medium: "🟠",
    high: "🔴",
};

/** Stated and inferred claims render as one table; provenance is a column. */
function allClaims(review: Review): Array<Claim | InferredClaim> {
    return [...review.statedClaims, ...review.inferredClaims];
}

function isInferred(claim: Claim | InferredClaim): claim is InferredClaim {
    return "confidence" in claim;
}

/** Escape characters that would break a Markdown table cell. */
function cell(text: string): string {
    return text.replace(/\|/g, "\\|").replace(/\r?\n/g, " ").trim();
}

/** Convert an evidence `lines` string ("42-58", "37", "whole file") to a #Lx anchor. */
function linesToAnchor(lines: string): string {
    const range = /^\s*(\d+)\s*-\s*(\d+)\s*$/.exec(lines);
    if (range) return `#L${range[1]}-L${range[2]}`;
    const single = /^\s*(\d+)\s*$/.exec(lines);
    if (single) return `#L${single[1]}`;
    return "";
}

function evidenceLinks(claim: Claim, ctx: RenderContext): string {
    if (claim.evidence.length === 0) return "—";
    return claim.evidence
        .map((e) => {
            const anchor = linesToAnchor(e.lines);
            const url = `https://github.com/${ctx.owner}/${ctx.repo}/blob/${ctx.headSha}/${e.file}${anchor}`;
            return `[${e.file}${anchor}](${url})`;
        })
        .join("<br>");
}

function claimsTable(review: Review, ctx: RenderContext): string {
    const claims = allClaims(review);
    if (claims.length === 0) return "_No checkable claims were identified._";

    // Omit the Source column entirely when nothing was inferred, so --no-infer
    // output stays byte-identical to pre-inference Rubric.
    const showSource = review.inferredClaims.length > 0;
    const header = showSource
        ? "| | Claim | Source | Evidence |\n|:--:|---|---|---|"
        : "| | Claim | Evidence |\n|:--:|---|---|";

    const rows = claims.map((c) => {
        const cells = [STATUS_EMOJI[c.status], cell(c.text)];
        if (showSource) {
            cells.push(isInferred(c) ? `inferred · ${c.confidence.toUpperCase()}` : "stated");
        }
        cells.push(evidenceLinks(c, ctx));
        return `| ${cells.join(" | ")} |`;
    });
    return [header, ...rows].join("\n");
}

function unstatedSection(changes: Review["unstatedChanges"]): string | null {
    if (changes.length === 0) return null;
    const items = changes.map(
        (u) => `- ${RISK_EMOJI[u.risk]} **${u.file}** (${u.risk} risk) — ${u.description}`,
    );
    return [`### ⚠️ Unstated changes`, ``, ...items].join("\n");
}

/** Footer line summarizing the code-computed signal score. */
function signalLine(review: Review): string {
    const weakest = [...review.signalScore.components]
        .filter((c) => c.earned < c.max)
        .sort((a, b) => a.earned - b.earned)
        .slice(0, 2)
        .map((c) => c.note);
    const detail = weakest.length > 0 ? ` — ${weakest.join(", ")}` : "";
    return `Signal ${review.signalScore.total}/100${detail}`;
}

/** Render a Review as the Markdown body of Rubric's PR comment. */
export function reviewToMarkdown(review: Review, ctx: RenderContext): string {
    const parts: string[] = [RUBRIC_COMMENT_MARKER];

    parts.push(`## ${VERDICT_BADGE[review.verdict]}`);
    parts.push(review.summary);

    parts.push(`### Claims\n\n${claimsTable(review, ctx)}`);

    const unstated = unstatedSection(review.unstatedChanges);
    if (unstated) parts.push(unstated);

    if (review.truncated) {
        parts.push(
            `> ⚠️ The diff was truncated to fit the token budget — some files were not reviewed.`,
        );
    }

    const tokenNote = ctx.inputTokens !== undefined ? ` · ${ctx.inputTokens} input tokens` : "";
    // The signal score calibrates trust in inferred content; with nothing inferred
    // there is nothing to calibrate, so it stays hidden.
    const signalNote = review.inference.ran ? ` · ${signalLine(review)}` : "";
    parts.push(`---\n<sub>Reviewed by Rubric · \`${ctx.model}\`${signalNote}${tokenNote}</sub>`);

    return parts.join("\n\n") + "\n";
}
