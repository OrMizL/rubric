import type { ChangedFile, Commit, LinkedIssue, PullRequestData } from "./types.js";

/**
 * A changed file with its patch removed. The absent `patch` field is the whole
 * point: the inference stage reasons from the shape of a change, never from its
 * implementation, and a type that cannot hold a patch cannot leak one.
 */
export interface FileSummary {
    filename: string;
    status: string;
    additions: number;
    deletions: number;
}

/** Everything the diff-blind inference stage is allowed to see. */
export interface ReviewContext {
    title: string;
    body: string;
    linkedIssue: LinkedIssue | null;
    labels: string[];
    commits: Commit[];
    fileSummary: FileSummary[];
}

/** Drop patches, keeping only the shape of each change. */
export function summarizeFiles(files: ChangedFile[]): FileSummary[] {
    return files.map(({ filename, status, additions, deletions }) => ({
        filename,
        status,
        additions,
        deletions,
    }));
}

/** Reshape fetched PR data into the context inference and scoring both read. */
export function gatherContext(pr: PullRequestData): ReviewContext {
    return {
        title: pr.title,
        body: pr.body,
        linkedIssue: pr.linkedIssue,
        labels: pr.labels,
        commits: pr.commits,
        fileSummary: summarizeFiles(pr.files),
    };
}
