# Rubric

**Does this pull request actually do what it says it does?**

[![Dogfood: PR #1 — Aligned](https://img.shields.io/badge/✅_Aligned-PR_%231-2ea44f)](https://github.com/OrMizL/rubric/pull/1)
[![Dogfood: PR #2 — Misaligned](https://img.shields.io/badge/❌_Misaligned-PR_%232-d14836)](https://github.com/OrMizL/rubric/pull/2)
[![CI](https://github.com/OrMizL/rubric/actions/workflows/ci.yml/badge.svg)](https://github.com/OrMizL/rubric/actions)

Rubric is a PR reviewer with exactly one job: check whether a pull request's
**implementation matches its stated intent**. It is not a linter, a style
checker, or a general-purpose "AI reviewer." It reads the PR's title, body, and
linked issue as a set of _claims_, then reads the diff to decide whether each
claim is true — and flags anything the diff changes that the description never
mentioned.

---

## The gap

The most dangerous PRs aren't the ones with ugly code — those get caught. The
dangerous ones are the ones whose **description doesn't match the diff**:

- A "docs: fix typo" that also quietly edits auth middleware.
- A "Refactor, no behavior change" that changes behavior.
- A PR that claims to add feature X but the code for X never landed.

Humans skim descriptions and trust them. Rubric doesn't.

---

## What it produces

For every PR, Rubric returns one verdict — **aligned**, **partially aligned**,
or **misaligned** — backed by three things:

1. **A claim-by-claim table.** Each promise the PR makes is marked
   ✅ implemented, 🟡 partial, ⭕ missing, or ❌ contradicted, with a permalink
   to the code that proves it.
2. **Unstated changes.** Anything the diff does that the description didn't
   promise, each tagged with a risk level — the "wait, why does this PR also
   touch the auth middleware?" catch. This is the crown jewel.
3. **An honest summary** of where intent and code diverge.

It even infers the _implicit_ claims — the "and nothing else changes" that every
bugfix silently promises.

---

## Example

A PR titled _"docs: add Troubleshooting section"_ that actually adds a code
function instead ([see it live →](https://github.com/OrMizL/rubric/pull/2)):

> ## ❌ Misaligned
>
> The PR claims to be a documentation-only change, but the diff contains no
> documentation changes at all. Instead, it adds a new `formatTarget` function
> to a TypeScript source file, directly contradicting the stated intent.
>
> |     | Claim                                         | Evidence            |
> | :-: | --------------------------------------------- | ------------------- |
> | ⭕  | Adds a Troubleshooting section to docs/cli.md | —                   |
> | ❌  | Documentation-only, no code changes           | `target.ts#L32-L36` |
>
> ### ⚠️ Unstated changes
>
> - 🟠 **target.ts** (medium risk) — Adds a new exported `formatTarget` function
>   not mentioned anywhere in the PR description.

An honest PR gets a clean ✅
([example →](https://github.com/OrMizL/rubric/pull/1)).

---

## Validation: Rubric reviews Rubric

The MVP was proven on its own repo with two deliberately-crafted PRs:

| PR | Title | Actual diff | Rubric verdict |
|---|---|---|---|
| [#1](https://github.com/OrMizL/rubric/pull/1) | Honest docs addition | Just docs | ✅ Aligned |
| [#2](https://github.com/OrMizL/rubric/pull/2) | "docs-only change" (trap) | Added `formatTarget` code function | ❌ Misaligned |

Both verdict paths, and the live comment-write path, exercised end to end. It
caught a lie that a human skimming the title would have merged.

---

## Two ways to run it

Same engine ([`@rubric/core`](packages/core)), two front doors.

### As a GitHub Action — guard your own repo automatically

Add `.github/workflows/rubric.yml` and one repository secret
(`ANTHROPIC_API_KEY`):

```yaml
name: Rubric
on: pull_request
permissions:
  contents: read
  pull-requests: write
jobs:
  review:
    runs-on: ubuntu-latest
    steps:
      - uses: OrMizL/rubric/packages/action@main
        with:
          anthropic-api-key: ${{ secrets.ANTHROPIC_API_KEY }}
          comment: true # opt in to PR comments; default is report-only
```

| Input                | Default               | Description                                    |
| -------------------- | --------------------- | ---------------------------------------------- |
| `anthropic-api-key`  | —                     | **Required.** Your Anthropic API key.          |
| `github-token`       | `${{ github.token }}` | Reads the PR and (opt-in) posts the comment.   |
| `model`              | `claude-opus-4-8`     | Claude model id.                               |
| `max-diff-tokens`    | `50000`               | Token budget for the diff.                     |
| `comment`            | `false`               | Post the review as a PR comment.               |
| `fail-on-misaligned` | `false`               | Fail the check when the verdict is misaligned. |

By default the Action is **report-only** — it writes the review to the workflow
job summary and never comments unless you set `comment: true`. Outputs `verdict`
and `misaligned` let later steps branch on the result.

### As a CLI — scan _any_ PR, read-only, from your terminal

The CLI never writes to the PR, so it works on repositories you don't own.

```bash
pnpm install && pnpm --filter @rubric/cli build

export ANTHROPIC_API_KEY=sk-ant-...
node packages/cli/dist/rubric.cjs scan sindresorhus/slugify#73
```

Accepts a PR URL or `owner/repo#123`. Useful flags: `--json`, `--markdown`,
`--model`, `--fail-on-misaligned` (exit code 2). See [`docs/cli.md`](docs/cli.md).

---

## How it works

```
GitHub PR ──► fetch intent + diff ──► budget the diff ──► Claude (structured output) ──► render
              title/body/issue        rank & fit to        one call, verdict +          Markdown
              + per-file patches       token budget         claims + unstated            comment / terminal
```

**Step by step:**

1. **Fetch** — One call assembles everything: PR title, body, linked issue (parsed
   from closing keywords like "fixes #42"), and every changed file with its per-file patch.
2. **Filter** — Drop noise: lockfiles, `*.min.*`, `dist/`, `.snap`, binaries.
3. **Rank** — Stable-sort by importance (`src > config > tests > docs > other`) so
   least-important files get cut first.
4. **Budget** — Greedily keep whole file patches while real token count (Claude's
   real `countTokens`, no heuristics) stays under `maxDiffTokens` (default 50k).
5. **Prompt** — Build the system prompt + PR's intent + budgeted diff.
6. **Review** — A single `messages.parse` call with structured output (Zod schema).
   One call in, one typed `Review` out.
7. **Render** — Turn the typed review into a Markdown comment (with GitHub
   permalinks) or colored terminal output.

### Key design decisions

- **Structured output, not prose parsing.** The model returns a schema-validated
  object, not free text. This is why evidence becomes permalinks and verdicts
  drive CI — the output is *data*.
- **`truncated` is code-owned, not model-owned.** The model judges; the code
  states facts. Never let the model self-report a mechanical truth about whether
  the diff was complete.
- **Single upserted comment, not check-run annotations.** Rubric's findings are
  *claim-level*, not line-level. A hidden marker (`<!-- rubric-review -->`)
  makes the comment idempotent — re-running never spams the PR.
- **`comment: false` by default.** Respect for repos you don't own. The job
  summary always gets the report; commenting is opt-in.
- **Real token counting.** `countTokens` uses Claude's real tokenizer. No
  "chars ÷ 4" heuristics, no surprises at the budget boundary.

---

## Cost

A typical review is one Claude call — roughly **$0.05–0.35** on `claude-opus-4-8`
depending on diff size, capped by `max-diff-tokens` (default 50k tokens).
Using Sonnet instead of Opus cuts cost ~40%.

---

## Repository layout

| Package                              | What it is                                                      |
| ------------------------------------ | --------------------------------------------------------------- |
| [`packages/core`](packages/core)     | The engine: GitHub I/O, diff budgeting, prompt, review, render. |
| [`packages/action`](packages/action) | GitHub Action wrapper. Bundled, committed dist.                 |
| [`packages/cli`](packages/cli)       | Read-only local scan command.                                   |

Built as a pnpm workspace. `pnpm -r build && pnpm -r typecheck && pnpm -r test`.

> **Note:** CI order must be `build → typecheck → test` — typechecking fresher
> clones fails without a built `dist/` because `packages/action` and
> `packages/cli` depend on `@rubric/core`'s compiled declarations.