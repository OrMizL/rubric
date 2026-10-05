import { useState } from "react";

import { ReviewCard } from "./ReviewCard";
import { fixtureOptions, type FixtureOption } from "./fixtures";
import type { Review } from "@rubric/core";

const GITHUB_URL = "https://github.com/OrMizL/rubric";

/** From docs/evaluation.md (run of 2026-10-05). Keep the two in sync. */
const RESULTS = [
    { test: "Honest pull requests wrongly called misaligned", result: "0 of 66", range: "0–5.5%" },
    {
        test: "Descriptions swapped with another project’s",
        result: "35 of 35 caught",
        range: "90–100%",
    },
    { test: "Code behind a stated promise deleted", result: "32 of 32 caught", range: "89–100%" },
    { test: "Unmentioned risky change slipped in", result: "17 of 17 caught", range: "82–100%" },
    { test: "False “no behavior change” added", result: "25 of 27 caught", range: "77–98%" },
    { test: "Real mismatches found in merged pull requests", result: "2", range: "—" },
];

const ACTION_SNIPPET = `# .github/workflows/rubric.yml
on: pull_request
permissions:
  contents: read
  pull-requests: write
jobs:
  review:
    runs-on: ubuntu-latest
    steps:
      - uses: OrMizL/rubric@v1
        with:
          anthropic-api-key: \${{ secrets.ANTHROPIC_API_KEY }}`;

const CLI_SNIPPET = `export ANTHROPIC_API_KEY=sk-ant-...
npx @ormizl/rubric scan unjs/h3#1513`;

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
    const [selectedId, setSelectedId] = useState<FixtureOption["id"]>("real");
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
                            Example
                        </a>
                        <a className="navlink" href="#results">
                            Results
                        </a>
                        <a className="navlink" href="#install">
                            Install
                        </a>
                        <a className="navlink" href={GITHUB_URL} target="_blank" rel="noreferrer">
                            GitHub <span aria-hidden="true">↗</span>
                        </a>
                        <span className="chip chip--version">v1.0</span>
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

                        {selected.note ? <p className="panel__note">{selected.note}</p> : null}
                        <ReviewCard review={selected.review} />
                    </div>
                </section>

                <section id="results" className="results" aria-labelledby="results-title">
                    <h2 id="results-title" className="section-title">
                        Measured, not promised
                    </h2>
                    <p className="section-lede">
                        We took 35 merged pull requests from 13 TypeScript and JavaScript projects
                        and broke each one in a known way: swapped its description, deleted the code
                        behind a promise, slipped in an unmentioned change. Then we checked whether
                        Rubric noticed.
                    </p>
                    <table className="results__table">
                        <thead>
                            <tr>
                                <th scope="col">Test</th>
                                <th scope="col">Result</th>
                                <th scope="col" className="results__range">
                                    95% range
                                </th>
                            </tr>
                        </thead>
                        <tbody>
                            {RESULTS.map((row) => (
                                <tr key={row.test}>
                                    <td>{row.test}</td>
                                    <td className="results__value">{row.result}</td>
                                    <td className="results__range">{row.range}</td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                    <p className="results__foot">
                        About $0.15 and 47 seconds per pull request. Rows hold 17 to 35 cases each,
                        so a perfect row means the real rate is probably above 85 to 90 percent, not
                        that Rubric never misses.{" "}
                        <a href={`${GITHUB_URL}/blob/main/docs/evaluation.md`}>
                            How this was measured
                        </a>
                    </p>
                </section>

                <section id="install" className="install" aria-labelledby="install-title">
                    <h2 id="install-title" className="section-title">
                        Use it
                    </h2>
                    <div className="install__grid">
                        <article className="install__item">
                            <h3 className="install__title">On your repository</h3>
                            <p className="install__desc">
                                A GitHub Action that reviews every pull request. It reports in the
                                job summary and only comments if you ask it to.
                            </p>
                            <pre className="code">
                                <code>{ACTION_SNIPPET}</code>
                            </pre>
                        </article>
                        <article className="install__item">
                            <h3 className="install__title">On any pull request</h3>
                            <p className="install__desc">
                                A read-only command line tool. It never writes to the PR, so it
                                works on repositories you don&apos;t own.
                            </p>
                            <pre className="code">
                                <code>{CLI_SNIPPET}</code>
                            </pre>
                        </article>
                    </div>
                    <p className="install__foot">Both need an Anthropic API key. MIT licensed.</p>
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
