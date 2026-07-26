# Implied Spec Inference Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give Rubric a diff-blind inference stage that derives expected behavior from PR context (title, body, linked issue, commits, labels, file shapes), grades the diff against it alongside the stated claims, and reports a code-computed signal score for how much context was available.

**Architecture:** Two sequential Claude calls. Call 1 (`inferSpec`) sees a `ReviewContext` that structurally cannot contain patch text and returns an `ImpliedSpec`. Call 2 (the existing review call) grades the diff against both the stated intent and that spec. A pure `scoreSignal()` computes a 0–100 signal score from mechanical facts only. Provenance, truncation, and the signal score are all code-owned and attached after the model returns.

**Tech Stack:** TypeScript ESM, pnpm workspace, `@anthropic-ai/sdk` (`messages.parse` + `zodOutputFormat`), Zod 4, `@octokit/rest`, Vitest, tsup.

**Design spec:** `docs/superpowers/specs/2026-07-26-implied-spec-inference-design.md`

## Global Constraints

- Node ≥ 20. pnpm workspace; run commands with `pnpm --filter <pkg>`.
- Prettier: 4-space indent, 100 columns, double quotes, trailing commas. Run `pnpm format` before every commit.
- TypeScript `strict` + `noUncheckedIndexedAccess` — indexed access yields `T | undefined`; use `!` or an explicit guard.
- Relative imports MUST carry the `.js` extension (`./context.js`, not `./context`).
- Build order is mandatory: `pnpm -r build && pnpm -r typecheck && pnpm -r test`. Typecheck fails without a built `dist/` because dependents consume `@rubric/core`'s compiled declarations.
- **Every task must end with the repo green** — all three commands above pass. Do not leave a task with a broken build.
- Comments explain _why_, not _what_. Match the density in `budget.ts`.
- Never let the model self-report a mechanical fact. `truncated`, `signalScore`, `inference`, and claim provenance are all set by code after the model returns.
- Do not commit `.env`. Do not run the paid manual scripts unless a task explicitly says to.

---

### Task 1: Fetch commits and labels

**Files:**

- Modify: `packages/core/src/types.ts`
- Modify: `packages/core/src/github.ts:35-97`
- Modify: `packages/core/scripts/try-github.ts`

**Interfaces:**

- Consumes: nothing (first task).
- Produces: `interface Commit { sha: string; message: string }`; `PullRequestData` gains `labels: string[]` and `commits: Commit[]`; `GitHubClient.getCommits(owner, repo, number): Promise<Commit[]>`.

`github.ts` has no unit tests today because `GitHubClient` constructs its own `Octokit` internally and there is no injection seam. Do not add one — follow the existing pattern and verify with the manual script in Step 4.

- [ ] **Step 1: Add the `Commit` type and extend `PullRequestData`**

In `packages/core/src/types.ts`, add after the `LinkedIssue` interface:

```ts
/** One commit on the PR branch. Only the message carries review signal. */
export interface Commit {
  sha: string;
  message: string;
}
```

Then add two fields to `PullRequestData`, after `linkedIssue`:

```ts
    /** Label names attached to the PR. */
    labels: string[];
    /** Commits on the PR branch, capped at MAX_COMMITS (newest page from GitHub). */
    commits: Commit[];
```

- [ ] **Step 2: Add `getCommits` and surface labels**

In `packages/core/src/github.ts`, add `Commit` to the type import from `./types.js`. Add this constant just below `LINKED_ISSUE_RE`:

```ts
// One page is the cap: commit messages are a signal, not the payload. A PR with
// more than 100 commits gets the first page, which is plenty to judge intent.
const MAX_COMMITS = 100;
```

Change the `getPullRequest` return type to also omit `commits`, and return `labels`:

```ts
    async getPullRequest(
        owner: string,
        repo: string,
        number: number,
    ): Promise<
        Omit<PullRequestData, "linkedIssue" | "files" | "commits" | "owner" | "repo" | "number">
    > {
        const { data } = await this.octokit.pulls.get({ owner, repo, pull_number: number });
        return {
            title: data.title,
            body: data.body ?? "",
            baseRef: data.base.ref,
            headRef: data.head.ref,
            headSha: data.head.sha,
            labels: data.labels.map((l) => l.name),
        };
    }
```

Add this method after `getFiles`:

```ts
    /** Commit messages on the PR branch. A single page is requested, so this caps at MAX_COMMITS. */
    async getCommits(owner: string, repo: string, number: number): Promise<Commit[]> {
        const { data } = await this.octokit.pulls.listCommits({
            owner,
            repo,
            pull_number: number,
            per_page: MAX_COMMITS,
        });
        return data.map((c) => ({ sha: c.sha, message: c.commit.message }));
    }
```

- [ ] **Step 3: Thread commits through `getPullRequestData`**

Replace the body of `getPullRequestData` with:

```ts
const pr = await this.getPullRequest(owner, repo, number);
const [linkedIssue, files, commits] = await Promise.all([
  this.getLinkedIssue(owner, repo, pr.body),
  this.getFiles(owner, repo, number),
  // Commits are a nice-to-have signal; a failure here must not sink the review.
  this.getCommits(owner, repo, number).catch(() => [] as Commit[]),
]);
return { owner, repo, number, ...pr, linkedIssue, files, commits };
```

- [ ] **Step 4: Verify against a real PR**

Append to the output block in `packages/core/scripts/try-github.ts`, just before the `files` loop:

```ts
console.log(`  labels: ${data.labels.length > 0 ? data.labels.join(", ") : "none"}`);
console.log(`  commits (${data.commits.length}):`);
for (const c of data.commits) {
  console.log(`    ${c.sha.slice(0, 7)} ${c.message.split("\n", 1)[0]}`);
}
```

Run: `GITHUB_TOKEN=$(gh auth token) pnpm exec tsx packages/core/scripts/try-github.ts`
Expected: prints labels and a list of commit subjects for `sindresorhus/slugify#75`. This script is free — it makes no Anthropic call.

- [ ] **Step 5: Verify the repo is green and commit**

```bash
pnpm format
pnpm -r build && pnpm -r typecheck && pnpm -r test
git add packages/core/src/types.ts packages/core/src/github.ts packages/core/scripts/try-github.ts
git commit -m "feat(core): fetch PR commits and labels"
```

---

### Task 2: `context.ts` — gather context, enforce diff-blindness

**Files:**

- Create: `packages/core/src/context.ts`
- Create: `packages/core/src/context.test.ts`

**Interfaces:**

- Consumes: `PullRequestData`, `ChangedFile`, `Commit`, `LinkedIssue` from `./types.js` (Task 1).
- Produces: `interface FileSummary { filename, status, additions, deletions }`; `interface ReviewContext { title, body, linkedIssue, labels, commits, fileSummary }`; `summarizeFiles(files: ChangedFile[]): FileSummary[]`; `gatherContext(pr: PullRequestData): ReviewContext`.

- [ ] **Step 1: Write the failing tests**

Create `packages/core/src/context.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { gatherContext, summarizeFiles } from "./context.js";
import type { ChangedFile, PullRequestData } from "./types.js";

function pr(overrides: Partial<PullRequestData> = {}): PullRequestData {
  return {
    owner: "o",
    repo: "r",
    number: 1,
    title: "fix: prevent double submit",
    body: "Body text.",
    baseRef: "main",
    headRef: "fix/double-submit",
    headSha: "abc123",
    linkedIssue: null,
    labels: ["bug"],
    commits: [{ sha: "deadbee", message: "prevent double submit on the form" }],
    files: [
      {
        filename: "src/submit.tsx",
        status: "modified",
        additions: 12,
        deletions: 3,
        patch: "@@ -1,3 +1,12 @@\n+const SECRET_IMPLEMENTATION = true;",
      },
    ],
    ...overrides,
  };
}

describe("summarizeFiles", () => {
  it("strips the patch from every file", () => {
    const files: ChangedFile[] = [
      { filename: "a.ts", status: "modified", additions: 1, deletions: 0, patch: "@@ x" },
    ];
    const summary = summarizeFiles(files);
    expect(summary).toEqual([{ filename: "a.ts", status: "modified", additions: 1, deletions: 0 }]);
    expect(Object.keys(summary[0]!)).not.toContain("patch");
  });
});

describe("gatherContext", () => {
  it("carries intent, labels, and commits through", () => {
    const ctx = gatherContext(pr());
    expect(ctx.title).toBe("fix: prevent double submit");
    expect(ctx.labels).toEqual(["bug"]);
    expect(ctx.commits).toHaveLength(1);
    expect(ctx.fileSummary).toHaveLength(1);
  });

  it("never exposes patch text anywhere in the context", () => {
    const ctx = gatherContext(pr());
    expect(JSON.stringify(ctx)).not.toContain("SECRET_IMPLEMENTATION");
    expect(JSON.stringify(ctx)).not.toContain("@@");
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm --filter @rubric/core exec vitest run src/context.test.ts`
Expected: FAIL — cannot resolve `./context.js`.

- [ ] **Step 3: Write the implementation**

Create `packages/core/src/context.ts`:

```ts
import type { ChangedFile, Commit, LinkedIssue, PullRequestData } from "./types.js";

/**
 * A changed file with its patch removed. The absent `patch` field is the whole
 * point: the inference stage reasons from the shape of a change, never from its
 * implementation, and a type that cannot hold a patch cannot leak one.
 */
export interface FileSummary {
  filename: string;
  status: string;
  additions: number;
  deletions: number;
}

/** Everything the diff-blind inference stage is allowed to see. */
export interface ReviewContext {
  title: string;
  body: string;
  linkedIssue: LinkedIssue | null;
  labels: string[];
  commits: Commit[];
  fileSummary: FileSummary[];
}

/** Drop patches, keeping only the shape of each change. */
export function summarizeFiles(files: ChangedFile[]): FileSummary[] {
  return files.map(({ filename, status, additions, deletions }) => ({
    filename,
    status,
    additions,
    deletions,
  }));
}

/** Reshape fetched PR data into the context inference and scoring both read. */
export function gatherContext(pr: PullRequestData): ReviewContext {
  return {
    title: pr.title,
    body: pr.body,
    linkedIssue: pr.linkedIssue,
    labels: pr.labels,
    commits: pr.commits,
    fileSummary: summarizeFiles(pr.files),
  };
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm --filter @rubric/core exec vitest run src/context.test.ts`
Expected: PASS, 3 tests.

- [ ] **Step 5: Verify the repo is green and commit**

```bash
pnpm format
pnpm -r build && pnpm -r typecheck && pnpm -r test
git add packages/core/src/context.ts packages/core/src/context.test.ts
git commit -m "feat(core): add gatherContext with type-enforced diff blindness"
```

---

### Task 3: `confidence.ts` — deterministic signal score

**Files:**

- Modify: `packages/core/src/budget.ts:54-82`
- Create: `packages/core/src/confidence.ts`
- Create: `packages/core/src/confidence.test.ts`

**Interfaces:**

- Consumes: `ReviewContext`, `FileSummary` from `./context.js` (Task 2).
- Produces: `isTestFile(filename: string): boolean` exported from `./budget.js`; `SIGNAL_WEIGHTS`, `LOW_SIGNAL_THRESHOLD = 60`, `HIGH_SIGNAL_THRESHOLD = 80`; types `SignalKey`, `SignalComponent { key, label, earned, max, note }`, `SignalScore { total, band, components }`; `scoreSignal(ctx: ReviewContext): SignalScore`.

- [ ] **Step 1: Extract `isTestFile` from `budget.ts`**

In `packages/core/src/budget.ts`, add above `category()`:

```ts
/** True for test/spec files. Exported so signal scoring shares one definition. */
export function isTestFile(filename: string): boolean {
  const name = basename(filename);
  return (
    /(^|\/)(__tests__|tests?|spec|__mocks__)\//.test(filename) ||
    /\.(test|spec)\.[cm]?[jt]sx?$/.test(name)
  );
}
```

Then replace the tests branch inside `category()` with:

```ts
if (isTestFile(filename)) {
  return 2; // tests
}
```

Run: `pnpm --filter @rubric/core exec vitest run src/budget.test.ts`
Expected: PASS — this is a pure extraction, existing ranking tests must not change.

- [ ] **Step 2: Write the failing tests**

Create `packages/core/src/confidence.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { scoreSignal } from "./confidence.js";
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

  it("scales with length and saturates at 15", () => {
    expect(earned(scoreSignal(ctx({ body: "x".repeat(40) })), "description")).toBe(1);
    expect(earned(scoreSignal(ctx({ body: "x".repeat(2000) })), "description")).toBe(15);
  });

  it("adds 5 for multiple paragraphs and 5 for a list", () => {
    const body = "First para.\n\nSecond para.\n\n- a bullet";
    const score = earned(scoreSignal(ctx({ body })), "description");
    expect(score).toBe(Math.min(15, Math.floor(body.trim().length / 40)) + 10);
  });
});

describe("linkedIssue component", () => {
  it("is all-or-nothing", () => {
    expect(earned(scoreSignal(ctx()), "linkedIssue")).toBe(0);
    const linked = ctx({ linkedIssue: { number: 42, title: "t", body: "b" } });
    expect(earned(scoreSignal(linked), "linkedIssue")).toBe(20);
  });
});

describe("commits component", () => {
  it("ignores merges, short subjects, and generic messages", () => {
    const noise = commits("Merge branch 'main' into feature-branch", "wip", "fix", "update");
    expect(earned(scoreSignal(ctx({ commits: noise })), "commits")).toBe(0);
  });

  it("awards 5 per substantive commit and saturates at 15", () => {
    expect(
      earned(scoreSignal(ctx({ commits: commits("disable the submit button") })), "commits"),
    ).toBe(5);
    const many = commits(
      "disable the submit button",
      "show a spinner while in flight",
      "guard against repeat submissions",
      "add regression coverage for it",
    );
    expect(earned(scoreSignal(ctx({ commits: many })), "commits")).toBe(15);
  });
});

describe("tests component", () => {
  it("is all-or-nothing on any test file", () => {
    expect(earned(scoreSignal(ctx({ fileSummary: [file("src/a.ts")] })), "tests")).toBe(0);
    const withTest = ctx({ fileSummary: [file("src/a.ts"), file("src/a.test.ts")] });
    expect(earned(scoreSignal(withTest), "tests")).toBe(20);
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
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `pnpm --filter @rubric/core exec vitest run src/confidence.test.ts`
Expected: FAIL — cannot resolve `./confidence.js`.

- [ ] **Step 4: Write the implementation**

Create `packages/core/src/confidence.ts`:

```ts
import { isTestFile } from "./budget.js";
import type { FileSummary, ReviewContext } from "./context.js";
import type { Commit } from "./types.js";

/**
 * How much each mechanical signal contributes to the 0-100 score. These are
 * facts the code can check, not judgments: "is a title descriptive?" is a
 * judgment and deliberately has no weight here.
 */
export const SIGNAL_WEIGHTS = {
  description: 25,
  linkedIssue: 20,
  commits: 15,
  tests: 20,
  focus: 20,
} as const;

/** Below this, the review carries a low-signal disclaimer. */
export const LOW_SIGNAL_THRESHOLD = 60;
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
const MAX_LENGTH_POINTS = 15;

function scoreDescription(body: string): SignalComponent {
  const base = { key: "description" as const, label: "Description detail", max: 25 };
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
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `pnpm --filter @rubric/core exec vitest run src/confidence.test.ts`
Expected: PASS, 12 tests.

- [ ] **Step 6: Verify the repo is green and commit**

```bash
pnpm format
pnpm -r build && pnpm -r typecheck && pnpm -r test
git add packages/core/src/budget.ts packages/core/src/confidence.ts packages/core/src/confidence.test.ts
git commit -m "feat(core): add deterministic signal scoring"
```

---

### Task 4: Rewire the pipeline around `ReviewContext` and `SignalScore`

This is the breaking task. `ReviewSchema` splits into a model-facing half and code-owned fields, `reviewPullRequest` changes signature, and every consumer updates in the same commit. **No inference yet** — `inferredClaims` is introduced as an always-empty array so the shape settles once.

**Files:**

- Modify: `packages/core/src/schema.ts`
- Modify: `packages/core/src/engine.ts`
- Modify: `packages/core/src/render.ts`
- Modify: `packages/core/src/render.test.ts`
- Modify: `packages/core/src/index.ts`
- Modify: `packages/core/src/__fixtures__/slugify-73.review.json`
- Modify: `packages/core/src/__fixtures__/slugify-73-misaligned.review.json`
- Modify: `packages/cli/src/run.ts:136-172`
- Modify: `packages/cli/src/terminal.ts:74-83`
- Modify: `packages/action/src/main.ts:32-56`
- Modify: `apps/web/src/ReviewCard.tsx:91-140`

**Interfaces:**

- Consumes: `ReviewContext` (Task 2), `scoreSignal`/`SignalScore` (Task 3).
- Produces: `ReviewOutputSchema` (model-facing); `ReviewSchema = ReviewOutputSchema + { truncated, signalScore, inference }`; `InferenceStatus { ran: boolean; reason?: string }`; `Review["statedClaims"]`, `Review["inferredClaims"]`; `reviewPullRequest(context: ReviewContext, files: ChangedFile[], opts: EngineOptions): Promise<Review>`.

- [ ] **Step 1: Split the schema**

In `packages/core/src/schema.ts`, add `source` to nothing yet, but add these below `UnstatedChangeSchema`:

```ts
/** An expected behavior the model derived from context, then graded. */
export const InferredClaimSchema = ClaimSchema.extend({
  confidence: z
    .enum(["high", "medium", "low"])
    .describe("How directly the PR context supports this expectation"),
  kind: z.enum(["behavior", "edge_case", "acceptance"]),
});
export type InferredClaim = z.infer<typeof InferredClaimSchema>;

/** One mechanical signal and what it contributed to the score. */
export const SignalComponentSchema = z.object({
  key: z.enum(["description", "linkedIssue", "commits", "tests", "focus"]),
  label: z.string(),
  earned: z.number(),
  max: z.number(),
  note: z.string(),
});

export const SignalScoreSchema = z.object({
  total: z.number(),
  band: z.enum(["high", "medium", "low"]),
  components: z.array(SignalComponentSchema),
});

/** Whether the inference stage ran, and why not when it didn't. */
export const InferenceStatusSchema = z.object({
  ran: z.boolean(),
  reason: z.string().optional(),
});
export type InferenceStatus = z.infer<typeof InferenceStatusSchema>;
```

Now replace `ReviewSchema` with the split pair:

```ts
/**
 * The half of the review the model produces. Kept separate from ReviewSchema so
 * the model is never asked for facts the code already knows — asking it for
 * `truncated` or a signal breakdown invites it to invent them.
 */
export const ReviewOutputSchema = z.object({
  verdict: z.enum(["aligned", "partially_aligned", "misaligned"]),
  summary: z.string().describe("2-3 sentence overall assessment"),
  statedClaims: z.array(ClaimSchema).describe("Claims the PR description makes explicitly"),
  inferredClaims: z
    .array(InferredClaimSchema)
    .describe("Expected behaviors derived from context, graded against the diff"),
  unstatedChanges: z.array(UnstatedChangeSchema),
});
export type ReviewOutput = z.infer<typeof ReviewOutputSchema>;

/** The full review: the model's judgment plus the facts the code owns. */
export const ReviewSchema = ReviewOutputSchema.extend({
  truncated: z.boolean().describe("true if the diff was truncated to fit budget"),
  signalScore: SignalScoreSchema,
  inference: InferenceStatusSchema,
});
export type Review = z.infer<typeof ReviewSchema>;
```

- [ ] **Step 2: Rewire the engine**

In `packages/core/src/engine.ts`, replace the imports of `ReviewSchema`/`Review` with:

```ts
import { ReviewOutputSchema, type InferenceStatus, type Review } from "./schema.js";
import { scoreSignal } from "./confidence.js";
import type { ReviewContext } from "./context.js";
```

Delete the `ReviewInput` interface entirely. Replace the signature and body of `reviewPullRequest`:

```ts
export async function reviewPullRequest(
  context: ReviewContext,
  files: ChangedFile[],
  opts: EngineOptions,
): Promise<Review> {
  const model = opts.model ?? DEFAULT_MODEL;
  const maxDiffTokens = opts.maxDiffTokens ?? DEFAULT_MAX_DIFF_TOKENS;
  const log = opts.logger ?? ((m: string) => console.error(`[rubric] ${m}`));

  const client = new Anthropic({ apiKey: opts.anthropicApiKey });
  const system = buildSystemPrompt();
  const signalScore = scoreSignal(context);
  log(`signal score: ${signalScore.total}/100 (${signalScore.band})`);

  const countTokens = async (text: string): Promise<number> => {
    const { input_tokens } = await client.messages.countTokens({
      model,
      messages: [{ role: "user", content: text }],
    });
    return input_tokens;
  };

  const ranked = rankFiles(filterFiles(files));
  const budget = await truncateToBudget(ranked, maxDiffTokens, countTokens);
  if (budget.truncated) {
    log(`diff truncated: kept ${budget.files.length} file(s), omitted ${budget.omitted.length}`);
  }

  const user = buildUserPrompt({
    title: context.title,
    body: context.body,
    linkedIssue: context.linkedIssue,
    diffText: budget.diffText,
    truncated: budget.truncated,
  });

  const { input_tokens } = await client.messages.countTokens({
    model,
    system,
    messages: [{ role: "user", content: user }],
  });
  log(`assembled prompt: ${input_tokens} input tokens (diff budget ${maxDiffTokens})`);

  const response = await client.messages.parse({
    model,
    max_tokens: opts.maxOutputTokens ?? DEFAULT_MAX_OUTPUT_TOKENS,
    thinking: { type: "adaptive" },
    system,
    messages: [{ role: "user", content: user }],
    output_config: { format: zodOutputFormat(ReviewOutputSchema) },
  });

  if (!response.parsed_output) {
    throw new Error(`Review parse failed (stop_reason: ${response.stop_reason})`);
  }

  // Inference lands in Task 6; until then the stage is simply off.
  const inference: InferenceStatus = { ran: false, reason: "not enabled" };
  return {
    ...response.parsed_output,
    inferredClaims: [],
    truncated: budget.truncated,
    signalScore,
    inference,
  };
}
```

Keep `ChangedFile` in the type import from `./types.js` and drop `LinkedIssue` if now unused.

- [ ] **Step 3: Update the renderer**

In `packages/core/src/render.ts`, add below `RISK_EMOJI`:

```ts
/** Stated and inferred claims render as one table; provenance is a column. */
function allClaims(review: Review): Array<Claim | InferredClaim> {
  return [...review.statedClaims, ...review.inferredClaims];
}

function isInferred(claim: Claim | InferredClaim): claim is InferredClaim {
  return "confidence" in claim;
}
```

Import `InferredClaim` alongside `Claim`/`Review`. Replace `claimsTable`:

```ts
function claimsTable(review: Review, ctx: RenderContext): string {
  const claims = allClaims(review);
  if (claims.length === 0) return "_No checkable claims were identified._";

  // Omit the Source column entirely when nothing was inferred, so --no-infer
  // output stays byte-identical to pre-inference Rubric.
  const showSource = review.inferredClaims.length > 0;
  const header = showSource
    ? "| | Claim | Source | Evidence |\n|:--:|---|---|---|"
    : "| | Claim | Evidence |\n|:--:|---|---|";

  const rows = claims.map((c) => {
    const cells = [STATUS_EMOJI[c.status], cell(c.text)];
    if (showSource) {
      cells.push(isInferred(c) ? `inferred · ${c.confidence.toUpperCase()}` : "stated");
    }
    cells.push(evidenceLinks(c, ctx));
    return `| ${cells.join(" | ")} |`;
  });
  return [header, ...rows].join("\n");
}
```

Add a signal-score renderer above `reviewToMarkdown`:

```ts
/** Footer line summarizing the code-computed signal score. */
function signalLine(review: Review): string {
  const weakest = [...review.signalScore.components]
    .filter((c) => c.earned < c.max)
    .sort((a, b) => a.earned - b.earned)
    .slice(0, 2)
    .map((c) => c.note);
  const detail = weakest.length > 0 ? ` — ${weakest.join(", ")}` : "";
  return `Signal ${review.signalScore.total}/100${detail}`;
}
```

In `reviewToMarkdown`, replace the claims line and extend the footer:

```ts
parts.push(`### Claims\n\n${claimsTable(review, ctx)}`);
```

and replace the final footer push with:

```ts
const tokenNote = ctx.inputTokens !== undefined ? ` · ${ctx.inputTokens} input tokens` : "";
// The signal score calibrates trust in inferred content; with nothing inferred
// there is nothing to calibrate, so it stays hidden.
const signalNote = review.inference.ran ? ` · ${signalLine(review)}` : "";
parts.push(`---\n<sub>Reviewed by Rubric · \`${ctx.model}\`${signalNote}${tokenNote}</sub>`);
```

- [ ] **Step 4: Migrate the fixtures, then fix the one test literal**

`render.test.ts` does not build `Review` objects inline — it imports both fixtures and casts them (`alignedJson as unknown as Review`). The cast means TypeScript will not catch a stale fixture, but every test will crash at runtime on `undefined.statedClaims`. So the fixtures must be migrated **before** the tests are run.

In both `packages/core/src/__fixtures__/slugify-73.review.json` and `slugify-73-misaligned.review.json`, rename the `"claims"` key to `"statedClaims"` and add these three keys at the top level (Task 9 replaces these placeholder values with real captured runs):

```json
  "inferredClaims": [],
  "signalScore": { "total": 0, "band": "low", "components": [] },
  "inference": { "ran": false, "reason": "fixture predates inference" }
```

There is exactly one inline `Review` literal in the test file, at `packages/core/src/render.test.ts:85-96`. Rename its `claims:` key to `statedClaims:`. It spreads `...aligned`, so it inherits the other three new fields and needs no further change.

Run: `pnpm --filter @rubric/core exec vitest run src/render.test.ts`
Expected: PASS with **no assertion changes**. With `inferredClaims` empty the rendered output is byte-identical to pre-task output. If an assertion fails, the Source-column suppression or the signal-line suppression is wrong — fix the renderer, never the assertion.

- [ ] **Step 5: Update exports**

In `packages/core/src/index.ts`, extend the `./schema.js` export block with `InferredClaimSchema`, `ReviewOutputSchema`, `SignalScoreSchema`, `InferenceStatusSchema`, and types `InferredClaim`, `ReviewOutput`, `InferenceStatus`. Add:

```ts
export { gatherContext, summarizeFiles, type FileSummary, type ReviewContext } from "./context.js";

export {
  scoreSignal,
  SIGNAL_WEIGHTS,
  LOW_SIGNAL_THRESHOLD,
  HIGH_SIGNAL_THRESHOLD,
  type SignalKey,
  type SignalComponent,
  type SignalScore,
} from "./confidence.js";

export { type Commit } from "./types.js";
```

Remove `type ReviewInput` from the `./engine.js` export block.

- [ ] **Step 6: Update the CLI and Action call sites**

In `packages/cli/src/run.ts`, add `gatherContext` to the `@rubric/core` import and replace the review call:

```ts
const pr = await gh.getPullRequestData(target.owner, target.repo, target.number);
headSha = pr.headSha;
review = await reviewPullRequest(gatherContext(pr), pr.files, {
  anthropicApiKey: apiKey,
  model,
  maxDiffTokens: args.maxDiffTokens,
});
```

In `packages/cli/src/terminal.ts`, replace the three `review.claims` references in `renderTerminal` with a local:

```ts
    const claims = [...review.statedClaims, ...review.inferredClaims];
    lines.push(c.bold("Claims:"));
    if (claims.length === 0) {
        lines.push(c.dim("  (no checkable claims identified)"));
    }
    for (const claim of claims) {
```

In `packages/action/src/main.ts`, add `gatherContext` to the import and replace the review call:

```ts
const review = await reviewPullRequest(gatherContext(data), data.files, {
  anthropicApiKey: apiKey,
  model,
  maxDiffTokens,
  logger: (m) => core.info(m),
});
```

- [ ] **Step 7: Update the web demo**

In `apps/web/src/ReviewCard.tsx`, add near the top of the component body:

```tsx
const claims = [...review.statedClaims, ...review.inferredClaims];
```

Replace all four `review.claims` references (the count badge at line 91, the empty check at line 94, and the two `.map()` calls at lines 108 and 129) with `claims`.

- [ ] **Step 8: Verify everything is green and commit**

```bash
pnpm format
pnpm -r build && pnpm -r typecheck && pnpm -r test
git add -A
git commit -m "refactor(core): thread ReviewContext and signal score through the pipeline"
```

Expected: all packages build, typecheck, and test clean. `render.test.ts` assertions unchanged.

---

### Task 5: `infer.ts` — the diff-blind inference stage

Built and tested as a standalone module; wired in by Task 6.

**Files:**

- Create: `packages/core/src/infer.ts`
- Create: `packages/core/src/infer.test.ts`

**Interfaces:**

- Consumes: `ReviewContext` (Task 2).
- Produces: `SpecItemSchema`, `ImpliedSpecSchema`, types `SpecItem`, `ImpliedSpec`; `buildInferSystemPrompt(): string`; `buildInferUserPrompt(ctx: ReviewContext): string`; `inferSpec(ctx: ReviewContext, opts: InferOptions): Promise<ImpliedSpec>` where `InferOptions = { client: Anthropic; model: string; maxOutputTokens?: number }`.

- [ ] **Step 1: Write the failing tests**

Create `packages/core/src/infer.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { buildInferSystemPrompt, buildInferUserPrompt } from "./infer.js";
import type { ReviewContext } from "./context.js";

const ctx: ReviewContext = {
  title: "fix: prevent double-click on submit button",
  body: "Users could submit twice.",
  linkedIssue: { number: 42, title: "Double submissions", body: "Reported by support." },
  labels: ["bug"],
  commits: [{ sha: "abc1234", message: "disable submit while the request is in flight" }],
  fileSummary: [
    { filename: "src/submit.tsx", status: "modified", additions: 12, deletions: 3 },
    { filename: "src/submit.test.tsx", status: "added", additions: 40, deletions: 0 },
  ],
};

describe("buildInferUserPrompt", () => {
  it("includes intent, issue, commits, labels, and file shapes", () => {
    const prompt = buildInferUserPrompt(ctx);
    expect(prompt).toContain("fix: prevent double-click on submit button");
    expect(prompt).toContain("#42");
    expect(prompt).toContain("disable submit while the request is in flight");
    expect(prompt).toContain("bug");
    expect(prompt).toContain("src/submit.tsx");
    expect(prompt).toContain("+12/-3");
  });

  it("carries no patch text — diff blindness is the point", () => {
    const prompt = buildInferUserPrompt(ctx);
    expect(prompt).not.toContain("@@");
    expect(prompt).not.toContain("<diff>");
  });

  it("handles an empty description and no linked issue", () => {
    const thin = { ...ctx, body: "  ", linkedIssue: null, labels: [], commits: [] };
    const prompt = buildInferUserPrompt(thin);
    expect(prompt).toContain("(no description provided)");
    expect(prompt).not.toContain("Linked issue");
  });
});

describe("buildInferSystemPrompt", () => {
  it("tells the model it cannot see the code", () => {
    const system = buildInferSystemPrompt();
    expect(system.toLowerCase()).toContain("you will not see the code");
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm --filter @rubric/core exec vitest run src/infer.test.ts`
Expected: FAIL — cannot resolve `./infer.js`.

- [ ] **Step 3: Write the implementation**

Create `packages/core/src/infer.ts`:

```ts
import type Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { z } from "zod";
import type { ReviewContext } from "./context.js";

/** One expected behavior derived from PR context, before any code is seen. */
export const SpecItemSchema = z.object({
  text: z.string().describe("A single expected behavior, stated concretely"),
  kind: z.enum(["behavior", "edge_case", "acceptance"]),
  confidence: z
    .enum(["high", "medium", "low"])
    .describe("How directly the PR context supports this expectation"),
});
export type SpecItem = z.infer<typeof SpecItemSchema>;

export const ImpliedSpecSchema = z.object({
  items: z.array(SpecItemSchema),
});
export type ImpliedSpec = z.infer<typeof ImpliedSpecSchema>;

export interface InferOptions {
  client: Anthropic;
  model: string;
  maxOutputTokens?: number;
}

export const DEFAULT_INFER_MAX_OUTPUT_TOKENS = 4_000;

const INFER_SYSTEM_PROMPT = `You are Rubric's spec-inference stage. Given only a pull request's stated intent and the shape of its changes, describe what the finished change should do.

You will not see the code. You are given file names, statuses, and line counts, but never the diff itself. Do not speculate about how something is implemented — describe only observable expected behavior. If the context does not support a claim, either omit it or mark it low confidence.

Produce a flat list of items across three kinds:
- behavior: the happy path. What should be true once this change works.
- edge_case: what should happen in unusual or failure situations the intent implies.
- acceptance: how a reviewer could verify the change is complete.

Rate each item's confidence by how directly the context supports it:
- high: stated outright in the title, description, or linked issue.
- medium: a normal, near-certain consequence of what was stated.
- low: a reasonable expectation that the context only hints at.

Derive consequences the author did not write down — that is the entire value here. "Prevent double-click on submit" implies the control becomes disabled, in-flight state is visible, and repeat submissions cannot fire. But stay proportionate to the change's stated scope: a one-line fix does not imply a redesign.`;

export function buildInferSystemPrompt(): string {
  return INFER_SYSTEM_PROMPT;
}

export function buildInferUserPrompt(ctx: ReviewContext): string {
  const sections: string[] = [];

  const intent = [
    `# PR intent`,
    ``,
    `Title: ${ctx.title}`,
    ``,
    `Description:`,
    ctx.body.trim() || "(no description provided)",
  ];
  if (ctx.labels.length > 0) intent.push(``, `Labels: ${ctx.labels.join(", ")}`);
  if (ctx.linkedIssue) {
    intent.push(
      ``,
      `Linked issue #${ctx.linkedIssue.number}: ${ctx.linkedIssue.title}`,
      ctx.linkedIssue.body.trim() || "(no issue body)",
    );
  }
  sections.push(intent.join("\n"));

  if (ctx.commits.length > 0) {
    const lines = ctx.commits.map((c) => `- ${c.message.split("\n", 1)[0]}`);
    sections.push([`# Commit messages`, ...lines].join("\n"));
  }

  // Shapes only — filenames and line counts, never patch bodies.
  const files = ctx.fileSummary.map(
    (f) => `- ${f.filename} (${f.status}, +${f.additions}/-${f.deletions})`,
  );
  sections.push(
    [
      `# Files changed (shape only, no contents)`,
      ...(files.length > 0 ? files : ["(no files changed)"]),
    ].join("\n"),
  );

  sections.push(`Infer the implied specification for this pull request.`);
  return sections.join("\n\n");
}

/** Run the diff-blind inference call. Throws on parse failure; the engine degrades. */
export async function inferSpec(ctx: ReviewContext, opts: InferOptions): Promise<ImpliedSpec> {
  const response = await opts.client.messages.parse({
    model: opts.model,
    max_tokens: opts.maxOutputTokens ?? DEFAULT_INFER_MAX_OUTPUT_TOKENS,
    thinking: { type: "adaptive" },
    system: buildInferSystemPrompt(),
    messages: [{ role: "user", content: buildInferUserPrompt(ctx) }],
    output_config: { format: zodOutputFormat(ImpliedSpecSchema) },
  });

  if (!response.parsed_output) {
    throw new Error(`Spec inference parse failed (stop_reason: ${response.stop_reason})`);
  }
  return response.parsed_output;
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm --filter @rubric/core exec vitest run src/infer.test.ts`
Expected: PASS, 4 tests.

- [ ] **Step 5: Verify the repo is green and commit**

```bash
pnpm format
pnpm -r build && pnpm -r typecheck && pnpm -r test
git add packages/core/src/infer.ts packages/core/src/infer.test.ts
git commit -m "feat(core): add diff-blind spec inference stage"
```

---

### Task 6: Wire inference into the engine

**Files:**

- Modify: `packages/core/src/prompt.ts`
- Modify: `packages/core/src/prompt.test.ts`
- Modify: `packages/core/src/engine.ts`
- Modify: `packages/core/src/render.ts`
- Modify: `packages/core/src/render.test.ts`
- Modify: `packages/core/src/index.ts`

**Interfaces:**

- Consumes: `inferSpec`, `ImpliedSpec` (Task 5); `ReviewContext` (Task 2); `scoreSignal` (Task 3).
- Produces: `EngineOptions.infer?: boolean` (default `true`); `PromptInput.impliedSpec?: ImpliedSpec | null`; populated `Review.inferredClaims` and `Review.inference`.

- [ ] **Step 1: Write the failing prompt test**

Append to `packages/core/src/prompt.test.ts`:

The file already declares a module-level `const base: PromptInput` at line 5. Name this one `specBase` rather than shadowing it.

```ts
describe("buildUserPrompt with an implied spec", () => {
  const specBase: PromptInput = {
    title: "fix: prevent double submit",
    body: "Users could submit twice.",
    linkedIssue: null,
    diffText: "### src/submit.tsx (modified, +1/-0)\n@@ -1 +1 @@\n+x",
    truncated: false,
  };

  it("includes each spec item with its kind and confidence", () => {
    const prompt = buildUserPrompt({
      ...specBase,
      impliedSpec: {
        items: [
          { text: "Submit disables on click", kind: "behavior", confidence: "high" },
          { text: "Repeat submits are ignored", kind: "edge_case", confidence: "medium" },
        ],
      },
    });
    expect(prompt).toContain("Implied specification");
    expect(prompt).toContain("Submit disables on click");
    expect(prompt).toContain("behavior");
    expect(prompt).toContain("high");
    expect(prompt).toContain("Repeat submits are ignored");
  });

  it("omits the section entirely when inference did not run", () => {
    const prompt = buildUserPrompt({ ...specBase, impliedSpec: null });
    expect(prompt).not.toContain("Implied specification");
  });
});
```

Run: `pnpm --filter @rubric/core exec vitest run src/prompt.test.ts`
Expected: FAIL — `impliedSpec` is not a valid `PromptInput` property.

- [ ] **Step 2: Extend the prompt**

In `packages/core/src/prompt.ts`, import the spec type and add the field:

```ts
import type { ImpliedSpec } from "./infer.js";
```

Add to `PromptInput`:

```ts
    /** Diff-blind inferred expectations, or null when inference did not run. */
    impliedSpec?: ImpliedSpec | null;
```

Append to `SYSTEM_PROMPT`, just before the final paragraph:

```
When an implied specification is provided, it was produced by an earlier stage that saw the PR's intent and the names of changed files but never the diff. Grade each of its items against the diff exactly as you grade stated claims, and return them in `inferredClaims`, preserving each item's `kind` and `confidence` verbatim. Do not invent additional inferred items, and do not move a stated claim into `inferredClaims`. When no implied specification is provided, return an empty `inferredClaims` array.
```

In `buildUserPrompt`, insert before the closing instruction:

```ts
if (input.impliedSpec && input.impliedSpec.items.length > 0) {
  const items = input.impliedSpec.items.map((i) => `- [${i.kind}, ${i.confidence}] ${i.text}`);
  sections.push(
    [
      `# Implied specification`,
      `Derived from the PR's intent without sight of the diff. Grade each item below.`,
      ...items,
    ].join("\n"),
  );
}
```

Run: `pnpm --filter @rubric/core exec vitest run src/prompt.test.ts`
Expected: PASS.

- [ ] **Step 3: Orchestrate both calls in the engine**

In `packages/core/src/engine.ts`, add the import:

```ts
import { inferSpec, type ImpliedSpec } from "./infer.js";
```

Add to `EngineOptions`:

```ts
    /** Run the diff-blind inference stage before the review. Default: true. */
    infer?: boolean;
```

Replace the budgeting section (from `const ranked =` through the `buildUserPrompt` call) with:

```ts
const ranked = rankFiles(filterFiles(files));
const shouldInfer = opts.infer ?? true;

// Inference does not need the budgeted diff, and budgeting is mostly waiting on
// countTokens round-trips — so the two overlap instead of running back to back.
let inferError: string | undefined;
const [spec, budget] = await Promise.all([
  shouldInfer
    ? inferSpec(context, { client, model }).catch((err: unknown) => {
        // A failed inference must not sink an otherwise valid review.
        inferError = err instanceof Error ? err.message : String(err);
        log(`spec inference failed, continuing with stated claims only: ${inferError}`);
        return null;
      })
    : Promise.resolve<ImpliedSpec | null>(null),
  truncateToBudget(ranked, maxDiffTokens, countTokens),
]);

if (budget.truncated) {
  log(`diff truncated: kept ${budget.files.length} file(s), omitted ${budget.omitted.length}`);
}
if (spec) log(`inferred ${spec.items.length} spec item(s)`);

const user = buildUserPrompt({
  title: context.title,
  body: context.body,
  linkedIssue: context.linkedIssue,
  diffText: budget.diffText,
  truncated: budget.truncated,
  impliedSpec: spec,
});
```

Replace the return block:

```ts
const inference: InferenceStatus = !shouldInfer
  ? { ran: false, reason: "disabled" }
  : spec === null
    ? { ran: false, reason: inferError ?? "inference failed" }
    : { ran: true };

return {
  ...response.parsed_output,
  // Provenance is a fact the code owns: no spec means nothing was inferred,
  // whatever the model chose to put in that array.
  inferredClaims: spec === null ? [] : response.parsed_output.inferredClaims,
  truncated: budget.truncated,
  signalScore,
  inference,
};
```

- [ ] **Step 4: Write the failing renderer tests**

The file has no `Review` factory — it imports fixtures and casts them. These tests need inferred claims that the fixtures do not yet have (Task 9 adds them), so build a full literal. Append to `packages/core/src/render.test.ts`:

```ts
describe("inferred claims rendering", () => {
  const ctx = { owner: "o", repo: "r", headSha: "abc123", model: "claude-opus-4-8" };

  const withInferred = {
    verdict: "partially_aligned" as const,
    summary: "Mostly there.",
    statedClaims: [
      {
        id: "s1",
        text: "Disables submit on click",
        status: "implemented" as const,
        evidence: [{ file: "src/submit.tsx", lines: "24" }],
        explanation: "Done.",
      },
    ],
    inferredClaims: [
      {
        id: "i1",
        text: "In-flight state is visible",
        status: "missing" as const,
        evidence: [],
        explanation: "No spinner found.",
        confidence: "high" as const,
        kind: "behavior" as const,
      },
    ],
    unstatedChanges: [],
    truncated: false,
    signalScore: {
      total: 48,
      band: "low" as const,
      components: [
        {
          key: "tests" as const,
          label: "Tests touched",
          earned: 0,
          max: 20,
          note: "no test files changed",
        },
      ],
    },
    inference: { ran: true },
  };

  it("renders one table with a Source column", () => {
    const md = reviewToMarkdown(withInferred, ctx);
    expect(md).toContain("| | Claim | Source | Evidence |");
    expect(md).toContain("| stated |");
    expect(md).toContain("inferred · HIGH");
  });

  it("puts stated claims before inferred ones", () => {
    const md = reviewToMarkdown(withInferred, ctx);
    expect(md.indexOf("Disables submit on click")).toBeLessThan(
      md.indexOf("In-flight state is visible"),
    );
  });

  it("shows the signal score in the footer when inference ran", () => {
    expect(reviewToMarkdown(withInferred, ctx)).toContain("Signal 48/100");
  });

  it("hides the signal score when inference did not run", () => {
    const off = { ...withInferred, inferredClaims: [], inference: { ran: false } };
    expect(reviewToMarkdown(off, ctx)).not.toContain("Signal 48/100");
  });

  it("promotes a low-signal disclaimer above the claims", () => {
    const md = reviewToMarkdown(withInferred, ctx);
    expect(md).toContain("Low signal (48/100)");
    expect(md.indexOf("Low signal")).toBeLessThan(md.indexOf("### Claims"));
  });

  it("omits the disclaimer once signal clears the threshold", () => {
    const strong = {
      ...withInferred,
      signalScore: { ...withInferred.signalScore, total: 85, band: "high" as const },
    };
    expect(reviewToMarkdown(strong, ctx)).not.toContain("Low signal");
  });

  it("keeps the marker first", () => {
    expect(reviewToMarkdown(withInferred, ctx).startsWith("<!-- rubric-review -->")).toBe(true);
  });
});
```

Run: `pnpm --filter @rubric/core exec vitest run src/render.test.ts`
Expected: FAIL on the disclaimer tests — the rest already pass from Task 4.

- [ ] **Step 5: Add the low-signal disclaimer**

In `packages/core/src/render.ts`, import `LOW_SIGNAL_THRESHOLD` from `./confidence.js` and add above `reviewToMarkdown`:

```ts
/** Warn when the inference had thin context to work from. */
function lowSignalNotice(review: Review): string | null {
  if (!review.inference.ran) return null;
  if (review.signalScore.total >= LOW_SIGNAL_THRESHOLD) return null;
  return (
    `> ⚠️ Low signal (${review.signalScore.total}/100) — expected behavior was inferred ` +
    `from limited PR context. Consider adding a description or linking an issue.`
  );
}
```

In `reviewToMarkdown`, insert after the summary push and before the claims push:

```ts
const lowSignal = lowSignalNotice(review);
if (lowSignal) parts.push(lowSignal);
```

Run: `pnpm --filter @rubric/core exec vitest run src/render.test.ts`
Expected: PASS.

- [ ] **Step 6: Export the inference surface**

In `packages/core/src/index.ts`, add:

```ts
export {
  inferSpec,
  buildInferSystemPrompt,
  buildInferUserPrompt,
  SpecItemSchema,
  ImpliedSpecSchema,
  DEFAULT_INFER_MAX_OUTPUT_TOKENS,
  type SpecItem,
  type ImpliedSpec,
  type InferOptions,
} from "./infer.js";
```

- [ ] **Step 7: Verify the repo is green and commit**

```bash
pnpm format
pnpm -r build && pnpm -r typecheck && pnpm -r test
git add -A
git commit -m "feat(core): grade the diff against the inferred spec"
```

---

### Task 7: CLI flags

**Files:**

- Modify: `packages/cli/src/run.ts`
- Modify: `packages/cli/src/terminal.ts`
- Modify: `docs/cli.md`

**Interfaces:**

- Consumes: `EngineOptions.infer` (Task 6); `Review.inferredClaims`, `Review.signalScore`, `Review.inference` (Task 4/6).
- Produces: `--no-infer` and `--show-inferred-spec` CLI flags.

- [ ] **Step 1: Add the flags to argument parsing**

In `packages/cli/src/run.ts`, add to `Args`:

```ts
infer: boolean;
showInferredSpec: boolean;
```

Add to the `args` initializer: `infer: true,` and `showInferredSpec: false,`. Add to the `switch`:

```ts
            case "--no-infer":
                args.infer = false;
                break;
            case "--show-inferred-spec":
                args.showInferredSpec = true;
                break;
```

Add to `HELP`, after the `--markdown` line:

```
  --no-infer             Skip spec inference; review stated claims only.
  --show-inferred-spec   Print the inferred specification before the review.
```

And pass it through the engine call: add `infer: args.infer,` to the options object.

- [ ] **Step 2: Render the inferred spec on demand**

In `packages/cli/src/terminal.ts`, add:

```ts
const KIND_LABEL: Record<InferredClaim["kind"], string> = {
  behavior: "Expected behavior",
  edge_case: "Edge cases",
  acceptance: "Acceptance criteria",
};

/** Print the inferred spec grouped by kind, for --show-inferred-spec. */
export function renderInferredSpec(review: Review, opts: TerminalOptions): string {
  const c = opts.color ? COLORED : PLAIN;
  if (!review.inference.ran) {
    return c.dim(`(inference did not run: ${review.inference.reason ?? "unknown"})`);
  }
  const lines: string[] = [c.bold("Inferred specification:")];
  for (const kind of ["behavior", "edge_case", "acceptance"] as const) {
    const items = review.inferredClaims.filter((i) => i.kind === kind);
    if (items.length === 0) continue;
    lines.push("", c.bold(`  ${KIND_LABEL[kind]}:`));
    for (const item of items) {
      lines.push(`    ${c.dim(item.confidence.toUpperCase().padEnd(6))} ${item.text}`);
    }
  }
  return lines.join("\n");
}
```

Import `InferredClaim` alongside `Claim`/`Review`. Also add the signal score to `renderTerminal`, just before the `truncated` block:

```ts
if (review.inference.ran) {
  const s = review.signalScore;
  const tint = s.band === "high" ? "green" : s.band === "medium" ? "yellow" : "red";
  lines.push(c[tint](`Signal ${s.total}/100 (${s.band})`));
  if (s.band === "low") {
    lines.push(c.dim("  Expected behavior was inferred from limited context — treat with care."));
  }
  lines.push("");
}
```

- [ ] **Step 3: Print it from the CLI**

In `packages/cli/src/run.ts`, import `renderInferredSpec` and add before the terminal render in the `else` branch:

```ts
    } else {
        if (args.showInferredSpec) {
            process.stdout.write(`\n${renderInferredSpec(review, { color: args.color })}\n`);
        }
        process.stdout.write(`\n${renderTerminal(review, { color: args.color })}\n`);
    }
```

- [ ] **Step 4: Verify the flags parse**

```bash
pnpm --filter @rubric/cli build
node packages/cli/dist/rubric.cjs --help
```

Expected: help text lists `--no-infer` and `--show-inferred-spec`.

```bash
node packages/cli/dist/rubric.cjs --no-infer
```

Expected: exits 1 with "Missing PR reference." — proves the flag parses rather than erroring as unknown.

- [ ] **Step 5: Document the flags**

In `docs/cli.md`, add two rows to the options table after `--markdown`:

```
| `--no-infer`            | Skip spec inference; review stated claims only.  |
| `--show-inferred-spec`  | Print the inferred specification before the review. |
```

- [ ] **Step 6: Verify the repo is green and commit**

```bash
pnpm format
pnpm -r build && pnpm -r typecheck && pnpm -r test
git add packages/cli docs/cli.md
git commit -m "feat(cli): add --no-infer and --show-inferred-spec"
```

---

### Task 8: Action input, output, and rebuilt bundle

**Files:**

- Modify: `packages/action/action.yml`
- Modify: `packages/action/src/main.ts`
- Modify: `packages/action/dist/index.cjs` (generated, force-added)

**Interfaces:**

- Consumes: `EngineOptions.infer` (Task 6), `Review.signalScore` (Task 4).
- Produces: `infer` action input (default `"true"`), `signal-score` action output.

- [ ] **Step 1: Declare the input and output**

In `packages/action/action.yml`, add to `inputs` after `max-diff-tokens`:

```yaml
infer:
  description: >-
    Infer the implied specification from PR context before reviewing. Adds a
    second Claude call, roughly doubling cost. Disable for stated claims only.
  required: false
  default: "true"
```

Add to `outputs`:

```yaml
signal-score:
  description: How much intent signal the PR carried, 0-100.
```

- [ ] **Step 2: Wire it through**

In `packages/action/src/main.ts`, add after the `maxDiffTokens` line:

```ts
const shouldInfer = core.getBooleanInput("infer");
```

Add `infer: shouldInfer,` to the `reviewPullRequest` options object, and add after the existing `setOutput` calls:

```ts
core.setOutput("signal-score", String(review.signalScore.total));
```

- [ ] **Step 3: Rebuild and force-add the committed bundle**

GitHub Actions runs `dist/index.cjs` with no install step, so a stale bundle silently ships old code.

```bash
pnpm --filter @rubric/action build
git add -f packages/action/dist/index.cjs
```

- [ ] **Step 4: Verify the repo is green and commit**

```bash
pnpm format
pnpm -r build && pnpm -r typecheck && pnpm -r test
git add packages/action/action.yml packages/action/src/main.ts
git add -f packages/action/dist/index.cjs
git commit -m "feat(action): add infer input and signal-score output"
```

---

### Task 9: Manual verification and real fixtures

The paid steps here are the design's success check. Run them deliberately.

**Files:**

- Create: `packages/core/scripts/try-infer.ts`
- Modify: `packages/core/scripts/try-engine-adversarial.ts`
- Modify: `packages/core/src/__fixtures__/slugify-73.review.json`
- Modify: `packages/core/src/__fixtures__/slugify-73-misaligned.review.json`

**Interfaces:**

- Consumes: everything from Tasks 1–8.
- Produces: regenerated fixtures matching the current `ReviewSchema`, with real `inferredClaims`.

- [ ] **Step 1: Add a free inference-prompt inspector**

Create `packages/core/scripts/try-infer.ts`:

```ts
// Assemble and print the inference prompt for a real PR — NO paid API call.
// Usage: GITHUB_TOKEN=$(gh auth token) pnpm exec tsx packages/core/scripts/try-infer.ts [owner repo number]
import { GitHubClient } from "../src/github.js";
import { gatherContext } from "../src/context.js";
import { scoreSignal } from "../src/confidence.js";
import { buildInferSystemPrompt, buildInferUserPrompt } from "../src/infer.js";

const [owner = "sindresorhus", repo = "slugify", numRaw = "73"] = process.argv.slice(2);

const gh = new GitHubClient({ token: process.env.GITHUB_TOKEN ?? "" });
const data = await gh.getPullRequestData(owner, repo, Number(numRaw));
const ctx = gatherContext(data);
const score = scoreSignal(ctx);

console.log(`--- signal: ${score.total}/100 (${score.band}) ---`);
for (const c of score.components) {
  console.log(`  ${c.label.padEnd(20)} ${String(c.earned).padStart(2)}/${c.max}  ${c.note}`);
}
console.log(`\n--- system ---\n${buildInferSystemPrompt()}`);
console.log(`\n--- user ---\n${buildInferUserPrompt(ctx)}`);
```

Run: `GITHUB_TOKEN=$(gh auth token) pnpm exec tsx packages/core/scripts/try-infer.ts`
Expected: a signal breakdown and both prompts. **Confirm by eye that the user prompt contains no `@@` hunks** — this is the design's central invariant.

- [ ] **Step 2: Extend the adversarial check with a thin-description case**

In `packages/core/scripts/try-engine-adversarial.ts`, update the existing call to the new signature (`reviewPullRequest(gatherContext({...data, title, body}), data.files, {...})`), importing `gatherContext`. Then append a second scenario:

```ts
// Thin-context case: a bare title and nothing else. Inference should still
// produce expectations, and the signal score should land in the low band.
const thin = await reviewPullRequest(
  gatherContext({ ...data, title: "fix: prevent double-click on submit", body: "" }),
  data.files,
  { anthropicApiKey: apiKey },
);
console.log("\n--- thin-context run ---");
console.log(`signal: ${thin.signalScore.total}/100 (${thin.signalScore.band})`);
console.log(JSON.stringify(thin.inferredClaims, null, 2));
```

- [ ] **Step 3: Run the paid verification**

```bash
GITHUB_TOKEN=$(gh auth token) node --env-file=.env --import tsx \
  packages/core/scripts/try-engine-adversarial.ts
```

Expected, per the design's success check:

1. The false docs-only description still returns `misaligned`.
2. The thin-context run produces `inferredClaims` covering the disabled control, in-flight visibility, and blocked repeat submissions.
3. `thin.signalScore.band` is `"low"`.

If inference returns nothing useful, fix `INFER_SYSTEM_PROMPT` in `infer.ts` and re-run — this script is the prompt-quality regression check.

- [ ] **Step 4: Regenerate both fixtures**

First update `packages/core/scripts/try-engine.ts` to the new call signature and give it a `--misaligned` mode, so one script can produce both fixtures. Add `import { gatherContext } from "../src/context.js";`, then replace the argument parsing and review call with:

```ts
// --misaligned regenerates the trap fixture: the real diff, described dishonestly.
const argv = process.argv.slice(2);
const misaligned = argv.includes("--misaligned");
const positional = argv.filter((a) => !a.startsWith("--"));
const [owner = "sindresorhus", repo = "slugify", numRaw = "73", model] = positional;
const number = Number(numRaw);
```

and, after `const data = await gh.getPullRequestData(owner, repo, number);`:

```ts
const context = gatherContext(
  misaligned
    ? {
        ...data,
        title: "Add installation instructions to the README",
        body: "Documentation only. Adds an Installation section to the README covering `npm install slugify` and `yarn add slugify`. No code or behavior changes.",
        linkedIssue: null,
      }
    : data,
);

const review = await reviewPullRequest(context, data.files, {
  anthropicApiKey: apiKey,
  ...(model ? { model } : {}),
});
```

Then capture both. The script writes logs to stderr and JSON to stdout, so the redirect gets clean JSON:

```bash
GITHUB_TOKEN=$(gh auth token) node --env-file=.env --import tsx \
  packages/core/scripts/try-engine.ts sindresorhus slugify 73 \
  > packages/core/src/__fixtures__/slugify-73.review.json
```

```bash
GITHUB_TOKEN=$(gh auth token) node --env-file=.env --import tsx \
  packages/core/scripts/try-engine.ts --misaligned \
  > packages/core/src/__fixtures__/slugify-73-misaligned.review.json
```

Verify both files parse and carry real inferred claims:

```bash
node -e "for (const f of ['slugify-73','slugify-73-misaligned']) { const r = require('./packages/core/src/__fixtures__/'+f+'.review.json'); console.log(f, r.verdict, 'stated:', r.statedClaims.length, 'inferred:', r.inferredClaims.length, 'signal:', r.signalScore.total); }"
```

Expected: both verdicts unchanged from before (`aligned` and `misaligned`), non-zero `inferred` counts, and a plausible signal total.

- [ ] **Step 5: Confirm the web demo renders the new fixtures**

```bash
pnpm --filter @rubric/web build
```

Expected: build succeeds. The demo now shows inferred rows alongside stated ones.

- [ ] **Step 6: Verify the repo is green and commit**

```bash
pnpm format
pnpm -r build && pnpm -r typecheck && pnpm -r test
git add packages/core/scripts packages/core/src/__fixtures__
git commit -m "test(core): verify inference end to end and regenerate fixtures"
```

---

### Task 10: Documentation

**Files:**

- Modify: `README.md`
- Modify: `CLAUDE.md`

**Interfaces:**

- Consumes: the finished feature.
- Produces: no code.

- [ ] **Step 1: Update the README pipeline and flags**

Replace the ASCII pipeline under "How it works" with:

```
GitHub PR ──► gather context ──┬─► infer spec (diff-blind) ──┐
              title/body/issue │   expected behavior,        │
              commits/labels   │   edge cases, criteria      ├─► Claude ──► render
              + per-file patch └─► budget the diff ──────────┘   verdict +   Markdown
                                   rank & fit to budget          claims      / terminal
```

Add steps for context gathering and inference to the numbered "Step by step" list, add `--no-infer` and `--show-inferred-spec` to the CLI flag sentence, and add the `infer` row to the Action inputs table:

```
| `infer`              | `true`                | Infer the implied spec before reviewing (2nd call). |
```

Update the Cost section: two calls per review, roughly **$0.10–0.70** on `claude-opus-4-8`, and note `--no-infer` / `infer: false` halves it.

Add to "Key design decisions":

```markdown
- **Inference is diff-blind.** The stage that decides what a PR _should_ do never
  sees the code — `ReviewContext` has no field that can hold a patch. A spec
  written after reading the implementation would just describe the implementation.
- **Signal is scored by code, confidence by the model.** How much context existed
  is a fact (`scoreSignal`); how sure the model is of a derived expectation is a
  judgment. Neither one reports the other's number.
```

- [ ] **Step 2: Update CLAUDE.md**

Add to the core module list, after `budget.ts`:

```markdown
- **`context.ts`** — `gatherContext()`. Owns what the inference stage may see; `FileSummary` has no `patch` field, making diff-blindness a type guarantee.
- **`confidence.ts`** — `scoreSignal()`. Pure, mechanical 0–100 signal score. Weights and thresholds are exported constants.
- **`infer.ts`** — the diff-blind inference call producing `ImpliedSpec`.
```

Add to Invariants:

```markdown
- **Inference never sees patches.** `ReviewContext.fileSummary` structurally cannot carry one, and `infer.test.ts` asserts the assembled prompt has no `@@` hunks. Do not add a patch field to reach it "just this once."
- **Claim provenance is code-owned.** `statedClaims` and `inferredClaims` are separate arrays; the engine clears `inferredClaims` when inference did not run. Never add a model-authored `source` tag.
- **The model is never asked for code-owned facts.** `ReviewOutputSchema` is what the model fills; `truncated`, `signalScore`, and `inference` are attached afterward by `engine.ts`.
```

Update the Commands section to mention `scripts/try-infer.ts` (free) alongside the existing scripts, and note that `try-engine-adversarial.ts` now also covers the thin-context inference case.

- [ ] **Step 3: Verify and commit**

```bash
pnpm format
pnpm -r build && pnpm -r typecheck && pnpm -r test
git add README.md CLAUDE.md
git commit -m "docs: document implied spec inference"
```

---

## Verification checklist

Run after Task 10. Every item must pass before the feature is called done.

- [ ] `pnpm -r build && pnpm -r typecheck && pnpm -r test` passes from a clean `pnpm install`.
- [ ] `node packages/cli/dist/rubric.cjs --help` lists both new flags.
- [ ] A real scan with `--show-inferred-spec` prints spec items grouped into three sections.
- [ ] The same scan with `--no-infer` produces a claims table with no Source column and no signal line.
- [ ] `git status` shows `packages/action/dist/index.cjs` committed and current with `packages/action/src/main.ts`.
- [ ] Both fixtures carry non-empty `inferredClaims`, and `pnpm --filter @rubric/web build` succeeds.
- [ ] `packages/core/src/infer.test.ts` asserts the inference prompt contains no `@@`.
