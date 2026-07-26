# Implied Spec Inference from PR Context — Design

**Date:** 2026-07-26
**Status:** Approved, ready for implementation planning
**Source plan:** `Knowledge/Plans/Rubric.md` → Plan #2 (vault), background in `Reading/2026-07-14.md` § 2

---

## Why this deviates from the vault plan

Plan #2 was written against an architecture Rubric does not have. It states that
"the existing `review.ts` already compares code vs. a spec document" and proposes
inference as a fallback for when no spec exists. In reality:

- There is no `review.ts`, no explicit-spec mode, and no spec-document concept anywhere in the repo.
- `buildUserPrompt` (`packages/core/src/prompt.ts`) already feeds title, body, and linked issue to the model.
- The system prompt already instructs the model to decompose intent into claims "including implicit claims."
- `github.ts:16` already parses `Closes #N` / `Fixes #N`.

So the "read the description and work out what it promised" half of Plan #2 is already shipped.

Three things in the plan are genuinely new, and they are what this design builds:

1. **Signals Rubric never fetches** — commit messages and labels. `GitHubClient` has
   `getPullRequest`, `getLinkedIssue`, and `getFiles`, and nothing else. Commit messages are an
   independent signal that frequently contradicts a tidied-up PR description.
2. **Derived rather than extracted expectations.** A claim restates a promise ("adds a
   Troubleshooting section"). A spec item derives consequences the PR never wrote down:
   "fix: prevent double-click on submit" implies the button disables on click, in-flight state is
   visible, and repeat submissions cannot fire. Today's model gestures at this via "implicit
   claims"; making it a first-class diff-blind step is the actual product idea.
3. **Confidence.** Nothing in the current schema expresses how much to trust a given review.

The honest framing is therefore not "add spec inference to a tool that lacks it" but
**"Rubric's intent extraction is shallow; deepen it, feed it more signal, and let it score its own
reliability."**

---

## Architecture

```
GitHubClient.getPullRequestData()          ← gains commits + labels
         │
         ▼
   gatherContext(prData)  ──►  ReviewContext
         │                      { title, body, linkedIssue,
         │                        commits[], labels[], fileSummary[] }
         │
         ├──────────────► scoreSignal(ctx) ──► SignalScore   [pure, no API]
         │
         ▼
   inferSpec(ctx)  ──────────────────────────► ImpliedSpec   [call 1, diff-blind]
         │                    ║ concurrent with ║
   filterFiles → rankFiles → truncateToBudget                [unchanged]
         │
         ▼
   reviewPullRequest(ctx, files, impliedSpec, signalScore) ─► Review   [call 2]
         │
         ▼
   reviewToMarkdown / renderTerminal
```

### New modules (`packages/core/src/`)

Three small modules, following the existing module-per-stage convention.

**`context.ts`** — `gatherContext(prData): ReviewContext`. Owns _what inference is allowed to
see_. `ReviewContext.fileSummary` is typed `{ filename, status, additions, deletions }[]` with **no
`patch` field**, so diff-blindness is enforced by the type system rather than by discipline. This
mirrors how `truncated` is made un-fakeable in `engine.ts:91`: the guarantee lives in code, not in a
convention someone can forget.

**`confidence.ts`** — `scoreSignal(ctx): SignalScore`. Pure, synchronous, weights as named
constants. Unit-tested in the style of `budget.ts`.

**`infer.ts`** — inference system/user prompts and the `inferSpec()` call. Returns a Zod-validated
`ImpliedSpec` through the same `messages.parse` + `zodOutputFormat` pattern the engine already uses.

### Modified modules

| File                                       | Change                                                                                                                         |
| ------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------ |
| `github.ts`                                | Add `getCommits()` (paginated, 100-commit cap); surface `labels` on `getPullRequest`; thread both through `getPullRequestData` |
| `engine.ts`                                | Orchestrate the two calls; run `inferSpec` and `truncateToBudget` concurrently                                                 |
| `prompt.ts`                                | Inject the implied spec into the review prompt                                                                                 |
| `schema.ts`                                | See below                                                                                                                      |
| `render.ts`                                | Source column, confidence, signal score, low-signal disclaimer                                                                 |
| `index.ts`                                 | Export the new surface                                                                                                         |
| `packages/cli/src/{run,terminal}.ts`       | New flags                                                                                                                      |
| `packages/action/{action.yml,src/main.ts}` | New input and output                                                                                                           |

### Breaking change

`reviewPullRequest` currently takes a loose `ReviewInput` of `title` / `body` / `linkedIssue` /
`files`. Threading context, spec, and score through cleanly means it takes `ReviewContext` plus
`files` instead. This is a breaking change to a public export. All three consumers live in this
repo, so `index.ts`, `action`, `cli`, and `web` update together in the same change.

### Cost and latency

Cost roughly doubles: two Opus calls per review, moving the README's stated range from
~$0.05–0.35 to ~$0.10–0.70. Wall-clock does not double — `inferSpec()` does not need the budgeted
diff, and `truncateToBudget` spends its time in `countTokens` round-trips, so the two run
concurrently under `Promise.all`. `scoreSignal` is free and synchronous.

---

## Decisions

Recorded because each had a live alternative that was considered and rejected.

**Inference is diff-blind, seeing the file list but not the patches.** It receives filenames,
status, and add/delete counts, so it knows the change's shape and scope without seeing the
implementation, and it cannot retrofit the spec to the code. This is also what makes the "scattered
changes" signal possible. Fully blind was rejected as too vague to target a module; seeing the full
diff was rejected as circular — at that point a single call is strictly cheaper for the same result.

**Confidence is split by who can actually know it.** The code computes a deterministic signal score
from mechanical facts; the model rates per-item confidence, which is genuine judgment. Letting the
model report both was rejected as the exact pattern `engine.ts:91` exists to prevent.

**One rendered table, two internal arrays.** Provenance is a mechanical fact — the code handed the
model the inferred items, so it already knows which are which. A single `claims` array with a
model-authored `source` tag was rejected for the same reason as above.

**Inference is on by default, `--no-infer` opts out.** One code path, exercised by default including
in the dogfood workflow, and the opt-out falls back to exactly today's behavior so the fallback path
is already tested. Opt-in was rejected because a flagship feature nobody enables is a feature that
rots.

---

## Schema

```ts
ReviewSchema = {
  verdict, summary,
  statedClaims:   Claim[],           // extracted from title/body/issue — no confidence
  inferredClaims: InferredClaim[],   // graded against the implied spec — carries confidence
  unstatedChanges: UnstatedChange[],
  truncated: boolean,                // overwritten by the budgeter, never model-reported
  signalScore: SignalScore,          // overwritten by scoreSignal(), never model-reported
  inference: { ran: boolean, reason?: string },  // code-owned
}
```

`InferredClaim` extends `Claim` with:

- `confidence: "high" | "medium" | "low"` — the model's certainty in the derived expectation.
- `kind: "behavior" | "edge_case" | "acceptance"` — groups `--show-inferred-spec` output into the
  three sections Plan #2 asks for. The review table ignores it.

The three-way coverage (happy path, edge cases, acceptance criteria) is also instructed in the
inference prompt, since it drives coverage quality independently of how the output is grouped.

`SignalScore` is `{ total: 0-100, band: "high" | "medium" | "low", components: SignalComponent[] }`,
each component carrying `earned`, `max`, and a short note explaining its number. Bands follow the
reading note: ≥80 high, 60–79 medium, <60 low (disclaimer).

### Signal weights

| Signal             | Weight | Computation                                                                                                                                                                        |
| ------------------ | -----: | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Description detail |     25 | `0` if body is empty/whitespace. Otherwise `min(15, floor(chars / 40))` (saturates at 600 chars), `+5` for ≥2 non-empty paragraphs, `+5` if it contains a Markdown list item       |
| Linked issue       |     20 | `20` if present, else `0`                                                                                                                                                          |
| Commit quality     |     15 | `min(15, substantive × 5)`, where a substantive commit is non-merge, has a subject ≥15 chars, and does not match `/^(wip\|fix\|update\|changes?\|stuff\|misc)\b/i`. Saturates at 3 |
| Tests touched      |     20 | `20` if any changed file matches `budget.ts`'s existing test-file predicate (exported rather than duplicated), else `0`                                                            |
| Scope focus        |     20 | By distinct top-level directories touched: ≤1 → `20`, 2 → `15`, 3 → `10`, 4 → `5`, ≥5 → `0`. The plan's "scattered changes" signal                                                 |

The constants above are the starting values and are exported so they can be tuned; the boundary
cases in each row are what `confidence.test.ts` pins down.

**Dropped from the reading note's table:** "PR title describes the change" (20%). Whether a title is
descriptive is judgment, not a fact, so it cannot live in code-owned scoring, and it overlaps
heavily with description detail. Its weight moved to scope focus, which is mechanical and catches a
failure mode nothing else covers.

**Not building:** Plan #2 step 4 wants thresholds "configurable via Rubric config." No config system
exists in this repo, and inventing one to hold two numbers is not justified. They ship as exported
constants.

---

## Rendering

The merged table puts stated rows first:

```
| | Claim | Source | Evidence |
|:--:|---|---|---|
| ✅ | Submit disables on click   | stated          | submit.tsx#L24 |
| 🟡 | In-flight state is visible | inferred · HIGH | submit.tsx#L31 |
| ⭕ | Repeat submissions blocked | inferred · MED  | — |
```

When there are no inferred claims the Source column is **omitted entirely**, so `--no-infer` output
is byte-identical to today's. This makes the fallback path verifiable against the existing
`render.test.ts` expectations instead of requiring a parallel set.

Byte-identical output requires that the signal score be suppressed too, which is also the correct
behavior on its own terms: the score exists to calibrate trust in _inferred_ content, so with
nothing inferred there is nothing to calibrate. It is still computed — `scoreSignal` is free and
synchronous — and still appears in `--json` output; it is only the Markdown and terminal renderers
that omit it when inference did not run. The same applies when inference ran but failed.

The `<!-- rubric-review -->` marker stays first in the output, unchanged.

Signal score renders in the footer. Below 60 it promotes to a blockquote above the claims:

> ⚠️ Low signal (48/100) — expected behavior was inferred from limited PR context. Consider adding a
> description or linking an issue.

### CLI

- `--no-infer` — skip inference, review stated claims only.
- `--show-inferred-spec` — print the implied spec grouped by `kind` before the review.
- Both added to `HELP` in `run.ts` and to `docs/cli.md`. `--json` picks up the new fields for free.

### Action

- New `infer` input, default `true`.
- New `signal-score` output alongside `verdict` and `misaligned`.
- `packages/action/dist/index.cjs` is rebuilt and committed in the same change, per the invariant in
  `CLAUDE.md` — otherwise CI ships stale code.

---

## Failure handling

Two calls means two failure points, and the review is still worth delivering without the spec.

| Case                                | Behavior                                                                                                                                                                                              |
| ----------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Inference call fails or won't parse | Log, continue with stated claims only. `inference: { ran: false, reason }` records why, so "inference was off" and "inference broke" are distinguishable rather than both looking like a thin review. |
| `getCommits()` fails                | Treat as zero commits; the commit-quality component scores 0. Review proceeds.                                                                                                                        |
| Very large commit count             | Paginate with a 100-commit cap. Commit payloads are small.                                                                                                                                            |
| Empty description                   | That component scores 0; inference leans on commits and the linked issue.                                                                                                                             |
| No linked issue                     | That component scores 0. See deviation below.                                                                                                                                                         |
| Description contradicts the code    | Already covered by the existing `contradicted` status and `unstatedChanges`. No new machinery.                                                                                                        |

**Deviation from Plan #2 step 6**, which says to "remove that 20% from signal" when no issue is
linked. Renormalizing would score an issue-less PR identically to one with an issue, defeating the
purpose of measuring available signal. The score stays out of 100 and the component earns nothing.

---

## Testing

| Test                        | Covers                                                                                                                                                        |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `context.test.ts`           | `gatherContext` shape; **the assembled inference prompt contains no patch text** (no `@@` hunk markers)                                                       |
| `confidence.test.ts`        | Per-component boundaries, band thresholds, empty description, missing issue, scattered vs. focused scope                                                      |
| `infer.test.ts`             | Inference prompt assembly, no API calls                                                                                                                       |
| `render.test.ts` (extended) | Source column, merged ordering, column omitted when no inferred claims, signal score omitted when inference did not run, `<60` disclaimer, marker still first |

Diff-blindness is the design's central claim, so it gets an executable guard rather than only a
type.

`engine.ts` stays API-bound and without unit tests, matching today's approach. Manual scripts:
add `scripts/try-infer.ts` (paid, mirroring `try-engine.ts`) and extend
`try-engine-adversarial.ts` with a thin-description PR case.

**Both `packages/core/src/__fixtures__/*.review.json` files must be regenerated** for the new
schema. `apps/web` imports them by relative path, so the web build breaks otherwise.

---

## Documentation

- **README** — cost doubling, new flags, updated pipeline diagram.
- **`docs/cli.md`** — the two new flags.
- **`CLAUDE.md`** — two new invariants: diff-blindness of the inference stage, and code-owned
  provenance of stated vs. inferred claims.

---

## Success check

Adapted from Plan #2. Run Rubric against a PR whose only intent signal is a title like
`fix: prevent double-click on submit button`:

1. `inferSpec()` produces a spec covering the disabled state, in-flight visibility, and blocked
   repeat submissions, each with a confidence rating.
2. The review grades the diff against those items, merged into one table with stated claims.
3. `signalScore` reflects the thin context (low band) and the review carries the disclaimer.
4. `--show-inferred-spec` prints the spec grouped into behavior / edge cases / acceptance criteria.
5. `--no-infer` produces output byte-identical to today's stated-claims-only review.
