import type { Review } from "@rubric/core";

import alignedFixture from "../../../packages/core/src/__fixtures__/slugify-73.review.json";
import misalignedFixture from "../../../packages/core/src/__fixtures__/slugify-73-misaligned.review.json";

/** The "everything checks out" example: sindresorhus/slugify#73. */
export const alignedReview = alignedFixture as Review;

/** The "docs-only that wasn't" trap: same diff, misrepresented in the PR description. */
export const misalignedReview = misalignedFixture as Review;

export interface FixtureOption {
    id: "aligned" | "misaligned";
    label: string;
    review: Review;
}

export const fixtureOptions: FixtureOption[] = [
    { id: "aligned", label: "Aligned", review: alignedReview },
    { id: "misaligned", label: "Misaligned", review: misalignedReview },
];
