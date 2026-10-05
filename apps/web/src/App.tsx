import { Redline } from "./Redline";
import { ReviewLedger } from "./ReviewLedger";
import { TerminalReplay } from "./TerminalReplay";
import { realCatchReview } from "./fixtures";
import { CAST_TOTAL_SECONDS } from "./cast";

const GITHUB_URL = "https://github.com/OrMizL/rubric";
const EVAL_URL = `${GITHUB_URL}/blob/main/docs/evaluation.md`;

/** From docs/evaluation.md (run of 2026-10-05). Keep the two in sync. */
const RESULTS = [
    { test: "Honest pull requests wrongly called misaligned", result: "0 / 66", range: "0–5.5%" },
    { test: "Descriptions swapped with another project’s", result: "35 / 35", range: "90–100%" },
    { test: "Code behind a stated promise deleted", result: "32 / 32", range: "89–100%" },
    { test: "Unmentioned risky change slipped in", result: "17 / 17", range: "82–100%" },
    { test: "False “no behavior change” added", result: "25 / 27", range: "77–98%" },
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
npx @ormizl/rubric scan owner/repo#123`;

/** A check inside a pair of brackets; the check is the one red stroke, like a grader's mark. */
function Mark({ className }: { className?: string }) {
    return (
        <svg
            className={className}
            viewBox="0 0 32 32"
            width="24"
            height="24"
            fill="none"
            strokeWidth="2.4"
            strokeLinecap="square"
            aria-hidden="true"
        >
            <path d="M11 7 H8 V25 H11 M21 7 H24 V25 H21" stroke="currentColor" />
            <path d="M12.5 16.5 L15 19 L20 12.5" stroke="var(--red)" />
        </svg>
    );
}

function Wordmark() {
    return (
        <a className="wordmark" href="#top" aria-label="Rubric home">
            <Mark />
            <span>RUBRIC</span>
        </a>
    );
}

const contradicted = realCatchReview.statedClaims.filter((c) => c.status === "contradicted").length;

export function App() {
    return (
        <div className="site">
            <header className="nav">
                <Wordmark />
                <nav aria-label="Primary">
                    <a href="#review">The review</a>
                    <a href="#results">Results</a>
                    <a href="#install">Install</a>
                    <a href={GITHUB_URL} target="_blank" rel="noreferrer">
                        GitHub
                    </a>
                </nav>
            </header>

            <main id="top">
                <section className="hero">
                    <h1 className="hero__title">Redline the pull request, not the code style.</h1>
                    <p className="hero__lede">
                        Rubric checks one thing: whether the diff does what the description says.
                        Every claim gets a verdict and a line of evidence, and anything the
                        description never mentions gets flagged.
                    </p>
                </section>

                <section className="catch" aria-label="A real catch">
                    <Redline />
                    <dl className="facts">
                        <div>
                            <dt>Verdict</dt>
                            <dd className="facts__bad">misaligned</dd>
                        </div>
                        <div>
                            <dt>Claims checked</dt>
                            <dd>{realCatchReview.statedClaims.length}</dd>
                        </div>
                        <div>
                            <dt>Contradicted</dt>
                            <dd>{contradicted}</dd>
                        </div>
                        <div>
                            <dt>Unmentioned changes</dt>
                            <dd>{realCatchReview.unstatedChanges.length}</dd>
                        </div>
                    </dl>
                    <p className="catch__caption">
                        A merged pull request, reviewed as it was merged. The design changed during
                        review; the description didn&apos;t. <a href="#review">Read the review</a>
                    </p>
                </section>

                <section id="review" className="section">
                    <div className="section__head">
                        <h2 className="section__title">Every claim, checked.</h2>
                        <p className="section__lede">
                            Rubric splits the title, description and linked issue into promises,
                            gives each one a verdict against the diff, and lists what changed
                            without being mentioned. Open any row for the reasoning.
                        </p>
                    </div>
                    <ReviewLedger />
                </section>

                <section id="results" className="section">
                    <div className="section__head">
                        <h2 className="section__title">Measured, not promised.</h2>
                        <p className="section__lede">
                            35 merged pull requests from 13 TypeScript and JavaScript projects, each
                            broken in a known way: description swapped, the code behind a promise
                            deleted, an unmentioned change slipped in. Then: did Rubric notice?
                        </p>
                    </div>
                    <table className="results">
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
                    <p className="section__foot">
                        About $0.15 and 47 seconds per pull request. Rows hold 17 to 35 cases each,
                        so a perfect row means the real rate is probably above 85 to 90 percent, not
                        that Rubric never misses. <a href={EVAL_URL}>How this was measured</a>
                    </p>
                </section>

                <section id="install" className="section">
                    <div className="section__head">
                        <h2 className="section__title">Run it on any pull request.</h2>
                        <p className="section__lede">
                            A read-only command line tool, or a GitHub Action that reports in the
                            job summary and only comments if you ask it to. Both need an Anthropic
                            API key. MIT licensed.
                        </p>
                    </div>
                    <div className="install">
                        <figure className="install__term">
                            <TerminalReplay />
                            <figcaption>
                                A real run, recorded October 5, 2026. Waits are sped up; it took{" "}
                                {Math.round(CAST_TOTAL_SECONDS)} seconds.
                            </figcaption>
                        </figure>
                        <div className="install__snippets">
                            <h3>On any pull request</h3>
                            <pre className="code">
                                <code>{CLI_SNIPPET}</code>
                            </pre>
                            <h3>On every pull request in your repository</h3>
                            <pre className="code">
                                <code>{ACTION_SNIPPET}</code>
                            </pre>
                        </div>
                    </div>
                </section>
            </main>

            <footer className="footer">
                <Wordmark />
                <p>Does the pull request do what it says?</p>
                <a href={GITHUB_URL} target="_blank" rel="noreferrer">
                    GitHub
                </a>
                <p>Built by Or Mizrahi</p>
            </footer>
        </div>
    );
}

export default App;
