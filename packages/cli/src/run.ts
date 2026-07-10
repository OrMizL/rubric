import {
    GitHubClient,
    reviewPullRequest,
    reviewToMarkdown,
    DEFAULT_MODEL,
    type Review,
} from "@rubric/core";
import { parseTarget } from "./target.js";
import { renderTerminal } from "./terminal.js";

const HELP = `rubric — scan a GitHub pull request for intent-vs-implementation alignment

Usage:
  rubric scan <pr> [options]
  rubric <pr> [options]

  <pr>   A pull request URL (https://github.com/owner/repo/pull/123)
         or the shorthand owner/repo#123.

Options:
  --json                 Print the raw review JSON.
  --markdown             Print the GitHub-flavored Markdown report.
  --model <id>           Claude model id (default: ${DEFAULT_MODEL}).
  --max-diff-tokens <n>  Token budget for the diff (default: engine default).
  --fail-on-misaligned   Exit with code 2 when the verdict is misaligned.
  --no-color             Disable ANSI colors.
  -h, --help             Show this help.

Environment:
  ANTHROPIC_API_KEY  Required. Your Anthropic API key.
  GITHUB_TOKEN       Optional (GH_TOKEN also honored). Raises rate limits and
                     allows reading private repositories.

This command is read-only: it never posts a comment or writes to the PR.`;

type OutputMode = "terminal" | "json" | "markdown";

interface Args {
    target: string;
    mode: OutputMode;
    model: string | undefined;
    maxDiffTokens: number | undefined;
    failOnMisaligned: boolean;
    color: boolean;
    help: boolean;
}

/** Parse argv (without node/script) into structured options. */
function parseArgs(argv: string[]): Args {
    const args: Args = {
        target: "",
        mode: "terminal",
        model: undefined,
        maxDiffTokens: undefined,
        failOnMisaligned: false,
        color: process.stdout.isTTY === true && !process.env.NO_COLOR,
        help: false,
    };
    const positionals: string[] = [];

    for (let i = 0; i < argv.length; i++) {
        const a = argv[i]!;
        switch (a) {
            case "-h":
            case "--help":
                args.help = true;
                break;
            case "--json":
                args.mode = "json";
                break;
            case "--markdown":
                args.mode = "markdown";
                break;
            case "--fail-on-misaligned":
                args.failOnMisaligned = true;
                break;
            case "--no-color":
                args.color = false;
                break;
            case "--model":
                args.model = argv[++i];
                break;
            case "--max-diff-tokens":
                args.maxDiffTokens = Number(argv[++i]);
                break;
            case "scan":
                // Optional leading subcommand; the target is the next positional.
                break;
            default:
                if (a.startsWith("-")) throw new Error(`Unknown option: ${a}`);
                positionals.push(a);
        }
    }

    args.target = positionals[0] ?? "";
    return args;
}

/** Run the CLI. Returns a process exit code; never throws for expected errors. */
export async function run(argv: string[]): Promise<number> {
    let args: Args;
    try {
        args = parseArgs(argv);
    } catch (err) {
        process.stderr.write(`${(err as Error).message}\n\n${HELP}\n`);
        return 1;
    }

    if (args.help) {
        process.stdout.write(`${HELP}\n`);
        return 0;
    }

    if (!args.target) {
        process.stderr.write(`Missing PR reference.\n\n${HELP}\n`);
        return 1;
    }

    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
        process.stderr.write("ANTHROPIC_API_KEY is not set.\n");
        return 1;
    }

    let target;
    try {
        target = parseTarget(args.target);
    } catch (err) {
        process.stderr.write(`${(err as Error).message}\n`);
        return 1;
    }

    const githubToken = process.env.GITHUB_TOKEN ?? process.env.GH_TOKEN ?? "";
    const model = args.model ?? DEFAULT_MODEL;

    let review: Review;
    let headSha: string;
    try {
        const gh = new GitHubClient({ token: githubToken });
        process.stderr.write(
            `[rubric] fetching ${target.owner}/${target.repo}#${target.number}…\n`,
        );
        const pr = await gh.getPullRequestData(target.owner, target.repo, target.number);
        headSha = pr.headSha;
        review = await reviewPullRequest(
            {
                title: pr.title,
                body: pr.body,
                linkedIssue: pr.linkedIssue,
                files: pr.files,
            },
            { anthropicApiKey: apiKey, model, maxDiffTokens: args.maxDiffTokens },
        );
    } catch (err) {
        process.stderr.write(`Review failed: ${(err as Error).message}\n`);
        return 1;
    }

    if (args.mode === "json") {
        process.stdout.write(`${JSON.stringify(review, null, 2)}\n`);
    } else if (args.mode === "markdown") {
        process.stdout.write(
            reviewToMarkdown(review, {
                owner: target.owner,
                repo: target.repo,
                headSha,
                model,
            }),
        );
    } else {
        process.stdout.write(`\n${renderTerminal(review, { color: args.color })}\n`);
    }

    if (args.failOnMisaligned && review.verdict === "misaligned") return 2;
    return 0;
}
