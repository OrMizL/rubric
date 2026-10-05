import type { Review } from "@rubric/core";
import type { Label, Risk } from "./case.js";

export type AnchorOutcome = "pass" | "fail" | "not_found" | "found_wrong_status" | "found_low_risk";

export interface AnchorResult {
    kind: "verdict" | "claim" | "unstated";
    index: number;
    outcome: AnchorOutcome;
    detail: string;
}

export interface CaseScore {
    pass: boolean;
    anchors: AnchorResult[];
}

const RISK_ORDER: Record<Risk, number> = { low: 0, medium: 1, high: 2 };

export function normalize(s: string): string {
    return s
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, " ")
        .trim();
}

export function matchesKeywords(text: string, keywords: string[]): boolean {
    const hay = ` ${normalize(text)} `;
    return keywords.some((k) => hay.includes(` ${normalize(k)} `));
}

function normPath(p: string): string {
    return p.replace(/^\.\//, "");
}

/**
 * Deterministic on purpose: an LLM judge would add its own error rate to every
 * number. Misses are split by kind (not found vs. found with the wrong status or
 * risk) because "Rubric didn't see it" and "Rubric misjudged it" need different fixes.
 */
export function scoreCase(label: Label, review: Review): CaseScore {
    const anchors: AnchorResult[] = [];

    const { not, oneOf } = label.verdict;
    if (not?.length || oneOf?.length) {
        const ok =
            !(not ?? []).includes(review.verdict) && (!oneOf || oneOf.includes(review.verdict));
        anchors.push({
            kind: "verdict",
            index: 0,
            outcome: ok ? "pass" : "fail",
            detail: `verdict ${review.verdict}`,
        });
    }

    const claims = [...review.statedClaims, ...review.inferredClaims];
    (label.claims ?? []).forEach((anchor, index) => {
        const hits = claims.filter((c) => matchesKeywords(c.text, anchor.keywords));
        const good = hits.find((c) => anchor.status.includes(c.status));
        anchors.push({
            kind: "claim",
            index,
            outcome: good ? "pass" : hits.length > 0 ? "found_wrong_status" : "not_found",
            detail: good
                ? `"${good.text}" (${good.status})`
                : hits.length > 0
                  ? hits.map((c) => `"${c.text}" (${c.status})`).join("; ")
                  : `no claim matching ${anchor.keywords.join(" | ")}`,
        });
    });

    (label.unstated ?? []).forEach((anchor, index) => {
        const hits = review.unstatedChanges.filter(
            (u) => normPath(u.file) === normPath(anchor.file),
        );
        const good = hits.find((u) => RISK_ORDER[u.risk] >= RISK_ORDER[anchor.minRisk]);
        anchors.push({
            kind: "unstated",
            index,
            outcome: good ? "pass" : hits.length > 0 ? "found_low_risk" : "not_found",
            detail: good
                ? `${good.file} (${good.risk})`
                : hits.length > 0
                  ? `${anchor.file} flagged ${hits.map((u) => u.risk).join("/")}`
                  : `${anchor.file} not in unstatedChanges`,
        });
    });

    return { pass: anchors.every((a) => a.outcome === "pass"), anchors };
}
