import { useState } from "react";

import { ReviewCard } from "./ReviewCard";
import { fixtureOptions, type FixtureOption } from "./fixtures";
import type { Review } from "@rubric/core";

const GITHUB_URL = "https://github.com/OrMizL/rubric";

/** Verdict → toggle-dot tone, so each segment previews its outcome. */
const VERDICT_TONE: Record<Review["verdict"], string> = {
    aligned: "aligned",
    partially_aligned: "partial",
    misaligned: "misaligned",
};

/** Hand-made mark: a check nested inside a ruled bracket pair. */
function BracketMark({ className }: { className?: string }) {
    return (
        <svg
            className={className}
            viewBox="0 0 32 32"
            width="22"
            height="22"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.2"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
        >
            <path d="M11 7 H8 V25 H11" />
            <path d="M21 7 H24 V25 H21" />
            <path d="M12.5 16.5 L15 19 L20 12.5" />
        </svg>
    );
}

export function App() {
    const [selectedId, setSelectedId] = useState<FixtureOption["id"]>("aligned");
    const selected =
        fixtureOptions.find((option) => option.id === selectedId) ?? fixtureOptions[0]!;

    return (
        <div className="site">
            <header className="topbar">
                <div className="topbar__inner">
                    <a className="wordmark" href="#top" aria-label="Rubric home">
                        <BracketMark className="wordmark__mark" />
                        <span className="wordmark__text">RUBRIC</span>
                    </a>
                    <nav className="topbar__nav" aria-label="Primary">
                        <a className="navlink" href="#demo">
                            How it works
                        </a>
                        <a className="navlink" href={GITHUB_URL} target="_blank" rel="noreferrer">
                            GitHub <span aria-hidden="true">↗</span>
                        </a>
                        <span className="chip chip--version">v0.1 · MVP</span>
                    </nav>
                </div>
            </header>

            <main id="top" className="wrap">
                <section className="hero">
                    <p className="eyebrow">PR Review · Intent vs. Implementation</p>
                    <h1 className="hero__title">
                        Does this pull request <em>actually</em> do what it says it does?
                    </h1>
                    <p className="hero__blurb">
                        Rubric is an AI code reviewer that checks whether a pull request&apos;s diff
                        delivers what its description claims. It extracts the concrete, checkable
                        claims from the PR description, then verifies each one against the real diff
                        — flagging missing, partial, or contradicted work, plus any unstated changes
                        the description never mentioned.
                    </p>
                </section>

                <hr className="rule" />

                <section className="legend" aria-label="Primitives">
                    <article className="legend__item">
                        <span className="legend__token">
                            <span className="pill pill--aligned">
                                <span className="pill__dot" aria-hidden="true" />
                                Claim
                            </span>
                        </span>
                        <h2 className="legend__title">Claim</h2>
                        <p className="legend__desc">
                            A discrete promise pulled from the PR description, checked against the
                            diff and marked implemented, partial, missing, or contradicted.
                        </p>
                    </article>
                    <article className="legend__item">
                        <span className="legend__token">
                            <span className="pill pill--partial">
                                <span className="pill__dot" aria-hidden="true" />
                                Unstated
                            </span>
                        </span>
                        <h2 className="legend__title">Unstated change</h2>
                        <p className="legend__desc">
                            Something the diff does that no claim accounts for, surfaced with a risk
                            level so silent behavior changes don&apos;t slip through.
                        </p>
                    </article>
                    <article className="legend__item">
                        <span className="legend__token">
                            <span className="pill pill--misaligned">
                                <span className="pill__dot" aria-hidden="true" />
                                Verdict
                            </span>
                        </span>
                        <h2 className="legend__title">Verdict</h2>
                        <p className="legend__desc">
                            One overall call — aligned, partially aligned, or misaligned — rolling
                            up every claim into a single answer to the headline question.
                        </p>
                    </article>
                </section>

                <section id="demo" className="demo" aria-label="Example review">
                    <div className="panel">
                        <div className="panel__chrome">
                            <div className="panel__chrome-left">
                                <span className="dotrow" aria-hidden="true">
                                    <i />
                                    <i />
                                    <i />
                                </span>
                                <code className="panel__repo">{selected.repo}</code>
                                <span className="panel__sep" aria-hidden="true">
                                    /
                                </span>
                                <code className="panel__branch">{selected.branch}</code>
                            </div>
                            <span className="panel__pr">#{selected.prNumber}</span>
                        </div>

                        <div className="panel__title">
                            <span className="panel__title-kicker">Pull request under review</span>
                            <p className="panel__title-text">{selected.prTitle}</p>
                        </div>

                        <div className="segmented" role="tablist" aria-label="Example review">
                            {fixtureOptions.map((option) => {
                                const active = option.id === selectedId;
                                return (
                                    <button
                                        key={option.id}
                                        type="button"
                                        role="tab"
                                        aria-selected={active}
                                        className={
                                            active
                                                ? "segmented__btn segmented__btn--active"
                                                : "segmented__btn"
                                        }
                                        onClick={() => setSelectedId(option.id)}
                                    >
                                        <span
                                            className={`seg-dot seg-dot--${VERDICT_TONE[option.review.verdict]}`}
                                            aria-hidden="true"
                                        />
                                        {option.label}
                                    </button>
                                );
                            })}
                        </div>

                        <ReviewCard review={selected.review} />
                    </div>
                </section>
            </main>

            <footer className="footer">
                <div className="footer__inner">
                    <a className="wordmark wordmark--sm" href="#top" aria-label="Rubric home">
                        <BracketMark className="wordmark__mark" />
                        <span className="wordmark__text">RUBRIC</span>
                    </a>
                    <p className="footer__line">
                        Does this pull request actually do what it says it does?
                    </p>
                    <div className="footer__links">
                        <a href={GITHUB_URL} target="_blank" rel="noreferrer">
                            GitHub <span aria-hidden="true">↗</span>
                        </a>
                        <span className="footer__credit">Built by Or Mizrahi</span>
                    </div>
                </div>
            </footer>
        </div>
    );
}

export default App;
