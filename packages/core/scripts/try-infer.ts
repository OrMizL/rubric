// Assemble and print the inference prompt for a real PR — NO paid API call.
// Usage: GITHUB_TOKEN=$(gh auth token) pnpm exec tsx packages/core/scripts/try-infer.ts [owner repo number]
import { GitHubClient } from "../src/github.js";
import { gatherContext } from "../src/context.js";
import { scoreSignal } from "../src/confidence.js";
import { buildInferSystemPrompt, buildInferUserPrompt } from "../src/infer.js";

const [owner = "sindresorhus", repo = "slugify", numRaw = "73"] = process.argv.slice(2);

const gh = new GitHubClient({ token: process.env.GITHUB_TOKEN ?? "" });
const data = await gh.getPullRequestData(owner, repo, Number(numRaw));
const ctx = gatherContext(data);
const score = scoreSignal(ctx);

console.log(`--- signal: ${score.total}/100 (${score.band}) ---`);
for (const c of score.components) {
    console.log(`  ${c.label.padEnd(20)} ${String(c.earned).padStart(2)}/${c.max}  ${c.note}`);
}
console.log(`\n--- system ---\n${buildInferSystemPrompt()}`);
console.log(`\n--- user ---\n${buildInferUserPrompt(ctx)}`);
