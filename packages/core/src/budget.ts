import type { ChangedFile } from "./types.js";

/**
 * Token counter over an arbitrary text block. Injected so budget.ts stays pure
 * and unit-testable: tests pass a synchronous fake, the engine passes a counter
 * backed by `client.messages.countTokens` (real Claude token counts).
 */
export type TokenCounter = (text: string) => number | Promise<number>;

export interface BudgetResult {
    /** Files kept in the prompt, in ranked order. */
    files: ChangedFile[];
    /** Files dropped to fit the budget. */
    omitted: ChangedFile[];
    /** true if any file was omitted. */
    truncated: boolean;
    /** Assembled inner text of the <diff> block, including the omission notice. */
    diffText: string;
}

const LOCKFILES = new Set([
    "pnpm-lock.yaml",
    "package-lock.json",
    "npm-shrinkwrap.json",
    "yarn.lock",
    "bun.lockb",
    "Cargo.lock",
    "composer.lock",
    "Gemfile.lock",
    "poetry.lock",
]);

function basename(path: string): string {
    const i = path.lastIndexOf("/");
    return i === -1 ? path : path.slice(i + 1);
}

/**
 * Drop files not worth spending review tokens on: lockfiles, minified bundles,
 * build output, snapshots, and anything GitHub omitted a patch for (binary/generated).
 */
export function filterFiles(files: ChangedFile[]): ChangedFile[] {
    return files.filter((f) => {
        if (f.patch === undefined) return false;
        const name = basename(f.filename);
        if (LOCKFILES.has(name)) return false;
        if (/\.min\.[^./]+$/.test(name)) return false;
        if (/(^|\/)dist\//.test(f.filename)) return false;
        if (name.endsWith(".snap")) return false;
        return true;
    });
}

/** Rank category: lower sorts first. src > config > tests > docs > other. */
function category(filename: string): number {
    const name = basename(filename);
    if (
        /(^|\/)(__tests__|tests?|spec|__mocks__)\//.test(filename) ||
        /\.(test|spec)\.[cm]?[jt]sx?$/.test(name)
    ) {
        return 2; // tests
    }
    if (
        /\.(ya?ml|toml|ini|cfg)$/i.test(name) ||
        /\.config\.[cm]?[jt]sx?$/.test(name) ||
        /^(package\.json|tsconfig(\.\w+)?\.json|\.\w+rc(\.\w+)?)$/.test(name) ||
        name.endsWith(".json")
    ) {
        return 1; // config
    }
    if (/\.(md|mdx|markdown|txt|rst|adoc)$/i.test(name) || /(^|\/)docs?\//.test(filename)) {
        return 3; // docs
    }
    if (
        /\.(ts|tsx|js|jsx|cjs|mjs|py|go|rs|java|rb|php|c|cc|cpp|h|hpp|cs|kt|swift|scala|sh)$/.test(
            name,
        )
    ) {
        return 0; // src
    }
    return 4; // other
}

/** Stable sort by rank category (src first, docs/other last). */
export function rankFiles(files: ChangedFile[]): ChangedFile[] {
    return files
        .map((f, i) => ({ f, i, c: category(f.filename) }))
        .sort((a, b) => a.c - b.c || a.i - b.i)
        .map((x) => x.f);
}

/** Render one file's patch block — used for both token counting and the final prompt. */
export function renderFilePatch(f: ChangedFile): string {
    return `### ${f.filename} (${f.status}, +${f.additions}/-${f.deletions})\n${f.patch ?? ""}`;
}

function renderOmissionNotice(omitted: ChangedFile[]): string {
    const lines = omitted.map((f) => `  - ${f.filename} (+${f.additions}/-${f.deletions})`);
    const noun = omitted.length === 1 ? "file" : "files";
    return `[[${omitted.length} ${noun} omitted to fit the token budget:\n${lines.join("\n")}\n]]`;
}

/**
 * Filter → rank is assumed done by the caller; this greedily keeps whole file
 * patches (highest rank first) while the cumulative real token count stays within
 * `maxTokens`, replacing the remainder with an omission notice.
 */
export async function truncateToBudget(
    files: ChangedFile[],
    maxTokens: number,
    countTokens: TokenCounter,
): Promise<BudgetResult> {
    const kept: ChangedFile[] = [];
    const omitted: ChangedFile[] = [];
    let used = 0;

    for (const f of files) {
        if (omitted.length > 0) {
            // Once we start omitting, keep everything after in ranked order omitted too,
            // so a small low-rank file can't leapfrog a large higher-rank one.
            omitted.push(f);
            continue;
        }
        const cost = await countTokens(renderFilePatch(f));
        if (used + cost <= maxTokens) {
            kept.push(f);
            used += cost;
        } else {
            omitted.push(f);
        }
    }

    const blocks = kept.map(renderFilePatch);
    if (omitted.length > 0) blocks.push(renderOmissionNotice(omitted));

    return {
        files: kept,
        omitted,
        truncated: omitted.length > 0,
        diffText: blocks.join("\n\n"),
    };
}
