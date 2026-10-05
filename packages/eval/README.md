# @rubric/eval

Internal eval harness. Runs Rubric over a frozen, labeled set of PR cases and reports catch
rate per mutation, false-alarm rate on honest PRs, smuggle detection by size, claim recall and
precision, stability across samples, and cost and latency. Design:
`docs/superpowers/specs/2026-10-05-eval-harness-design.md`.

Data lives outside this repo. Point `RUBRIC_EVAL_DATA` at a checkout of the private data repo:

    sources.txt        owner/repo#n, one per line (curated by hand)
    behavior.json      { "<sourceId>": true } for sources whose diff changes behavior
    sources/           fetched PullRequestData snapshots
    cases/             accepted cases (input + label + meta)
    drafts/            LLM-drafted cases awaiting review
    splits.json        { dev, full }
    generation-cache/  cached drafting calls
    output-cache/      cached engine outputs
    runs/<runId>/      manifest.json, results.jsonl, report.md, report.json

## Workflow

    export RUBRIC_EVAL_DATA=~/rubric-evals GITHUB_TOKEN=$(gh auth token)
    pnpm -r build                                  # eval imports core's built dist
    pnpm eval seed                                 # free: slugify#73 honest + docs-lie
    pnpm eval fetch                                # free: sources.txt → sources/
    pnpm eval generate --scripted                  # free: control, control_stripped, swap, scope_lie
    pnpm eval generate --drafted --limit 5 --max-usd 5   # PAID: claim_drop + smuggle drafts
    pnpm eval review                               # accept/reject/edit each draft
    pnpm eval split                                # stratified dev subset (--force to overwrite)
    pnpm eval run --split dev --samples 3 --max-usd 5           # PAID
    pnpm eval report $RUBRIC_EVAL_DATA/runs/<runId>
    pnpm eval compare <runDirA> <runDirB>

`seed` writes `splits.json` only if it is absent, so a curated split survives re-seeding.
`report` and `compare` refuse to score a run whose cases changed since it ran (each manifest
stores a per-case hash of input and label); `--allow-changed-cases` overrides and is noted in the
report header. `split` refuses to overwrite an existing `splits.json` without `--force`.
Numeric flags are validated (`src/args.ts`) and `--split` must be `dev` or `full`.

**Money:** `run` (any split, including `dev`) and `generate --drafted` both spend real money.
Nothing else does.

`run` flags: `--split dev|full`, `--config <name>`, `--samples <int>`, `--max-usd <n>` (default 5;
the run aborts if the estimate exceeds it), `--concurrency <int>` (default 4),
`--assume-output-tokens <n>` (default 6000; output size assumed for the pre-run estimate).

`generate --drafted` flags: `--limit <int>` (required; number of sources to draft),
`--max-usd <n>` (default 5; drafting stops before the next source once cumulative spend reaches
it). Per-draft and cumulative cost are printed; cached drafts cost nothing. Template and size
for each smuggle derive from a hash of the source key, so adding a source never changes the
cases of existing ones.

Paid commands need `ANTHROPIC_API_KEY` (use `node --env-file=.env` or export it) and refuse to
run when `CI` is set. `run` prints an estimate and aborts if it exceeds `--max-usd`.

Configs (`src/configs.ts`): `default` (Opus 5.5), `no-infer`, `opus-4-8`, `sonnet-5-5`, `budget-8k`.

## Rules

- Tune prompts on `dev`. Run `full` only at milestones, or the full-set numbers stop meaning anything.
- Cached outputs are keyed on prompt text, the resolved token budgets, and an `engineFingerprint`
  (sha256 of `@rubric/core`'s built entry). Any rebuilt core change re-runs cached cases, not
  only edits to `prompt.ts` or `infer.ts`.
- Only model parse failures are cached as error results. Transport/API errors retry on the next run.
- Rates carry 95% Wilson intervals. At ~30 cases per mutation that is about ±14 points.
- The harness scores outputs. It never alters them.

## Caveats when publishing numbers

- The smuggle anchor only checks that the target file is flagged at medium risk or higher. The
  file is already in the diff, so a reviewer may flag it for unrelated reasons. Compare against
  how often controls flag that same file before claiming a catch rate.
- The `scope_lie` keyword anchors include generic phrases, so a match can be incidental.
- Claim matching is keyword-based and undercounts paraphrases: claim recall is a lower bound.
