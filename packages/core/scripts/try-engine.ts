// Manual end-to-end engine run against a real PR — MAKES A PAID ANTHROPIC CALL.
// Usage: GITHUB_TOKEN=$(gh auth token) node --env-file=.env --import tsx \
//          packages/core/scripts/try-engine.ts [owner repo number] [model]
import { GitHubClient } from "../src/github.js";
import { reviewPullRequest } from "../src/engine.js";
import { gatherContext } from "../src/context.js";

// --misaligned regenerates the trap fixture: the real diff, described dishonestly.
const argv = process.argv.slice(2);
const misaligned = argv.includes("--misaligned");
const positional = argv.filter((a) => !a.startsWith("--"));
const [owner = "sindresorhus", repo = "slugify", numRaw = "73", model] = positional;
const number = Number(numRaw);

const apiKey = process.env.ANTHROPIC_API_KEY;
if (!apiKey) throw new Error("ANTHROPIC_API_KEY not set (expected via --env-file=.env)");

const gh = new GitHubClient({ token: process.env.GITHUB_TOKEN ?? "" });
const data = await gh.getPullRequestData(owner, repo, number);
console.error(`[rubric] reviewing ${owner}/${repo}#${number} — "${data.title}"`);

const context = gatherContext(
    misaligned
        ? {
              ...data,
              // The lie: claims a docs-only README change over a diff that only touches code.
              title: "Add installation instructions to the README",
              body: "Documentation only. Adds an Installation section to the README covering `npm install slugify` and `yarn add slugify`. No code or behavior changes.",
              linkedIssue: null,
          }
        : data,
);
if (misaligned) console.error(`[rubric] --misaligned: using a fabricated docs-only description`);

const started = Date.now();
const review = await reviewPullRequest(context, data.files, {
    anthropicApiKey: apiKey,
    ...(model ? { model } : {}),
});
console.error(`[rubric] done in ${((Date.now() - started) / 1000).toFixed(1)}s`);

console.log(JSON.stringify(review, null, 2));
