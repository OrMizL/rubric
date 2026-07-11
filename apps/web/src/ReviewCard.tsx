import type { Claim, Review } from "@rubric/core";

/**
 * These maps mirror packages/core/src/render.ts exactly. They are not
 * imported from core because core only emits a Markdown string (for GitHub
 * comments) — this component renders the typed Review object directly as
 * React/HTML, so the emoji maps are duplicated here on purpose. Keep in
 * sync with render.ts if the core maps ever change.
 */
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

function evidenceText(claim: Claim): string {
    if (claim.evidence.length === 0) return "—";
    return claim.evidence.map((e) => `${e.file}:${e.lines}`).join(", ");
}

export function ReviewCard({ review }: { review: Review }) {
    return (
        <section className="review-card">
            <header className="review-card__header">
                <span className={`verdict-badge verdict-badge--${review.verdict}`}>
                    {VERDICT_BADGE[review.verdict]}
                </span>
            </header>

            <p className="review-card__summary">{review.summary}</p>

            <h3 className="review-card__section-title">Claims</h3>
            <table className="claims-table">
                <thead>
                    <tr>
                        <th aria-label="Status" />
                        <th>Claim</th>
                        <th>Evidence</th>
                    </tr>
                </thead>
                <tbody>
                    {review.claims.length === 0 ? (
                        <tr>
                            <td colSpan={3} className="claims-table__empty">
                                No checkable claims were identified.
                            </td>
                        </tr>
                    ) : (
                        review.claims.map((claim) => (
                            <tr key={claim.id}>
                                <td className="claims-table__status" title={claim.status}>
                                    {STATUS_EMOJI[claim.status]}
                                </td>
                                <td>
                                    <div className="claims-table__text">{claim.text}</div>
                                    <div className="claims-table__explanation">
                                        {claim.explanation}
                                    </div>
                                </td>
                                <td className="claims-table__evidence">{evidenceText(claim)}</td>
                            </tr>
                        ))
                    )}
                </tbody>
            </table>

            {review.unstatedChanges.length > 0 && (
                <div className="unstated-section">
                    <h3 className="review-card__section-title">⚠️ Unstated changes</h3>
                    <ul className="unstated-list">
                        {review.unstatedChanges.map((change) => (
                            <li key={change.file}>
                                <span className="unstated-list__risk" title={`${change.risk} risk`}>
                                    {RISK_EMOJI[change.risk]}
                                </span>{" "}
                                <strong>{change.file}</strong> ({change.risk} risk) —{" "}
                                {change.description}
                            </li>
                        ))}
                    </ul>
                </div>
            )}

            {review.truncated && (
                <p className="review-card__truncated-note">
                    ⚠️ The diff was truncated to fit the token budget — some files were not
                    reviewed.
                </p>
            )}
        </section>
    );
}
