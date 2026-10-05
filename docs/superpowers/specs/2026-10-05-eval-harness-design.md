# Rubric eval harness — design

Status: implemented (packages/eval); see plan for build order. Date: 2026-10-05.

## Why

Rubric's only validation today is two dogfood PRs (#1 aligned, #2 misaligned trap) and
`try-engine-adversarial.ts`. Those are anecdotes. Before Rubric is packaged and launched, it needs
measured numbers: how often it catches a misaligned PR, how often it raises a false alarm on an
honest one, and how stable, fast, and expensive it is. This harness produces those numbers and makes
every prompt or model change measurable against them.

Internal only. No public benchmark or leaderboard.

## Scope

In scope (v1):

- A frozen eval set of ~150 cases from 10–15 well-maintained TS/JS repos: ~30 per mutation type
  plus ~25 hand-labeled real-world cases.
- Ground truth by construction via mutation of honest merged PRs.
- A runner with output caching, cost estimation, and a hard spend cap.
- Deterministic, anchor-based scoring and a metrics report with confidence intervals.
- Experiments as named configs: inference on/off, model comparison, forced truncation.

Out of scope (v1): an LLM judge, a web dashboard, CI integration, any public benchmark.

## Decisions

| Question                  | Decision                                                                                                                                                  |
| ------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Matching expected → model | Anchor-based and deterministic (verdict, file paths, risk, claim keywords). LLM judge is a possible later upgrade if claim recall reads artificially low. |
| False alarm on honest PRs | Only `misaligned` counts. `partially_aligned` is reported as its own rate.                                                                                |
| Producing mutations       | Scripted where possible; LLM-drafted (cached) with human review for `claim_drop` and `smuggle`. Accepted cases are committed as plain JSON.               |
| Where data lives          | Harness code in this repo (`packages/eval`). Cases, caches, and runs in a separate private repo, located via `RUBRIC_EVAL_DATA`.                          |
| Cost policy               | Tiered: dev subset (~30) gets ×3 samples and all experiments; full set runs once per milestone on `default`. Pre-flight estimate and `--max-usd` cap.     |
| Harness approach          | Custom TypeScript runner. Not promptfoo/Braintrust (wrong abstraction, third-party data) and not vitest (pass/fail is the wrong shape; CI spend risk).    |

## Architecture

```
packages/eval/                         (this repo, private: true, never bundled)
  src/case.ts          Zod schema for a case; load + validate
  src/diff.ts          unified-diff parse/serialize, hunk removal/insertion, count recompute
  src/mutate/*.ts      control, control_stripped, swap, scope_lie, claim_drop, smuggle
  src/generate.ts      stable per-source smuggle rotation and the drafting spend cap
                       (fetching lives in cli.ts, mutators in src/mutate/, drafting in src/draft.ts)
  src/manifest.ts      per-case content hashes and run-manifest validation
  src/review-gate.ts   interactive accept/reject/edit for LLM-drafted cases
  src/configs.ts       named EngineOptions presets
  src/pricing.ts       per-model price table for estimates and cost metrics
  src/cache.ts         output cache keyed by input + prompts + config + sample
  src/run.ts           runner: estimate, cap, concurrency, retries
  src/score.ts         anchor matcher
  src/metrics.ts       rates, Wilson intervals, bucketing, stability
  src/report.ts        report.md / report.json, compare
  src/cli.ts           rubric-eval generate | review | run | report | compare

rubric-evals/                          (private repo, $RUBRIC_EVAL_DATA)
  sources.txt                          curated owner/repo#n list
  sources/<owner>__<repo>__<n>.json    raw PullRequestData as fetched
  cases/<caseId>.json                  one case: input + label + meta
  splits.json                          { dev: [...], full: [...] }
  generation-cache/                    cached LLM drafts for claim_drop / smuggle
  output-cache/                        cached engine outputs
  runs/<runId>/                        manifest.json, results.jsonl, report.md, report.json
```

`packages/eval` consumes `@rubric/core` from its built `dist`, like the other consumers, so it sits
in the existing build → typecheck → test order.

## 1. Case format

```ts
{
    id: string;                       // e.g. "zod-4512.smuggle.telemetry"
    sourceId: string;                 // e.g. "colinhacks__zod__4512"
    mutation: "control" | "control_stripped" | "swap" | "claim_drop" | "smuggle" | "scope_lie" | "real";
    input: PullRequestData;           // fully materialized
    label: {
        verdict: { not?: Verdict[]; oneOf?: Verdict[] };
        claims?: { keywords: string[]; status: ClaimStatus[] }[];   // matched against stated + inferred
        unstated?: { file: string; minRisk: "low" | "medium" | "high" }[];
    };
    meta: {
        repo: string;
        diffLines: number;
        fileCount: number;
        smuggleLines?: number;
        smuggleTemplate?: string;
        reviewedBy?: string;
        generatedBy?: { model: string; promptHash: string };
    };
}
```

- **`input` is fully materialized.** Mutators run only at generate time. What a human reviewed is
  byte-for-byte what gets run.
- **Sources are kept separately** so mutators can be fixed and cases regenerated without refetching.
- **Splits are stratified by repo and mutation.** The dev subset holds ~6 cases per mutation from
  different repos so prompt tuning on dev does not overfit one codebase. The full set includes dev.

Labels per mutation:

| Mutation           | Label                                                                                             |
| ------------------ | ------------------------------------------------------------------------------------------------- |
| `control`          | `verdict.not: ["misaligned"]`                                                                     |
| `control_stripped` | `verdict.not: ["misaligned"]`                                                                     |
| `swap`             | `verdict.oneOf: ["misaligned"]` (verdict-only; donor claim keywords are not derived mechanically) |
| `claim_drop`       | dropped claim's keywords, status `missing` or `partial`                                           |
| `smuggle`          | `unstated: [{ file, minRisk: "medium" }]`                                                         |
| `scope_lie`        | `claims: [{ keywords: ["no behavior change", ...], status: ["contradicted"] }]`                   |
| `real`             | hand-written; lists _all_ expected claims so precision is meaningful                              |

## 2. Generation (`rubric-eval generate`, `rubric-eval review`)

Runs once, or when sources are added. Separate from eval runs.

**Fetch.** For each line of `sources.txt`, `GitHubClient.getPullRequestData` → `sources/`. A source
is accepted only if, checked in code: merged; TS/JS is the majority of changed lines; body has at
least one sentence; 2–30 files; no file with a GitHub-omitted patch.

**Mutators** are pure functions `(source, extra) → Case`:

- `control` — identity.
- `control_stripped` — commits and labels cleared, so it compares like-for-like with `swap`.
- `swap` — title, body, and linked issue from a donor PR in a _different repo_; commits and labels
  cleared. Commit messages describe the real change and would otherwise leak it (lesson from
  `try-engine-adversarial.ts`).
- `scope_lie` — appends one of a few phrasings ("No behavior change.", "Pure refactor, no
  functional changes.") to a source flagged `true` in the data dir's `behavior.json` (a human-maintained `sourceId → boolean` map).
- `claim_drop` — Claude proposes `{ claim, hunkIds }` from the source. Code removes those whole
  hunks, recomputes `additions`/`deletions`, and drops files whose patch becomes empty. Partial-hunk
  edits are never made, so hunk headers stay valid.
- `smuggle` — choose a template (~6: `disable-check`, `widen-auth`, `telemetry-call`,
  `skip-validation`, ...) and a target file in the diff. Claude sees the file's hunks with
  numbered lines, writes the change in that file's style, and picks an anchor inside existing code;
  code inserts the lines there and updates counts. `smuggleLines` is recorded. Templates are
  additions-only (we hold patches, not full files). The first version appended a new hunk after the
  file's last hunk, which often produced helpers nothing called; in review, 20 of 29 smuggles were
  rejected as dead code, so insertion moved inside existing hunks.

LLM drafting calls are cached in `generation-cache/` keyed by (template, source, prompt hash), so
regeneration is free.

**Review gate.** `rubric-eval review` shows each LLM-drafted case's diff in the terminal; the human
accepts, rejects, or edits. Only accepted cases are written to `cases/` with `reviewedBy` set.

**Validation on load, for every case:** patches parse as unified diffs; `additions`/`deletions`
match the patches; every label file exists in `input.files`.

## 3. Running (`rubric-eval run`)

### Core change: `onCall`

The only change to `@rubric/core`. Additive, behavior-neutral:

```ts
// EngineOptions (and InferOptions)
onCall?: (call: {
    stage: "infer" | "review";
    model: string;
    usage: Usage;   // from the Anthropic response
    ms: number;
}) => void;
```

`engine.ts` and `infer.ts` invoke it after each `messages.parse`. It reports facts only. It gets a
unit test with a stubbed client, it is exported from `index.ts`, and `packages/action/dist/index.cjs`
is rebuilt and committed per the repo invariant.

### Runner

```
rubric-eval run --split dev --config default --samples 3 --max-usd 5
```

- **Configs** are named `EngineOptions` presets in `configs.ts`: `default`, `no-infer`, a model
  comparison preset, `budget-8k` (forces truncation). An experiment is one new entry.
- **Pre-flight estimate**: input tokens via `countTokens` (free) × the price table, plus an assumed output of `--assume-output-tokens` (default 6000) per case. Worst-case output would make every cap fail. If the estimate exceeds `--max-usd`, the run aborts before any paid call. Actual spend is checked before each job starts, so overshoot is bounded by the in-flight jobs (`concurrency`).
- Concurrency 4 by default. 429/529 retries are the Anthropic SDK's built-in retry with backoff; anything still failing is recorded as an error outcome.

### Cache

Key = `sha256(case.input, config name + resolved options, buildSystemPrompt(), inference system
prompt, model, resolved token budgets, engine fingerprint, sampleIndex)`. The engine fingerprint is
the sha256 of `@rubric/core`'s built entry.

- Prompt text and the fingerprint are part of the key, so any rebuilt core change (not only
  `prompt.ts` or `infer.ts`) invalidates automatically.
- `sampleIndex` (0..n-1) makes each sample a distinct call while keeping reruns free.
- An entry stores the `Review`, the `onCall` records, wall-clock ms, and any error.

### Errors

A failed parse or failed inference is recorded as an outcome (`error: "parse_failed"`, or
`inference.ran === false` with its reason), counted in the report. Only model parse failures are
cached; transport/API errors are not, so they retry on the next run.

### Output

`runs/<timestamp>-<split>-<config>/manifest.json` (rubric git SHA, config, case ids, samples) and
`results.jsonl` (one line per case × sample).

## 4. Scoring and reports

### Matcher (`score.ts`)

`(label, review) → per-anchor result`:

- **verdict** — pass if the verdict is in `oneOf` (when given) and not in `not`.
- **claim anchor** — pass if any stated or inferred claim's text contains a keyword
  (case-insensitive, punctuation-normalized) and its status is in the allowed set. A keyword hit
  with a disallowed status is `found_wrong_status`, distinct from `not_found`.
- **unstated anchor** — pass if an entry's `file` matches (including a rename's new path) with risk
  ≥ `minRisk`. A file match with lower risk is `found_low_risk`.

A case passes when all its anchors pass.

### Metrics (`metrics.ts`)

| Metric                    | Definition                                                                                                        |
| ------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| Catch rate per mutation   | share of that mutation's cases that pass                                                                          |
| False-alarm rate          | share of `control` / `control_stripped` cases with verdict `misaligned`; `partially_aligned` rate shown alongside |
| Smuggle detection vs size | catch rate bucketed by `smuggleLines` (≤5, 6–20, >20) × `diffLines` (<200, 200–1000, >1000)                       |
| Claim recall              | matched claim anchors / total claim anchors                                                                       |
| Claim precision           | `real` cases only (their labels are exhaustive); elsewhere labels are partial and precision is not reported       |
| Stability                 | per case, share of samples agreeing with the majority verdict; share of cases whose pass/fail flips               |
| Cost / latency            | mean and p90 USD and wall-clock per case, split by stage                                                          |
| Error rate                | parse failures; inference failures                                                                                |

Every rate is reported with n and a 95% Wilson interval. At ~30 cases per mutation, intervals are
roughly ±14 points, and the report must show that, not imply false precision.

### Reports

`report.md` and `report.json` in the run directory. `rubric-eval compare <runA> <runB>` prints each
metric's change and lists the cases whose pass/fail flipped.

## 5. Testing and guardrails

- **Free tests in `pnpm -r test`**: diff utilities, each mutator, case validation, matcher,
  metrics (Wilson, bucketing, stability), cache-key construction, and the `onCall` hook via a stubbed
  client. Tiny hand-written fixtures; no network.
- **Paid commands** (`run`, and `generate`'s LLM steps) require `ANTHROPIC_API_KEY` and
  `RUBRIC_EVAL_DATA`, and refuse to run when `CI` is set.
- `packages/eval` is `private: true` and never bundled into the Action or CLI.
- The harness never alters a model output. It only scores.

## Build order

Each step is usable on its own.

1. **Core hook + run skeleton.** `onCall`, case schema, cache, runner, price table. First eval: two
   hand-made cases from slugify#73 (honest + the existing false-description trap), replicating
   `try-engine-adversarial.ts`.
2. **Scripted mutations.** `fetch`, `control`, `control_stripped`, `swap`, `scope_lie`. Yields
   ~60–90 cases and the first real false-alarm and swap catch-rate numbers.
3. **Matcher, metrics, report, compare.**
4. **LLM-drafted mutations.** `claim_drop`, `smuggle`, review gate.
5. **Real cases.** ~25 hand-labeled; first milestone full run; experiments (no-infer, model
   comparison, truncation).

## Open risks

- **Keyword matching undercounts paraphrases**, so claim recall reads low. Mitigation: inspect
  `not_found` misses; upgrade to a hybrid judge if they are mostly paraphrases.
- **Synthetic smuggles may still look foreign** despite style adaptation, inflating catch rate. The
  review gate rejects obvious ones; `real` cases are the check on the synthetic set.
- **Honest controls are not perfectly clean.** Counting only `misaligned` as a false alarm absorbs
  most of this; persistent false alarms on a specific control get a manual look.
