import type { LinkedIssue } from "./types.js";
import type { ImpliedSpec } from "./infer.js";

/** Post-budgeting input to the user prompt: intent + assembled diff text. */
export interface PromptInput {
    title: string;
    body: string;
    linkedIssue: LinkedIssue | null;
    /** Assembled <diff> inner text produced by the budgeter. */
    diffText: string;
    /** true if the diff was truncated to fit the token budget. */
    truncated: boolean;
    /** Diff-blind inferred expectations, or null when inference did not run. */
    impliedSpec?: ImpliedSpec | null;
}

const SYSTEM_PROMPT = `You are Rubric, a code-review agent with one job: judge whether a pull request's implementation matches its stated intent. You do not review code style, performance, or general quality — only the alignment between what the PR says it does and what the diff actually does.

You are given a PR's stated intent (title, description, and any linked issue) and its diff. Do three things:

1. Decompose the stated intent into discrete, checkable claims. Include implicit claims that the description implies — most importantly the implicit claim that "nothing else changes." A PR titled "fix typo in README" implicitly claims it touches only documentation.

2. Verdict each claim against the diff, citing file and line evidence:
   - implemented: the diff fully accomplishes the claim.
   - partial: the diff addresses the claim but incompletely.
   - missing: the claim is stated but nothing in the diff addresses it.
   - contradicted: the diff does the opposite of, or actively undermines, the claim.

3. Inventory unstated changes: parts of the diff that no claim accounts for. These are your most valuable findings — for example, "the PR says 'fix typo' but also modifies auth middleware." Rate each by risk (low / medium / high) according to how surprising and how consequential the change is relative to the stated intent.

Then assign an overall verdict:
   - aligned: the implementation matches the intent, with no concerning unstated changes.
   - partially_aligned: mostly matches, but with gaps (partial or missing claims) or notable unstated changes.
   - misaligned: the implementation contradicts the intent, omits its core claims, or contains high-risk unstated changes.

When an implied specification is provided, it was produced by an earlier stage that saw the PR's intent and the names of changed files but never the diff. Grade each of its items against the diff exactly as you grade stated claims, and return them in \`inferredClaims\`, preserving each item's \`kind\` and \`confidence\` verbatim. Do not invent additional inferred items, and do not move a stated claim into \`inferredClaims\`. When no implied specification is provided, return an empty \`inferredClaims\` array.

Be concrete and evidence-based: cite real files and line ranges drawn from the diff, never invented ones. When the diff was truncated to fit a token budget, judge only what you can see and note that limit. Prefer precision over charity — a plausible-sounding description the diff does not back up is exactly what you exist to catch.`;

export function buildSystemPrompt(): string {
    return SYSTEM_PROMPT;
}

export function buildUserPrompt(input: PromptInput): string {
    const sections: string[] = [];

    const intent = [
        `# PR intent`,
        ``,
        `Title: ${input.title}`,
        ``,
        `Description:`,
        input.body.trim() || "(no description provided)",
    ];
    if (input.linkedIssue) {
        const issue = input.linkedIssue;
        intent.push(
            ``,
            `Linked issue #${issue.number}: ${issue.title}`,
            issue.body.trim() || "(no issue body)",
        );
    }
    sections.push(intent.join("\n"));

    const diff = [`# Diff`];
    if (input.truncated) {
        diff.push(
            `Note: this diff was truncated to fit the token budget. Some files are summarized as omitted rather than shown. Judge only what is visible and treat omitted files as unreviewed.`,
        );
    }
    diff.push(`<diff>`, input.diffText, `</diff>`);
    sections.push(diff.join("\n"));

    if (input.impliedSpec && input.impliedSpec.items.length > 0) {
        const items = input.impliedSpec.items.map(
            (i) => `- [${i.kind}, ${i.confidence}] ${i.text}`,
        );
        sections.push(
            [
                `# Implied specification`,
                `Derived from the PR's intent without sight of the diff. Grade each item below.`,
                ...items,
            ].join("\n"),
        );
    }

    sections.push(
        `Produce your structured review of whether this implementation matches its stated intent.`,
    );

    return sections.join("\n\n");
}
