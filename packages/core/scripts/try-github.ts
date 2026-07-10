// Manual smoke test for GitHubClient against a real public PR (read-only).
// Usage: gh auth token | ... ; GITHUB_TOKEN=$(gh auth token) tsx scripts/try-github.ts [owner repo number]
import { GitHubClient } from "../src/github.js";

const [owner = "sindresorhus", repo = "slugify", numRaw = "75"] = process.argv.slice(2);
const number = Number(numRaw);

const token = process.env.GITHUB_TOKEN ?? "";
if (!token) console.warn("No GITHUB_TOKEN set — using unauthenticated requests (low rate limit).");

const client = new GitHubClient({ token });
const data = await client.getPullRequestData(owner, repo, number);

console.log(`PR ${owner}/${repo}#${number}: ${data.title}`);
console.log(`  base=${data.baseRef} head=${data.headRef} sha=${data.headSha.slice(0, 7)}`);
console.log(
    `  body: ${data.body.slice(0, 120).replace(/\n/g, " ")}${data.body.length > 120 ? "…" : ""}`,
);
console.log(
    `  linkedIssue: ${data.linkedIssue ? `#${data.linkedIssue.number} ${data.linkedIssue.title}` : "none"}`,
);
console.log(`  files (${data.files.length}):`);
for (const f of data.files) {
    console.log(
        `    ${f.status.padEnd(9)} +${f.additions}/-${f.deletions} ${f.filename}${f.patch === undefined ? " [no patch]" : ""}`,
    );
}
