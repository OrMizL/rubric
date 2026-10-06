import { useState } from "react";
import type { Claim, Review } from "@rubric/core";

import { fixtureOptions, type FixtureOption } from "./fixtures";

/**
 * These vocabularies mirror packages/core/src/render.ts. Core only emits Markdown for GitHub
 * comments, so the typed Review is rendered directly here; keep the labels in sync if core's
 * enums change.
 */
const VERDICT_LABEL: Record<Review["verdict"], string> = {
    aligned: "Aligned",
    partially_aligned: "Partially aligned",
    misaligned: "Misaligned",
};

const STATUS_LABEL: Record<Claim["status"], string> = {
    implemented: "met",
    partial: "partial",
    missing: "missing",
    contradicted: "contradicted",
};

const RISK_LABEL = { low: "low risk", medium: "medium risk", high: "high risk" } as const;

/** Review text uses Markdown-style `code` spans; render them as code instead of raw backticks. */
function Inline({ text }: { text: string }) {
    return (
        <>
            {text
                .split(/(`[^`]+`)/)
                .map((part, i) =>
                    part.length > 2 && part.startsWith("`") && part.endsWith("`") ? (
                        <code key={i}>{part.slice(1, -1)}</code>
                    ) : (
                        part
                    ),
                )}
        </>
    );
}

function evidenceSummary(claim: Claim): string {
    const first = claim.evidence[0];
    if (!first) return "no evidence";
    const file = first.file.split("/").at(-1);
    const more = claim.evidence.length > 1 ? ` +${claim.evidence.length - 1}` : "";
    return `${file}:${first.lines}${more}`;
}

function ClaimRow({ claim, inferred }: { claim: Claim; inferred: boolean }) {
    return (
        <details className={`claim claim--${claim.status}`} open={claim.status === "contradicted"}>
            <summary className="claim__row">
                <span className="claim__status">{STATUS_LABEL[claim.status]}</span>
                <span className="claim__text">
                    <Inline text={claim.text} />
                    {inferred && <span className="claim__inferred">inferred</span>}
                </span>
                <span className="claim__ev">{evidenceSummary(claim)}</span>
            </summary>
            <div className="claim__detail">
                <p>
                    <Inline text={claim.explanation} />
                </p>
                {claim.evidence.length > 0 && (
                    <ul className="claim__files">
                        {claim.evidence.map((e, i) => (
                            <li key={`${e.file}:${e.lines}:${i}`}>
                                <code>
                                    {e.file}:{e.lines}
                                </code>
                            </li>
                        ))}
                    </ul>
                )}
            </div>
        </details>
    );
}

export function ReviewLedger() {
    const [selectedId, setSelectedId] = useState<FixtureOption["id"]>("real");
    const selected =
        fixtureOptions.find((option) => option.id === selectedId) ?? fixtureOptions[0]!;
    const { review } = selected;

    return (
        <div className="ledger">
            <div className="tabs" role="tablist" aria-label="Example reviews">
                {fixtureOptions.map((option) => (
                    <button
                        key={option.id}
                        type="button"
                        role="tab"
                        id={`tab-${option.id}`}
                        aria-selected={option.id === selectedId}
                        aria-controls="ledger-panel"
                        className="tabs__btn"
                        onClick={() => setSelectedId(option.id)}
                    >
                        <span className="tabs__label">{option.label}</span>
                        <span className="tabs__pr">
                            {option.repo}#{option.prNumber}
                        </span>
                    </button>
                ))}
            </div>

            <article
                id="ledger-panel"
                role="tabpanel"
                aria-labelledby={`tab-${selected.id}`}
                className="sheet"
            >
                <header className="sheet__head">
                    <div>
                        <p className="sheet__pr">
                            {selected.repo} #{selected.prNumber}
                        </p>
                        <h3 className="sheet__title">
                            <Inline text={selected.prTitle} />
                        </h3>
                    </div>
                    <p className={`sheet__verdict sheet__verdict--${review.verdict}`}>
                        {VERDICT_LABEL[review.verdict]}
                    </p>
                </header>
                {selected.note && <p className="sheet__note">{selected.note}</p>}
                <p className="sheet__summary">
                    <Inline text={review.summary} />
                </p>

                <h4 className="sheet__label">
                    Claims <span>{review.statedClaims.length + review.inferredClaims.length}</span>
                </h4>
                <div className="claims">
                    {review.statedClaims.map((claim) => (
                        <ClaimRow key={claim.id} claim={claim} inferred={false} />
                    ))}
                    {review.inferredClaims.map((claim) => (
                        <ClaimRow key={claim.id} claim={claim} inferred />
                    ))}
                </div>

                {review.unstatedChanges.length > 0 && (
                    <>
                        <h4 className="sheet__label">
                            Changes the description never mentions{" "}
                            <span>{review.unstatedChanges.length}</span>
                        </h4>
                        <ul className="unstated">
                            {review.unstatedChanges.map((change, i) => (
                                <li key={`${change.file}:${i}`} className="unstated__item">
                                    <span
                                        className={`unstated__risk unstated__risk--${change.risk}`}
                                    >
                                        {RISK_LABEL[change.risk]}
                                    </span>
                                    <div>
                                        <code className="unstated__file">{change.file}</code>
                                        <p>
                                            <Inline text={change.description} />
                                        </p>
                                    </div>
                                </li>
                            ))}
                        </ul>
                    </>
                )}

                {review.truncated && (
                    <p className="sheet__note" role="note">
                        The diff was truncated to fit the token budget, so some files were not
                        reviewed.
                    </p>
                )}
            </article>
        </div>
    );
}
