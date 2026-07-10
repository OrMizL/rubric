import * as core from "@actions/core";
import * as github from "@actions/github";
import { GitHubClient, reviewPullRequest, reviewToMarkdown } from "@rubric/core";

/**
 * GitHub Action entry point.
 *
 * Reviews the pull request that triggered the workflow and writes the result to
 * the job summary. Posting a PR comment is opt-in via the `comment` input, so by
 * default the Action is report-only (matching the CLI's read-only stance).
 */
async function run(): Promise<void> {
    const pr = github.context.payload.pull_request;
    if (!pr) {
        core.setFailed(
            `Rubric runs on pull_request events; got "${github.context.eventName}". ` +
                `Trigger it with \`on: pull_request\`.`,
        );
        return;
    }

    const { owner, repo } = github.context.repo;
    const number = pr.number;
    const apiKey = core.getInput("anthropic-api-key", { required: true });
    const token = core.getInput("github-token", { required: true });
    const model = core.getInput("model") || undefined;
    const maxDiffTokensRaw = core.getInput("max-diff-tokens");
    const maxDiffTokens = maxDiffTokensRaw ? Number(maxDiffTokensRaw) : undefined;
    const shouldComment = core.getBooleanInput("comment");
    const failOnMisaligned = core.getBooleanInput("fail-on-misaligned");

    const gh = new GitHubClient({ token });
    core.info(`Reviewing ${owner}/${repo}#${number}…`);
    const data = await gh.getPullRequestData(owner, repo, number);

    const review = await reviewPullRequest(
        {
            title: data.title,
            body: data.body,
            linkedIssue: data.linkedIssue,
            files: data.files,
        },
        {
            anthropicApiKey: apiKey,
            model,
            maxDiffTokens,
            logger: (m) => core.info(m),
        },
    );

    const markdown = reviewToMarkdown(review, {
        owner,
        repo,
        headSha: data.headSha,
        model: model ?? "claude-opus-4-8",
    });

    // Always surface the report in the job summary, even in report-only mode.
    await core.summary.addRaw(markdown).write();

    core.setOutput("verdict", review.verdict);
    core.setOutput("misaligned", String(review.verdict === "misaligned"));

    if (shouldComment) {
        const result = await gh.upsertComment(owner, repo, number, markdown);
        core.info(`${result.created ? "Posted" : "Updated"} review comment (#${result.id}).`);
    } else {
        core.info("comment=false — report written to the job summary only, no PR comment posted.");
    }

    if (failOnMisaligned && review.verdict === "misaligned") {
        core.setFailed(`Rubric verdict: misaligned — ${review.summary}`);
    }
}

run().catch((err: unknown) => {
    core.setFailed(err instanceof Error ? err.message : String(err));
});
