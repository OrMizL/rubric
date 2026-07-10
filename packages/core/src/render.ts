import { RUBRIC_COMMENT_MARKER } from "./types.js";
import type { Claim, Review } from "./schema.js";

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

function claimsTable(claims: Claim[], ctx: RenderContext): string {
    if (claims.length === 0) return "_No checkable claims were identified._";
    const header = "| | Claim | Evidence |\n|:--:|---|---|";
    const rows = claims.map(
        (c) => `| ${STATUS_EMOJI[c.status]} | ${cell(c.text)} | ${evidenceLinks(c, ctx)} |`,
    );
    return [header, ...rows].join("\n");
}

function unstatedSection(changes: Review["unstatedChanges"]): string | null {
    if (changes.length === 0) return null;
    const items = changes.map(
        (u) => `- ${RISK_EMOJI[u.risk]} **${u.file}** (${u.risk} risk) — ${u.description}`,
    );
    return [`### ⚠️ Unstated changes`, ``, ...items].join("\n");
}

/** Render a Review as the Markdown body of Rubric's PR comment. */
export function reviewToMarkdown(review: Review, ctx: RenderContext): string {
    const parts: string[] = [RUBRIC_COMMENT_MARKER];

    parts.push(`## ${VERDICT_BADGE[review.verdict]}`);
    parts.push(review.summary);

    parts.push(`### Claims\n\n${claimsTable(review.claims, ctx)}`);

    const unstated = unstatedSection(review.unstatedChanges);
    if (unstated) parts.push(unstated);

    if (review.truncated) {
        parts.push(
            `> ⚠️ The diff was truncated to fit the token budget — some files were not reviewed.`,
        );
    }

    const tokenNote = ctx.inputTokens !== undefined ? ` · ${ctx.inputTokens} input tokens` : "";
    parts.push(`---\n<sub>Reviewed by Rubric · \`${ctx.model}\`${tokenNote}</sub>`);

    return parts.join("\n\n") + "\n";
}
