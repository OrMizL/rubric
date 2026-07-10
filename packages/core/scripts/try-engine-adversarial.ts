// Adversarial prompt-quality check — MAKES A PAID ANTHROPIC CALL.
// Feeds the REAL slugify#73 diff with a deliberately FALSE, docs-only description.
// A good prompt should return misaligned, mark the README claim missing, and
// surface the actual code changes as unstated.
// Usage: GITHUB_TOKEN=$(gh auth token) node --env-file=.env --import tsx \
//          packages/core/scripts/try-engine-adversarial.ts
import { GitHubClient } from "../src/github.js";
import { reviewPullRequest } from "../src/engine.js";

const apiKey = process.env.ANTHROPIC_API_KEY;
if (!apiKey) throw new Error("ANTHROPIC_API_KEY not set (expected via --env-file=.env)");

const gh = new GitHubClient({ token: process.env.GITHUB_TOKEN ?? "" });
const data = await gh.getPullRequestData("sindresorhus", "slugify", 73);

const review = await reviewPullRequest(
    {
        // The lie: claims a docs-only README change over a diff that only touches code.
        title: "Add installation instructions to the README",
        body: "Documentation only. Adds an Installation section to the README covering `npm install slugify` and `yarn add slugify`. No code or behavior changes.",
        linkedIssue: null,
        files: data.files,
    },
    { anthropicApiKey: apiKey },
);

console.log(JSON.stringify(review, null, 2));
