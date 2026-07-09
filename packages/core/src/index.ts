// Public exports for @rubric/core.
// Populated across Steps 2–6 (schema, github, budget, prompt, engine, render).

export const RUBRIC_CORE_VERSION = "0.0.0";

export {
  ClaimSchema,
  UnstatedChangeSchema,
  ReviewSchema,
  type Claim,
  type UnstatedChange,
  type Review,
} from "./schema.js";

export {
  RUBRIC_COMMENT_MARKER,
  type ChangedFile,
  type LinkedIssue,
  type PullRequestData,
} from "./types.js";

export {
  GitHubClient,
  type GitHubClientOptions,
  type UpsertResult,
} from "./github.js";
