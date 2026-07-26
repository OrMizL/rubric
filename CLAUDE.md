# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

Rubric reviews a GitHub pull request for one thing only: does the **implementation match the stated intent**? It decomposes the PR title/body/linked issue into checkable claims, verdicts each against the diff, and inventories changes the description never mentioned. It is deliberately _not_ a linter or general "AI reviewer" — resist scope creep into style/perf/quality review.

pnpm workspace, Node ≥ 20, TypeScript ESM, no lint step (Prettier only).

## Commands

```bash
pnpm install
pnpm -r build && pnpm -r typecheck && pnpm -r test   # full check, in this order
pnpm format                                          # prettier --write
```

**Order matters.** `packages/action`, `packages/cli`, and `apps/web` consume `@rubric/core` through its _built_ `dist/index.d.ts`. Typechecking a fresh clone before `pnpm -r build` fails. CI (`.github/workflows/ci.yml`) enforces build → typecheck → test.

Per-package / single test:

```bash
pnpm --filter @rubric/core test
pnpm --filter @rubric/core exec vitest run src/budget.test.ts
pnpm --filter @rubric/core exec vitest run -t "drops lockfiles"
pnpm --filter @rubric/cli build && node packages/cli/dist/rubric.cjs scan owner/repo#123
pnpm --filter @rubric/web dev                        # static demo, no API calls
```

`apps/web` has no `test` script; `pnpm -r test` uses `--passWithNoTests` throughout.

### Manual scripts (`packages/core/scripts/`)

Not part of `pnpm test` — they hit the network.

```bash
GITHUB_TOKEN=$(gh auth token) pnpm exec tsx packages/core/scripts/try-github.ts      # free
GITHUB_TOKEN=$(gh auth token) pnpm exec tsx packages/core/scripts/show-prompt.ts     # free
GITHUB_TOKEN=$(gh auth token) node --env-file=.env --import tsx \
  packages/core/scripts/try-engine.ts                                               # PAID
GITHUB_TOKEN=$(gh auth token) node --env-file=.env --import tsx \
  packages/core/scripts/try-engine-adversarial.ts                                   # PAID
```

`try-engine-adversarial.ts` is the prompt-quality regression check: it feeds a real code-only diff with a fabricated docs-only description and expects `misaligned`. Run it after touching `prompt.ts`.

Env: `ANTHROPIC_API_KEY` (required for engine runs), `GITHUB_TOKEN`/`GH_TOKEN` (optional; rate limits + private repos). Local `.env` is gitignored.

## Architecture

One engine, three front doors. All review logic lives in `packages/core`; `action`, `cli`, and `web` are thin.

```
github.ts ──► budget.ts ──► prompt.ts ──► engine.ts ──► render.ts / terminal.ts
fetch intent    filter,        system +      one parse      Markdown comment
+ per-file      rank,          intent +      call, Zod      or ANSI terminal
patches         truncate       diff          schema out
```

`packages/core/src/`:

- **`types.ts`** — shared interfaces threaded through the whole pipeline (`ChangedFile`, `PullRequestData`, `RUBRIC_COMMENT_MARKER`).
- **`github.ts`** — Octokit wrapper. `getPullRequestData()` is the single fetch entry point; parses closing keywords (`fixes #42`) to pull the linked issue. `upsertComment()` is the _only_ write.
- **`budget.ts`** — pure and unit-tested. `filterFiles` (drops lockfiles/`*.min.*`/`dist/`/`.snap`/patchless files) → `rankFiles` (stable sort: src > config > tests > docs > other) → `truncateToBudget`. Takes an injected `TokenCounter` so tests pass a sync fake.
- **`schema.ts`** — the Zod `ReviewSchema` that _is_ the contract. Structured output, not prose parsing — that's why evidence becomes permalinks and verdicts can drive CI.
- **`prompt.ts`** — system prompt (the product's actual behavior spec) + user prompt assembly.
- **`engine.ts`** — orchestrates the above into one `client.messages.parse` call with `zodOutputFormat`.
- **`render.ts`** — `Review` → Markdown, with GitHub blob permalinks built from `headSha`.
- **`index.ts`** — the public surface. New exports must be added here or dependents can't see them.

Consumers: `packages/action/src/main.ts` (job summary always; PR comment opt-in), `packages/cli/src/{run,target,terminal}.ts` (read-only, exit 2 on `--fail-on-misaligned`), `apps/web` (static React demo replaying committed fixtures).

## Invariants

- **`truncated` is code-owned.** `engine.ts` overwrites the model's `truncated` with the budgeter's value. The model judges; the code states mechanical facts. Never relax this.
- **Real token counts only.** Budgeting uses `client.messages.countTokens`, never a chars÷4 heuristic. Only `show-prompt.ts` estimates, and only for display.
- **Once omission starts, everything after is omitted** in `truncateToBudget`, so a small low-rank file can't leapfrog a large higher-rank one.
- **Single idempotent comment.** `upsertComment` finds the existing comment by the hidden `<!-- rubric-review -->` marker that `reviewToMarkdown` emits. Re-running must never spam a PR. Any renderer change must keep emitting the marker first.
- **`comment: false` by default.** The Action is report-only; the CLI never writes at all. Respect for repos you don't own is a design position, not an oversight.
- **`packages/action/dist/index.cjs` is committed** (force-added past the gitignored `dist/`) — GitHub Actions runs it with no install step. Rebuild and commit it whenever `packages/action` or `packages/core` changes, or the Action ships stale code. Both action and CLI bundle with `noExternal: [/./]`.

## Conventions

- Prettier: 4-space indent, 100 cols, double quotes, trailing commas (2-space for yml/json/md). No ESLint.
- `strict` + `noUncheckedIndexedAccess` — indexed access is `T | undefined`; expect `!` or explicit guards in parsers.
- Relative imports carry the `.js` extension (ESM + `moduleResolution: bundler`).
- Comments explain _why_ a rule exists (see `budget.ts`, tsup configs), not what the line does. Match that density.
- Default model id lives in three places that must stay in sync: `DEFAULT_MODEL` in `engine.ts`, the `model` default in `packages/action/action.yml`, and the fallback in `packages/action/src/main.ts`.
- `apps/web` imports review fixtures by relative path from `packages/core/src/__fixtures__/`. Renaming those files breaks the web build.

## Dogfooding

`.github/workflows/rubric.yml` runs the Action on this repo's own PRs from the local `./packages/action` path, so every PR here exercises the exact code on that branch. PRs #1 (aligned) and #2 (misaligned trap) are the reference validation pair described in `README.md`.
