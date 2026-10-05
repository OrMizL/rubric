# Evaluation

How well does Rubric do its one job: noticing when a pull request's code doesn't match its
description? This page describes how that was measured and what the numbers do and don't support.

Measured on 2026-10-05 with Rubric v1.0.0 (`claude-opus-5-5`, inference on, one sample per case).

## Method

**Ground truth by construction.** We took 35 honest, merged pull requests from 13 well-maintained
TypeScript/JavaScript repositories (ky, zod, hono, TanStack Query, tRPC, date-fns, axios, fastify,
SWR, Vitest, h3, execa, drizzle-orm). Each source PR was required to be merged, described, mostly
TS/JS, 2–30 files, and fully visible through the GitHub API.

Each source PR was then **mutated** in ways that create a known problem, so the correct answer is
known in advance:

| Mutation         | What changes                                                         | A correct review…                                    |
| ---------------- | -------------------------------------------------------------------- | ---------------------------------------------------- |
| control          | nothing                                                              | does not call it misaligned                          |
| control_stripped | commit messages and labels removed                                   | does not call it misaligned                          |
| swap             | description replaced with another repository's PR description        | calls it misaligned                                  |
| scope_lie        | "No behavior change." appended to a PR that changes behavior         | marks that claim contradicted                        |
| claim_drop       | the code implementing one stated claim is removed                    | marks that claim missing or partial                  |
| smuggle          | a small unmentioned risky change is inserted (tracking, auth bypass) | lists it as an unstated change, risk medium or above |

claim_drop and smuggle cases were drafted by Claude and **accepted or rejected by a human, one by
one**. Smuggles that were harmless or never executed were rejected, so every accepted smuggle is
something a reviewer genuinely should flag. Scoring is deterministic (verdicts, file paths, risk
levels, claim keywords); there is no LLM judge.

## Results

179 cases.

| What was measured                         | Result      | 95% interval |
| ----------------------------------------- | ----------- | ------------ |
| False alarms on honest PRs (`misaligned`) | **0 / 66**  | 0–5.5%       |
| Swapped descriptions caught               | **35 / 35** | 90–100%      |
| Missing implementations caught            | **32 / 32** | 89–100%      |
| Smuggled risky changes caught             | **17 / 17** | 82–100%      |
| False "no behavior change" claims caught  | **25 / 27** | 77–98%       |
| Real mismatches in merged PRs (see below) | **2 / 2**   | —            |
| Honest PRs rated `partially_aligned`      | 8 / 66      | 6–22%        |

Intervals are Wilson score intervals. With 17–35 cases per row, a perfect score supports "the true
rate is probably above ~85–90%", not "100%".

Cost and latency per PR: **$0.146 mean, $0.22 p90; 47 s mean, 70 s p90**. The inference stage is
about $0.03 and 12 s of that.

## Two real catches

Rubric was run on the unmodified source PRs as controls, and twice it flagged an "honest" PR as
misaligned. Both times it was right: the description and the merged code disagree.

- **[unjs/h3#1485](https://github.com/unjs/h3/pull/1485)**: the description says a thrown object
  with a valid `status` (e.g. `{ status: 400 }`) is honored as shorthand. The merged code documents
  that a non-Error object is "never trusted to shape the response, not even via a `status`
  shorthand", and a test named _"status on a thrown object is never honored"_ asserts a 500.
- **[unjs/h3#1513](https://github.com/unjs/h3/pull/1513)**: the description says the
  reseal-past-halfway optimization was "**deliberately not** implemented". The merged code
  implements it and documents that sign-out happens "between `idleTimeout / 2` and `idleTimeout`",
  and it names the timestamp field `lastSeenAt` where the description says `updatedAt`.

In both cases the design evidently changed during review and the description wasn't updated, which
is exactly the drift Rubric is built to catch. Both are now labeled as real, hand-verified cases.

## Caveats

- **The synthetic cases are on the easy side.** Near-perfect scores mean this set can't yet show
  fine differences between prompt or model versions. Harder variants (descriptions borrowed from the
  same repository, subtler claim drops) are planned.
- **Some labels were corrected after seeing results.** Two controls became the real cases above, two
  scope_lie sources were reclassified as not changing behavior for existing users, and one
  claim_drop was removed because the description never actually made that claim. Each correction
  was verified against the diff.
- **One sample per case.** Run-to-run consistency of verdicts has not been measured yet.
- **TypeScript/JavaScript only**, and PRs of 2–30 files.
- `partially_aligned` on honest PRs is not counted as a false alarm. Real PRs often have small
  undescribed changes, and the Action only fails CI on `misaligned`.

## Reproducing

The harness is open source in [`packages/eval`](../packages/eval). The case data is kept in a private
repository because it attaches fabricated "smuggled" changes to real projects' code; the harness
can build an equivalent set from any list of PRs (`fetch`, `generate`, `review`, `run`, `report`).
