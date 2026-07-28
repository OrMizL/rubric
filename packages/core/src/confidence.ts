import { isTestFile } from "./budget.js";
import type { FileSummary, ReviewContext } from "./context.js";
import type { Commit } from "./types.js";

/**
 * How much each mechanical signal contributes to the 0-100 score. These are
 * facts the code can check, not judgments: "is a title descriptive?" is a
 * judgment and deliberately has no weight here.
 *
 * The score gates a disclaimer saying expectations were inferred from thin
 * context, so it must measure how much intent the author *communicated*.
 * `linkedIssue` and `tests` are all-or-nothing facts about process rigour that
 * a docs or CI change can never earn — weighted at 20 each they were 40% of the
 * score, and every well-described docs PR was labelled low signal. Calibrated
 * against vitest#7000/#10807/#10734, rubric#3/#4 and slugify#73: only #10807
 * (empty body, generic commit) should band low, and only it does.
 */
export const SIGNAL_WEIGHTS = {
    description: 30,
    linkedIssue: 15,
    commits: 20,
    tests: 15,
    focus: 20,
} as const;

/** Below this, the review carries a low-signal disclaimer. */
export const LOW_SIGNAL_THRESHOLD = 50;
/** At or above this, context was rich enough to trust the inference. */
export const HIGH_SIGNAL_THRESHOLD = 80;

export type SignalKey = keyof typeof SIGNAL_WEIGHTS;

export interface SignalComponent {
    key: SignalKey;
    label: string;
    earned: number;
    max: number;
    /** Short human-readable reason for the number. */
    note: string;
}

export interface SignalScore {
    total: number;
    band: "high" | "medium" | "low";
    components: SignalComponent[];
}

// A commit subject shorter than this, or matching the generic list, tells us nothing.
const MIN_COMMIT_SUBJECT = 15;
const GENERIC_COMMIT_RE = /^(wip|fix|update|changes?|stuff|misc)\b/i;
const LIST_ITEM_RE = /^\s*([-*+]|\d+\.)\s+/m;
// Points per N characters of description, capped well below essay length.
const CHARS_PER_POINT = 40;
const MAX_LENGTH_POINTS = 20;

function scoreDescription(body: string): SignalComponent {
    const base = {
        key: "description" as const,
        label: "Description detail",
        max: SIGNAL_WEIGHTS.description,
    };
    const text = body.trim();
    if (text === "") return { ...base, earned: 0, note: "no description" };

    const length = Math.min(MAX_LENGTH_POINTS, Math.floor(text.length / CHARS_PER_POINT));
    const paragraphs = text.split(/\n\s*\n/).filter((p) => p.trim() !== "").length;
    const structure = (paragraphs >= 2 ? 5 : 0) + (LIST_ITEM_RE.test(text) ? 5 : 0);

    return {
        ...base,
        earned: length + structure,
        note: `${text.length} chars, ${paragraphs} paragraph(s)`,
    };
}

function scoreLinkedIssue(ctx: ReviewContext): SignalComponent {
    const linked = ctx.linkedIssue !== null;
    return {
        key: "linkedIssue",
        label: "Linked issue",
        earned: linked ? SIGNAL_WEIGHTS.linkedIssue : 0,
        max: SIGNAL_WEIGHTS.linkedIssue,
        note: linked ? `#${ctx.linkedIssue!.number}` : "none linked",
    };
}

/** A commit whose subject actually says something about the change. */
function isSubstantive(commit: Commit): boolean {
    const subject = (commit.message.split("\n", 1)[0] ?? "").trim();
    if (subject.startsWith("Merge ")) return false;
    if (subject.length < MIN_COMMIT_SUBJECT) return false;
    return !GENERIC_COMMIT_RE.test(subject);
}

function scoreCommits(commits: Commit[]): SignalComponent {
    const substantive = commits.filter(isSubstantive).length;
    return {
        key: "commits",
        label: "Commit quality",
        earned: Math.min(SIGNAL_WEIGHTS.commits, substantive * 5),
        max: SIGNAL_WEIGHTS.commits,
        note: `${substantive} of ${commits.length} commit(s) substantive`,
    };
}

function scoreTests(files: FileSummary[]): SignalComponent {
    const touched = files.some((f) => isTestFile(f.filename));
    return {
        key: "tests",
        label: "Tests touched",
        earned: touched ? SIGNAL_WEIGHTS.tests : 0,
        max: SIGNAL_WEIGHTS.tests,
        note: touched ? "test files changed" : "no test files changed",
    };
}

function topLevelDir(filename: string): string {
    const i = filename.indexOf("/");
    return i === -1 ? "." : filename.slice(0, i);
}

// Index is the count of distinct top-level directories; beyond the last entry, 0.
const FOCUS_POINTS = [20, 20, 15, 10, 5];

function scoreFocus(files: FileSummary[]): SignalComponent {
    const dirs = new Set(files.map((f) => topLevelDir(f.filename)));
    return {
        key: "focus",
        label: "Scope focus",
        earned: FOCUS_POINTS[dirs.size] ?? 0,
        max: SIGNAL_WEIGHTS.focus,
        note: `${dirs.size} top-level director${dirs.size === 1 ? "y" : "ies"} touched`,
    };
}

function bandFor(total: number): SignalScore["band"] {
    if (total >= HIGH_SIGNAL_THRESHOLD) return "high";
    if (total >= LOW_SIGNAL_THRESHOLD) return "medium";
    return "low";
}

/**
 * Score how much intent signal the PR actually carried. Pure and mechanical by
 * design: the model rates its own per-item confidence, but how much evidence
 * existed is a fact, so the code owns it.
 */
export function scoreSignal(ctx: ReviewContext): SignalScore {
    const components: SignalComponent[] = [
        scoreDescription(ctx.body),
        scoreLinkedIssue(ctx),
        scoreCommits(ctx.commits),
        scoreTests(ctx.fileSummary),
        scoreFocus(ctx.fileSummary),
    ];
    const total = components.reduce((sum, c) => sum + c.earned, 0);
    return { total, band: bandFor(total), components };
}
