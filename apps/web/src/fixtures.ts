import type { Review } from "@rubric/core";

import alignedFixture from "../../../packages/core/src/__fixtures__/slugify-73.review.json";
import misalignedFixture from "../../../packages/core/src/__fixtures__/slugify-73-misaligned.review.json";
import realCatchFixture from "../../../packages/core/src/__fixtures__/h3-1513.review.json";

/** The "everything checks out" example: sindresorhus/slugify#73. */
export const alignedReview = alignedFixture as Review;

/** The "docs-only that wasn't" trap: same diff, misrepresented in the PR description. */
export const misalignedReview = misalignedFixture as Review;

/**
 * A real catch: unjs/h3#1513, merged with a description that contradicts its code. Rubric's review
 * of the unmodified PR from the eval run, with the 19 inferred expectations left out for length.
 */
export const realCatchReview = realCatchFixture as Review;

export interface FixtureOption {
    id: "real" | "aligned" | "misaligned";
    /** Toggle label. */
    label: string;
    /** Faux PR-chrome metadata so the demo reads like a real review artifact. */
    repo: string;
    branch: string;
    prNumber: number;
    prTitle: string;
    review: Review;
    /** Shown under the review when the fixture is trimmed or needs context. */
    note?: string;
}

export const fixtureOptions: FixtureOption[] = [
    {
        id: "real",
        label: "Real catch",
        repo: "unjs/h3",
        branch: "feat/1416-session-auto-reseal",
        prNumber: 1513,
        prTitle: "feat(session): add opt-in `idleTimeout` for sliding expiration",
        review: realCatchReview,
        note: "A merged PR, reviewed unmodified. The design changed during review; the description did not. Stated claims shown; 19 inferred expectations omitted for length.",
    },
    {
        id: "aligned",
        label: "Aligned",
        repo: "sindresorhus/slugify",
        branch: "fix/contraction-order",
        prNumber: 73,
        prTitle: "Fix contraction handling so partial `-s` / `-t` slugs aren't mangled",
        review: alignedReview,
    },
    {
        id: "misaligned",
        label: "Misaligned",
        repo: "sindresorhus/slugify",
        branch: "docs/add-installation",
        prNumber: 74,
        prTitle: "Docs: add an Installation section to the README",
        review: misalignedReview,
    },
];
