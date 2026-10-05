# @ormizl/rubric

Checks whether a GitHub pull request's code matches what its description claims: each stated claim
gets a verdict against the diff, with evidence, plus a list of changes the description never
mentions. Read-only: it never writes to the PR, so it works on any public repository.

```bash
export ANTHROPIC_API_KEY=sk-ant-...
npx @ormizl/rubric scan owner/repo#123      # or a PR URL
```

Flags: `--json`, `--markdown`, `--no-infer`, `--show-inferred-spec`, `--model <id>`,
`--fail-on-misaligned` (exit code 2). Set `GITHUB_TOKEN` for private repos or higher rate limits.

Requires Node 20+. Full documentation, the GitHub Action, and evaluation results:
https://github.com/OrMizL/rubric

MIT licensed.
