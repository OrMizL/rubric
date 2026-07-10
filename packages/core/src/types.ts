// Shared interfaces threaded between github → budget → prompt → engine → render.

/** Hidden marker used to find-and-upsert Rubric's single PR comment. */
export const RUBRIC_COMMENT_MARKER = "<!-- rubric-review -->";

/** A single file changed by a pull request, as returned by the GitHub files API. */
export interface ChangedFile {
    filename: string;
    /** added | modified | removed | renamed | changed | copied */
    status: string;
    additions: number;
    deletions: number;
    /** Unified-diff hunk. Absent when GitHub omits it (binary, generated, or too large). */
    patch?: string;
}

/** An issue referenced by a closing keyword in the PR body. */
export interface LinkedIssue {
    number: number;
    title: string;
    body: string;
}

/** Everything the engine needs about a PR: intent (title/body/issue) + the diff. */
export interface PullRequestData {
    owner: string;
    repo: string;
    number: number;
    title: string;
    body: string;
    baseRef: string;
    headRef: string;
    headSha: string;
    linkedIssue: LinkedIssue | null;
    files: ChangedFile[];
}
