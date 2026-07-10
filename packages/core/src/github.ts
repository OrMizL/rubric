import { Octokit } from "@octokit/rest";
import {
    RUBRIC_COMMENT_MARKER,
    type ChangedFile,
    type LinkedIssue,
    type PullRequestData,
} from "./types.js";

export interface GitHubClientOptions {
    token: string;
    /** Override for GitHub Enterprise; defaults to public github.com. */
    baseUrl?: string;
}

/** Closing-keyword reference to an issue, e.g. "fixes #42" / "Closes #7". */
const LINKED_ISSUE_RE = /(?:close[sd]?|fix(?:e[sd])?|resolve[sd]?)\s+#(\d+)/i;

export interface UpsertResult {
    id: number;
    /** true if a new comment was created, false if an existing one was updated. */
    created: boolean;
}

/**
 * Thin wrapper over @octokit/rest for the reads and the single write Rubric needs:
 * PR metadata, a linked issue, per-file patches, and an upserted review comment.
 */
export class GitHubClient {
    private readonly octokit: Octokit;

    constructor(opts: GitHubClientOptions) {
        this.octokit = new Octokit({ auth: opts.token, baseUrl: opts.baseUrl });
    }

    async getPullRequest(
        owner: string,
        repo: string,
        number: number,
    ): Promise<Omit<PullRequestData, "linkedIssue" | "files" | "owner" | "repo" | "number">> {
        const { data } = await this.octokit.pulls.get({ owner, repo, pull_number: number });
        return {
            title: data.title,
            body: data.body ?? "",
            baseRef: data.base.ref,
            headRef: data.head.ref,
            headSha: data.head.sha,
        };
    }

    /** Parse the first closing keyword in `body` and fetch that issue, if any. */
    async getLinkedIssue(owner: string, repo: string, body: string): Promise<LinkedIssue | null> {
        const match = LINKED_ISSUE_RE.exec(body);
        if (!match || match[1] === undefined) return null;
        const issueNumber = Number(match[1]);
        try {
            const { data } = await this.octokit.issues.get({
                owner,
                repo,
                issue_number: issueNumber,
            });
            return { number: issueNumber, title: data.title, body: data.body ?? "" };
        } catch {
            // Referenced number may not exist or be inaccessible; treat as no link.
            return null;
        }
    }

    /** All changed files with their per-file patches (paginated). */
    async getFiles(owner: string, repo: string, number: number): Promise<ChangedFile[]> {
        const files = await this.octokit.paginate(this.octokit.pulls.listFiles, {
            owner,
            repo,
            pull_number: number,
            per_page: 100,
        });
        return files.map((f) => ({
            filename: f.filename,
            status: f.status,
            additions: f.additions,
            deletions: f.deletions,
            patch: f.patch,
        }));
    }

    /** One call that assembles everything the engine needs about a PR. */
    async getPullRequestData(
        owner: string,
        repo: string,
        number: number,
    ): Promise<PullRequestData> {
        const pr = await this.getPullRequest(owner, repo, number);
        const [linkedIssue, files] = await Promise.all([
            this.getLinkedIssue(owner, repo, pr.body),
            this.getFiles(owner, repo, number),
        ]);
        return { owner, repo, number, ...pr, linkedIssue, files };
    }

    /**
     * Create-or-update Rubric's single review comment, identified by a hidden marker.
     * `body` must already contain RUBRIC_COMMENT_MARKER (render.ts emits it).
     */
    async upsertComment(
        owner: string,
        repo: string,
        number: number,
        body: string,
    ): Promise<UpsertResult> {
        const comments = await this.octokit.paginate(this.octokit.issues.listComments, {
            owner,
            repo,
            issue_number: number,
            per_page: 100,
        });
        const existing = comments.find((c) => c.body?.includes(RUBRIC_COMMENT_MARKER));
        if (existing) {
            await this.octokit.issues.updateComment({ owner, repo, comment_id: existing.id, body });
            return { id: existing.id, created: false };
        }
        const { data } = await this.octokit.issues.createComment({
            owner,
            repo,
            issue_number: number,
            body,
        });
        return { id: data.id, created: true };
    }
}
