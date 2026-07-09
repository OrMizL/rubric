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

export {
  filterFiles,
  rankFiles,
  renderFilePatch,
  truncateToBudget,
  type BudgetResult,
  type TokenCounter,
} from "./budget.js";

export {
  buildSystemPrompt,
  buildUserPrompt,
  type PromptInput,
} from "./prompt.js";

export {
  reviewPullRequest,
  DEFAULT_MODEL,
  DEFAULT_MAX_DIFF_TOKENS,
  DEFAULT_MAX_OUTPUT_TOKENS,
  type EngineOptions,
  type ReviewInput,
} from "./engine.js";
