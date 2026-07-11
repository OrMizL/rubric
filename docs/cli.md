# `rubric` CLI

A read-only command that reviews a GitHub pull request for
intent-vs-implementation alignment and prints the result to your terminal. It
never posts a comment or writes to the PR.

## Usage

```bash
rubric scan <pr> [options]
rubric <pr> [options]
```

`<pr>` is either a pull request URL
(`https://github.com/owner/repo/pull/123`) or the shorthand `owner/repo#123`.

## Options

| Flag                    | Effect                                           |
| ----------------------- | ------------------------------------------------ |
| `--json`                | Print the raw review JSON.                       |
| `--markdown`            | Print the GitHub-flavored Markdown report.       |
| `--model <id>`          | Claude model id (default: `claude-opus-4-8`).    |
| `--max-diff-tokens <n>` | Token budget for the assembled diff.             |
| `--fail-on-misaligned`  | Exit with code 2 when the verdict is misaligned. |
| `--no-color`            | Disable ANSI colors.                             |
| `-h`, `--help`          | Show help.                                       |

## Environment

- `ANTHROPIC_API_KEY` — required; your Anthropic API key.
- `GITHUB_TOKEN` (or `GH_TOKEN`) — optional; raises rate limits and allows
  reading private repositories.

## Example

```bash
node --env-file=.env packages/cli/dist/rubric.cjs scan sindresorhus/slugify#73
```
