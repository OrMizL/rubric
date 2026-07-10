# Rubric

**Does this pull request actually do what it says it does?**

Rubric is a PR reviewer with exactly one job: check whether a pull request's
**implementation matches its stated intent**. It is not a linter, a style
checker, or a general-purpose "AI reviewer." It reads the PR's title, body, and
linked issue as a set of _claims_, then reads the diff to decide whether each
claim is true — and flags anything the diff changes that the description never
mentioned.

## What it produces

For every PR, Rubric returns one verdict — **aligned**, **partially aligned**,
or **misaligned** — backed by three things:

1. **A claim-by-claim table.** Each promise the PR makes is marked
   ✅ implemented, 🟡 partial, ⭕ missing, or ❌ contradicted, with a permalink
   to the code that proves it.
2. **Unstated changes.** Anything the diff does that the description didn't
   promise, each tagged with a risk level — the "wait, why does this PR also
   touch the auth middleware?" catch.
3. **An honest summary** of where intent and code diverge.

It even infers the _implicit_ claims — the "and nothing else changes" that every
bugfix silently promises.

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

## How it works

```
GitHub PR ──► fetch intent + diff ──► budget the diff ──► Claude (structured output) ──► render
              title/body/issue        rank & fit to        one call, verdict +          Markdown
              + per-file patches       token budget         claims + unstated            comment / terminal
```

The diff is filtered (lockfiles, minified and generated files dropped), ranked
(source before config before docs), and trimmed to a token budget using Claude's
_real_ tokenizer before a single structured-output call returns a typed,
schema-validated review. The `truncated` flag is set deterministically by the
budgeter, never trusted from the model.

## Cost

A typical review is one Claude call — roughly **$0.05–0.35** on `claude-opus-4-8`
depending on diff size, capped by `max-diff-tokens`.

## Repository layout

| Package                              | What it is                                                      |
| ------------------------------------ | --------------------------------------------------------------- |
| [`packages/core`](packages/core)     | The engine: GitHub I/O, diff budgeting, prompt, review, render. |
| [`packages/action`](packages/action) | GitHub Action wrapper.                                          |
| [`packages/cli`](packages/cli)       | Read-only local scan command.                                   |

Built as a pnpm workspace. `pnpm -r build && pnpm -r typecheck && pnpm -r test`.
