import type { Claim, Review } from "@rubric/core";

/**
 * These maps mirror packages/core/src/render.ts — core only emits a Markdown
 * string (for GitHub comments), so it cannot drive React/HTML here. This
 * component renders the typed Review object directly, so the status/verdict/
 * risk vocabularies are re-expressed as designed pills. The emoji in render.ts
 * map 1:1 to the tones/labels below; keep them in sync if core's enums change.
 *   render.ts ✅ Aligned / ⚠️ Partially aligned / ❌ Misaligned
 *   render.ts ✅ implemented / 🟡 partial / ⭕ missing / ❌ contradicted
 *   render.ts ⚪ low / 🟠 medium / 🔴 high
 */

type Tone = "aligned" | "partial" | "missing" | "misaligned";

const VERDICT_META: Record<Review["verdict"], { label: string; meaning: string; tone: Tone }> = {
    aligned: {
        label: "Aligned",
        meaning: "The diff delivers what the description promised.",
        tone: "aligned",
    },
    partially_aligned: {
        label: "Partially aligned",
        meaning: "Some stated intent landed; parts are missing or incomplete.",
        tone: "partial",
    },
    misaligned: {
        label: "Misaligned",
        meaning: "The diff does not do what the description claims.",
        tone: "misaligned",
    },
};

const STATUS_META: Record<Claim["status"], { label: string; tone: Tone }> = {
    implemented: { label: "Implemented", tone: "aligned" },
    partial: { label: "Partial", tone: "partial" },
    missing: { label: "Missing", tone: "missing" },
    contradicted: { label: "Contradicted", tone: "misaligned" },
};

const RISK_META: Record<"low" | "medium" | "high", { label: string; tone: Tone }> = {
    low: { label: "Low risk", tone: "missing" },
    medium: { label: "Medium risk", tone: "partial" },
    high: { label: "High risk", tone: "misaligned" },
};

function StatusPill({ status }: { status: Claim["status"] }) {
    const { label, tone } = STATUS_META[status];
    return (
        <span className={`pill pill--${tone}`}>
            <span className="pill__dot" aria-hidden="true" />
            {label}
        </span>
    );
}

function Evidence({ claim }: { claim: Claim }) {
    if (claim.evidence.length === 0) {
        return <span className="evidence-empty">No evidence</span>;
    }
    return (
        <span className="evidence">
            {claim.evidence.map((e, i) => (
                <code className="chip" key={`${e.file}:${e.lines}:${i}`}>
                    {e.file}:{e.lines}
                </code>
            ))}
        </span>
    );
}

export function ReviewCard({ review }: { review: Review }) {
    const verdict = VERDICT_META[review.verdict];

    return (
        <article className="review">
            <header className={`review__verdict review__verdict--${verdict.tone}`}>
                <span className="review__verdict-accent" aria-hidden="true" />
                <div className="review__verdict-body">
                    <span className="review__verdict-kicker">Verdict</span>
                    <h3 className="review__verdict-label">{verdict.label}</h3>
                    <p className="review__verdict-meaning">{verdict.meaning}</p>
                </div>
            </header>

            <p className="review__summary">{review.summary}</p>

            <section className="review__block">
                <div className="review__block-head">
                    <h4 className="review__block-title">Claims</h4>
                    <span className="review__count">{review.claims.length}</span>
                </div>

                {review.claims.length === 0 ? (
                    <p className="review__empty">No checkable claims were identified.</p>
                ) : (
                    <>
                        {/* Desktop: real table. Hidden under ~640px via CSS. */}
                        <table className="claims">
                            <thead>
                                <tr>
                                    <th className="claims__col-status">Status</th>
                                    <th className="claims__col-claim">Claim</th>
                                    <th className="claims__col-evidence">Evidence</th>
                                </tr>
                            </thead>
                            <tbody>
                                {review.claims.map((claim) => (
                                    <tr key={claim.id}>
                                        <td className="claims__status">
                                            <StatusPill status={claim.status} />
                                        </td>
                                        <td>
                                            <p className="claims__text">{claim.text}</p>
                                            <p className="claims__explanation">
                                                {claim.explanation}
                                            </p>
                                        </td>
                                        <td className="claims__evidence">
                                            <Evidence claim={claim} />
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>

                        {/* Mobile: stacked cards. Hidden above ~640px via CSS. */}
                        <ul className="claim-cards">
                            {review.claims.map((claim) => (
                                <li className="claim-card" key={claim.id}>
                                    <StatusPill status={claim.status} />
                                    <p className="claims__text">{claim.text}</p>
                                    <p className="claims__explanation">{claim.explanation}</p>
                                    <Evidence claim={claim} />
                                </li>
                            ))}
                        </ul>
                    </>
                )}
            </section>

            {review.unstatedChanges.length > 0 && (
                <section className="review__block">
                    <div className="review__block-head">
                        <h4 className="review__block-title">Unstated changes</h4>
                        <span className="review__count">{review.unstatedChanges.length}</span>
                    </div>
                    <ul className="unstated">
                        {review.unstatedChanges.map((change) => {
                            const risk = RISK_META[change.risk];
                            return (
                                <li className="unstated__item" key={change.file}>
                                    <div className="unstated__row">
                                        <span className={`pill pill--${risk.tone}`}>
                                            <span className="pill__dot" aria-hidden="true" />
                                            {risk.label}
                                        </span>
                                        <code className="chip">{change.file}</code>
                                    </div>
                                    <p className="unstated__desc">{change.description}</p>
                                </li>
                            );
                        })}
                    </ul>
                </section>
            )}

            {review.truncated && (
                <p className="review__truncated" role="note">
                    <span aria-hidden="true">⚠</span> The diff was truncated to fit the token budget
                    — some files were not reviewed.
                </p>
            )}
        </article>
    );
}
