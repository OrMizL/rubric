import type { Claim, Review } from "@rubric/core";

/** ANSI color helpers, no-ops when color is disabled. */
type Style = (s: string) => string;
const ansi =
    (code: string): Style =>
    (s) =>
        `\x1b[${code}m${s}\x1b[0m`;

interface Palette {
    bold: Style;
    dim: Style;
    green: Style;
    yellow: Style;
    red: Style;
}

const COLORED: Palette = {
    bold: ansi("1"),
    dim: ansi("2"),
    green: ansi("32"),
    yellow: ansi("33"),
    red: ansi("31"),
};
const identity: Style = (s) => s;
const PLAIN: Palette = {
    bold: identity,
    dim: identity,
    green: identity,
    yellow: identity,
    red: identity,
};

const VERDICT: Record<Review["verdict"], { label: string; tint: keyof Palette; symbol: string }> = {
    aligned: { label: "ALIGNED", tint: "green", symbol: "✔" },
    partially_aligned: { label: "PARTIALLY ALIGNED", tint: "yellow", symbol: "⚠" },
    misaligned: { label: "MISALIGNED", tint: "red", symbol: "✘" },
};

const STATUS: Record<Claim["status"], { label: string; tint: keyof Palette; symbol: string }> = {
    implemented: { label: "implemented", tint: "green", symbol: "✔" },
    partial: { label: "partial", tint: "yellow", symbol: "◐" },
    missing: { label: "missing", tint: "yellow", symbol: "○" },
    contradicted: { label: "contradicted", tint: "red", symbol: "✘" },
};

const RISK: Record<"low" | "medium" | "high", keyof Palette> = {
    low: "dim",
    medium: "yellow",
    high: "red",
};

export interface TerminalOptions {
    /** Emit ANSI colors. Callers should disable for non-TTY / NO_COLOR. */
    color: boolean;
}

function evidenceText(claim: Claim): string {
    if (claim.evidence.length === 0) return "(no evidence cited)";
    return claim.evidence.map((e) => `${e.file}:${e.lines}`).join(", ");
}

/** Render a Review as a human-readable, optionally colorized terminal report. */
export function renderTerminal(review: Review, opts: TerminalOptions): string {
    const c = opts.color ? COLORED : PLAIN;
    const lines: string[] = [];

    const v = VERDICT[review.verdict];
    lines.push(c.bold(c[v.tint](`${v.symbol}  ${v.label}`)));
    lines.push("");
    lines.push(review.summary);
    lines.push("");

    lines.push(c.bold("Claims:"));
    if (review.claims.length === 0) {
        lines.push(c.dim("  (no checkable claims identified)"));
    }
    for (const claim of review.claims) {
        const s = STATUS[claim.status];
        const tag = c[s.tint](`${s.symbol} ${s.label.padEnd(12)}`);
        lines.push(`  ${tag} ${claim.text}`);
        lines.push(c.dim(`       └ ${evidenceText(claim)}`));
    }
    lines.push("");

    if (review.unstatedChanges.length > 0) {
        lines.push(c.bold("Unstated changes:"));
        for (const u of review.unstatedChanges) {
            const risk = c[RISK[u.risk]](`${u.risk} risk`.padEnd(11));
            lines.push(`  ${risk} ${c.bold(u.file)} — ${u.description}`);
        }
        lines.push("");
    }

    if (review.truncated) {
        lines.push(
            c.yellow(
                "⚠ Diff was truncated to fit the token budget — some files were not reviewed.",
            ),
        );
        lines.push("");
    }

    return lines.join("\n");
}
