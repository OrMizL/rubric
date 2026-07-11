import type { Review } from "@rubric/core";

import alignedFixture from "../../../packages/core/src/__fixtures__/slugify-73.review.json";
import misalignedFixture from "../../../packages/core/src/__fixtures__/slugify-73-misaligned.review.json";

/** The "everything checks out" example: sindresorhus/slugify#73. */
export const alignedReview = alignedFixture as Review;

/** The "docs-only that wasn't" trap: same diff, misrepresented in the PR description. */
export const misalignedReview = misalignedFixture as Review;

export interface FixtureOption {
    id: "aligned" | "misaligned";
    /** Toggle label. */
    label: string;
    /** Faux PR-chrome metadata so the demo reads like a real review artifact. */
    repo: string;
    branch: string;
    prNumber: number;
    prTitle: string;
    review: Review;
}

export const fixtureOptions: FixtureOption[] = [
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
