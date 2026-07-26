// Adversarial prompt-quality check — MAKES FOUR PAID ANTHROPIC CALLS (two runs,
// each an inference call plus a review call).
//
// Run 1 feeds the REAL slugify#73 diff with a deliberately FALSE, docs-only
// description. A good prompt returns misaligned, marks the README claim missing,
// and surfaces the actual code changes as unstated.
//
// Run 2 feeds a bare title and nothing else. A good inference prompt still
// derives expectations, and the signal score should land in the low band.
//
// Usage: GITHUB_TOKEN=$(gh auth token) node --env-file=.env --import tsx \
//          packages/core/scripts/try-engine-adversarial.ts
import { GitHubClient } from "../src/github.js";
import { reviewPullRequest } from "../src/engine.js";
import { gatherContext } from "../src/context.js";

const apiKey = process.env.ANTHROPIC_API_KEY;
if (!apiKey) throw new Error("ANTHROPIC_API_KEY not set (expected via --env-file=.env)");

const gh = new GitHubClient({ token: process.env.GITHUB_TOKEN ?? "" });
const data = await gh.getPullRequestData("sindresorhus", "slugify", 73);

const review = await reviewPullRequest(
    gatherContext({
        ...data,
        // The lie: claims a docs-only README change over a diff that only touches code.
        title: "Add installation instructions to the README",
        body: "Documentation only. Adds an Installation section to the README covering `npm install slugify` and `yarn add slugify`. No code or behavior changes.",
        linkedIssue: null,
    }),
    data.files,
    { anthropicApiKey: apiKey },
);

console.log("--- run 1: false docs-only description (expect misaligned) ---");
console.log(JSON.stringify(review, null, 2));

// Thin-context case: a bare title and nothing else. Inference should still
// produce expectations, and the signal score should land in the low band.
const thin = await reviewPullRequest(
    gatherContext({
        ...data,
        title: "fix: prevent double-click on submit",
        body: "",
        linkedIssue: null,
    }),
    data.files,
    { anthropicApiKey: apiKey },
);

console.log("\n--- run 2: thin context (expect low signal band) ---");
console.log(`signal: ${thin.signalScore.total}/100 (${thin.signalScore.band})`);
console.log(`inference: ${JSON.stringify(thin.inference)}`);
console.log(JSON.stringify(thin.inferredClaims, null, 2));
