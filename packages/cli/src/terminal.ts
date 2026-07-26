import type { Claim, InferredClaim, Review } from "@rubric/core";

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

    const claims = [...review.statedClaims, ...review.inferredClaims];
    lines.push(c.bold("Claims:"));
    if (claims.length === 0) {
        lines.push(c.dim("  (no checkable claims identified)"));
    }
    for (const claim of claims) {
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

    if (review.inference.ran) {
        const s = review.signalScore;
        const tint = s.band === "high" ? "green" : s.band === "medium" ? "yellow" : "red";
        lines.push(c[tint](`Signal ${s.total}/100 (${s.band})`));
        if (s.band === "low") {
            lines.push(
                c.dim("  Expected behavior was inferred from limited context — treat with care."),
            );
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

const KIND_LABEL: Record<InferredClaim["kind"], string> = {
    behavior: "Expected behavior",
    edge_case: "Edge cases",
    acceptance: "Acceptance criteria",
};

/** Print the inferred spec grouped by kind, for --show-inferred-spec. */
export function renderInferredSpec(review: Review, opts: TerminalOptions): string {
    const c = opts.color ? COLORED : PLAIN;
    if (!review.inference.ran) {
        return c.dim(`(inference did not run: ${review.inference.reason ?? "unknown"})`);
    }
    const lines: string[] = [c.bold("Inferred specification:")];
    for (const kind of ["behavior", "edge_case", "acceptance"] as const) {
        const items = review.inferredClaims.filter((i) => i.kind === kind);
        if (items.length === 0) continue;
        lines.push("", c.bold(`  ${KIND_LABEL[kind]}:`));
        for (const item of items) {
            lines.push(`    ${c.dim(item.confidence.toUpperCase().padEnd(6))} ${item.text}`);
        }
    }
    return lines.join("\n");
}
