import { createHash } from "node:crypto";
import { SMUGGLE_SIZES, SMUGGLE_TEMPLATES, type SmuggleTemplate } from "./templates.js";

/** Stable per (key, salt): adding a source never reshuffles what existing sources get. */
export function stableIndex(key: string, salt: string, modulo: number): number {
    return createHash("sha256").update(`${salt}\0${key}`).digest().readUInt32BE(0) % modulo;
}

/**
 * Template and size come from the source key, not its position in the list. An
 * index-based rotation changes every later source's case id (and re-pays for its
 * drafts) the moment one source is inserted.
 */
export function smuggleRotation(key: string): { template: SmuggleTemplate; size: number } {
    return {
        template: SMUGGLE_TEMPLATES[stableIndex(key, "template", SMUGGLE_TEMPLATES.length)]!,
        size: SMUGGLE_SIZES[stableIndex(key, "size", SMUGGLE_SIZES.length)]!,
    };
}

/** Checked before each source, so spend can overshoot the cap by at most one source's drafts. */
export function reachedCap(spentUsd: number, maxUsd: number): boolean {
    return spentUsd >= maxUsd;
}

/**
 * Which drafted mutations a source already has an accepted case for. Re-drafting
 * those would pay again for drafts the review gate then refuses to accept (the
 * case id exists), so the drafted step only fills what is missing.
 */
export function acceptedMutations(
    caseIds: string[],
    key: string,
): { claimDrop: boolean; smuggle: boolean } {
    return {
        claimDrop: caseIds.includes(`${key}.claim_drop`),
        smuggle: caseIds.some((id) => id.startsWith(`${key}.smuggle.`)),
    };
}
