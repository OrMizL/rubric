// Assemble and print the Rubric prompt for a real PR — NO paid API call.
// Uses a rough char-based token estimate purely to drive diff assembly; the
// engine uses real client.messages.countTokens at runtime instead.
// Usage: GITHUB_TOKEN=$(gh auth token) tsx scripts/show-prompt.ts [owner repo number]
import { GitHubClient } from "../src/github.js";
import { filterFiles, rankFiles, truncateToBudget } from "../src/budget.js";
import { buildSystemPrompt, buildUserPrompt } from "../src/prompt.js";

const [owner = "sindresorhus", repo = "slugify", numRaw = "73"] = process.argv.slice(2);
const number = Number(numRaw);

const client = new GitHubClient({ token: process.env.GITHUB_TOKEN ?? "" });
const data = await client.getPullRequestData(owner, repo, number);

const estimate = (t: string) => Math.ceil(t.length / 4); // display-only estimate
const ranked = rankFiles(filterFiles(data.files));
const budget = await truncateToBudget(ranked, 50_000, estimate);

const system = buildSystemPrompt();
const user = buildUserPrompt({
    title: data.title,
    body: data.body,
    linkedIssue: data.linkedIssue,
    diffText: budget.diffText,
    truncated: budget.truncated,
});

console.log("=".repeat(70));
console.log(`PROMPT for ${owner}/${repo}#${number} — "${data.title}"`);
console.log(
    `files: ${data.files.length} changed → ${budget.files.length} kept, ${budget.omitted.length} omitted | truncated=${budget.truncated}`,
);
console.log(
    `~${estimate(system)} est. system tokens, ~${estimate(user)} est. user tokens (ROUGH estimate, not real counts)`,
);
console.log("=".repeat(70));
console.log("\n########## SYSTEM PROMPT ##########\n");
console.log(system);
console.log("\n########## USER PROMPT ##########\n");
console.log(user);
