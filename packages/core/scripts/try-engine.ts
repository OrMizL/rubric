// Manual end-to-end engine run against a real PR — MAKES A PAID ANTHROPIC CALL.
// Usage: GITHUB_TOKEN=$(gh auth token) node --env-file=.env --import tsx \
//          packages/core/scripts/try-engine.ts [owner repo number] [model]
import { GitHubClient } from "../src/github.js";
import { reviewPullRequest } from "../src/engine.js";

const [owner = "sindresorhus", repo = "slugify", numRaw = "73", model] = process.argv.slice(2);
const number = Number(numRaw);

const apiKey = process.env.ANTHROPIC_API_KEY;
if (!apiKey) throw new Error("ANTHROPIC_API_KEY not set (expected via --env-file=.env)");

const gh = new GitHubClient({ token: process.env.GITHUB_TOKEN ?? "" });
const data = await gh.getPullRequestData(owner, repo, number);
console.error(`[rubric] reviewing ${owner}/${repo}#${number} — "${data.title}"`);

const started = Date.now();
const review = await reviewPullRequest(
    { title: data.title, body: data.body, linkedIssue: data.linkedIssue, files: data.files },
    { anthropicApiKey: apiKey, ...(model ? { model } : {}) },
);
console.error(`[rubric] done in ${((Date.now() - started) / 1000).toFixed(1)}s`);

console.log(JSON.stringify(review, null, 2));
