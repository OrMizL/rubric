import { useState } from "react";

import { ReviewCard } from "./ReviewCard";
import { fixtureOptions, type FixtureOption } from "./fixtures";

export function App() {
    const [selectedId, setSelectedId] = useState<FixtureOption["id"]>("aligned");
    const selected =
        fixtureOptions.find((option) => option.id === selectedId) ?? fixtureOptions[0]!;

    return (
        <div className="page">
            <header className="page__header">
                <h1 className="hook">Does this pull request actually do what it says it does?</h1>
                <p className="blurb">
                    Rubric is an AI code reviewer that checks whether a pull request&apos;s diff
                    actually delivers what its description claims. It extracts the concrete,
                    checkable claims from the PR description, then verifies each one against the
                    real diff — flagging missing, partial, or contradicted work, plus any unstated
                    changes the description never mentioned.
                </p>
            </header>

            <main className="page__main">
                <div className="toggle" role="tablist" aria-label="Example review">
                    {fixtureOptions.map((option) => (
                        <button
                            key={option.id}
                            type="button"
                            role="tab"
                            aria-selected={option.id === selectedId}
                            className={
                                option.id === selectedId
                                    ? "toggle__button toggle__button--active"
                                    : "toggle__button"
                            }
                            onClick={() => setSelectedId(option.id)}
                        >
                            {option.label}
                        </button>
                    ))}
                </div>

                <ReviewCard review={selected.review} />
            </main>

            <footer className="page__footer">
                <a href="https://github.com/OrMizL/rubric" target="_blank" rel="noreferrer">
                    View Rubric on GitHub
                </a>
            </footer>
        </div>
    );
}

export default App;
