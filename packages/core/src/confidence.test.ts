import { describe, it, expect } from "vitest";
import { scoreSignal, SIGNAL_WEIGHTS } from "./confidence.js";
import type { ReviewContext } from "./context.js";
import type { Commit } from "./types.js";

function ctx(overrides: Partial<ReviewContext> = {}): ReviewContext {
    return {
        title: "fix: prevent double submit",
        body: "",
        linkedIssue: null,
        labels: [],
        commits: [],
        fileSummary: [],
        ...overrides,
    };
}

function commits(...messages: string[]): Commit[] {
    return messages.map((message, i) => ({ sha: `sha${i}`, message }));
}

function file(filename: string) {
    return { filename, status: "modified", additions: 1, deletions: 0 };
}

function earned(score: ReturnType<typeof scoreSignal>, key: string): number {
    return score.components.find((c) => c.key === key)!.earned;
}

describe("description component", () => {
    it("scores 0 for an empty body", () => {
        expect(earned(scoreSignal(ctx({ body: "   " })), "description")).toBe(0);
    });

    it("scales with length and saturates below the full weight", () => {
        expect(earned(scoreSignal(ctx({ body: "x".repeat(40) })), "description")).toBe(1);
        // Length alone saturates 10 short of the max; the rest is structure.
        const long = earned(scoreSignal(ctx({ body: "x".repeat(2000) })), "description");
        expect(long).toBe(SIGNAL_WEIGHTS.description - 10);
    });

    it("adds 5 for multiple paragraphs and 5 for a list", () => {
        const body = "First para.\n\nSecond para.\n\n- a bullet";
        const score = earned(scoreSignal(ctx({ body })), "description");
        expect(score).toBe(
            Math.min(SIGNAL_WEIGHTS.description - 10, Math.floor(body.trim().length / 40)) + 10,
        );
    });
});

describe("linkedIssue component", () => {
    it("is all-or-nothing", () => {
        expect(earned(scoreSignal(ctx()), "linkedIssue")).toBe(0);
        const linked = ctx({ linkedIssue: { number: 42, title: "t", body: "b" } });
        expect(earned(scoreSignal(linked), "linkedIssue")).toBe(SIGNAL_WEIGHTS.linkedIssue);
    });
});

describe("commits component", () => {
    it("ignores merges, short subjects, and generic messages", () => {
        const noise = commits("Merge branch 'main' into feature-branch", "wip", "fix", "update");
        expect(earned(scoreSignal(ctx({ commits: noise })), "commits")).toBe(0);
    });

    it("awards 5 per substantive commit and saturates at the full weight", () => {
        expect(
            earned(scoreSignal(ctx({ commits: commits("disable the submit button") })), "commits"),
        ).toBe(5);
        const many = commits(
            "disable the submit button",
            "show a spinner while in flight",
            "guard against repeat submissions",
            "add regression coverage for it",
            "document the new behaviour",
        );
        expect(earned(scoreSignal(ctx({ commits: many })), "commits")).toBe(SIGNAL_WEIGHTS.commits);
    });
});

describe("tests component", () => {
    it("is all-or-nothing on any test file", () => {
        expect(earned(scoreSignal(ctx({ fileSummary: [file("src/a.ts")] })), "tests")).toBe(0);
        const withTest = ctx({ fileSummary: [file("src/a.ts"), file("src/a.test.ts")] });
        expect(earned(scoreSignal(withTest), "tests")).toBe(SIGNAL_WEIGHTS.tests);
    });

    it("credits a bare test.js", () => {
        // slugify#73 changes index.js and test.js; scoring it 0 here understated
        // the signal and wrongly dropped the band to "low".
        const avaStyle = ctx({ fileSummary: [file("index.js"), file("test.js")] });
        expect(earned(scoreSignal(avaStyle), "tests")).toBe(SIGNAL_WEIGHTS.tests);
    });
});

describe("focus component", () => {
    it("steps down as changes scatter across top-level directories", () => {
        const dirs = (n: number) =>
            ctx({ fileSummary: Array.from({ length: n }, (_, i) => file(`dir${i}/a.ts`)) });
        expect(earned(scoreSignal(dirs(1)), "focus")).toBe(20);
        expect(earned(scoreSignal(dirs(2)), "focus")).toBe(15);
        expect(earned(scoreSignal(dirs(3)), "focus")).toBe(10);
        expect(earned(scoreSignal(dirs(4)), "focus")).toBe(5);
        expect(earned(scoreSignal(dirs(5)), "focus")).toBe(0);
    });

    it("treats an empty diff as focused", () => {
        expect(earned(scoreSignal(ctx()), "focus")).toBe(20);
    });
});

describe("total and band", () => {
    it("floors at 0 with no signal at all", () => {
        const score = scoreSignal(ctx());
        expect(score.total).toBe(20); // focus only
        expect(score.band).toBe("low");
    });

    it("bands on the documented thresholds", () => {
        const rich = ctx({
            body: "First paragraph with plenty of detail.\n\n- one\n- two\n\nAnd more.".repeat(12),
            linkedIssue: { number: 7, title: "t", body: "b" },
            commits: commits("disable the submit button", "show a spinner while in flight"),
            fileSummary: [file("src/a.ts"), file("src/a.test.ts")],
        });
        const score = scoreSignal(rich);
        expect(score.total).toBeGreaterThanOrEqual(80);
        expect(score.band).toBe("high");
    });

    it("does not band a well-described PR as low just for lacking an issue and tests", () => {
        // Regression for the calibration bug: vitest#7000, rubric#3 and rubric#4 all
        // carried thorough descriptions and were labelled low signal because linkedIssue
        // and tests are all-or-nothing and neither applies to a docs or CI change.
        // The description here is deliberately long enough to max its component — a
        // merely moderate one lands at 47 and "low" is a fair call for that.
        const documented = ctx({
            body: "A thorough description of what this changes and why.\n\nWith a second paragraph.\n\n- and a list\n- of points\n".repeat(
                8,
            ),
            commits: commits("explain exactly what changed here", "and a second real commit"),
            fileSummary: [file("docs/guide.md"), file("docs/other.md")],
        });
        const score = scoreSignal(documented);
        expect(earned(score, "linkedIssue")).toBe(0);
        expect(earned(score, "tests")).toBe(0);
        expect(score.band).not.toBe("low");
    });

    it("never exceeds 100", () => {
        const maxed = ctx({
            body: "x".repeat(5000) + "\n\npara two\n\n- list",
            linkedIssue: { number: 7, title: "t", body: "b" },
            commits: commits("a".repeat(30), "b".repeat(30), "c".repeat(30), "d".repeat(30)),
            fileSummary: [file("src/a.test.ts")],
        });
        expect(scoreSignal(maxed).total).toBeLessThanOrEqual(100);
    });
});
