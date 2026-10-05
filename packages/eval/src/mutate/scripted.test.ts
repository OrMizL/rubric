import { describe, it, expect } from "vitest";
import {
    control,
    controlStripped,
    pickDonor,
    scopeLie,
    swap,
    SCOPE_LIE_PHRASES,
} from "./scripted.js";
import { makeCase } from "../fixtures.js";
import { validateCase } from "../case.js";

function pr(owner: string, repo: string, title: string) {
    const base = makeCase().input;
    return {
        ...base,
        owner,
        repo,
        title,
        body: `${title} body`,
        labels: ["enhancement"],
        commits: [{ sha: "1", message: `commit for ${title}` }],
        linkedIssue: { number: 9, title: `issue ${title}`, body: "" },
    };
}

describe("control", () => {
    it("keeps the input unchanged and labels not-misaligned", () => {
        const source = pr("o", "r", "feat: x");
        const c = control("o__r__1", source);
        expect(c.id).toBe("o__r__1.control");
        expect(c.input).toEqual(source);
        expect(c.label).toEqual({ verdict: { not: ["misaligned"] } });
        expect(validateCase(c)).toEqual([]);
    });
});

describe("controlStripped", () => {
    it("clears commits and labels but keeps the description", () => {
        const c = controlStripped("o__r__1", pr("o", "r", "feat: x"));
        expect(c.input.commits).toEqual([]);
        expect(c.input.labels).toEqual([]);
        expect(c.input.title).toBe("feat: x");
        expect(c.input.linkedIssue).not.toBeNull();
    });
});

describe("swap", () => {
    it("takes the donor's intent, clears commits/labels, keeps the diff", () => {
        const source = pr("o", "r", "feat: x");
        const donor = pr("p", "q", "docs: y");
        const c = swap("o__r__1", source, donor);
        expect(c.input.title).toBe("docs: y");
        expect(c.input.body).toBe("docs: y body");
        expect(c.input.linkedIssue).toEqual(donor.linkedIssue);
        expect(c.input.commits).toEqual([]);
        expect(c.input.labels).toEqual([]);
        expect(c.input.files).toEqual(source.files);
        expect(c.label).toEqual({ verdict: { oneOf: ["misaligned"] } });
    });
});

describe("scopeLie", () => {
    it("appends the phrase and labels a contradicted claim", () => {
        const c = scopeLie("o__r__1", pr("o", "r", "feat: x"), 0);
        expect(c.id).toBe("o__r__1.scope_lie.0");
        expect(c.input.body.endsWith(SCOPE_LIE_PHRASES[0]!.text)).toBe(true);
        expect(c.label.claims).toEqual([
            { keywords: SCOPE_LIE_PHRASES[0]!.keywords, status: ["contradicted"] },
        ]);
    });
});

describe("pickDonor", () => {
    it("picks the next source from a different repo, wrapping around", () => {
        const all = [
            { key: "a1", pr: pr("o", "a", "1") },
            { key: "a2", pr: pr("o", "a", "2") },
            { key: "b1", pr: pr("o", "b", "3") },
        ];
        expect(pickDonor("a1", all)!.title).toBe("3");
        expect(pickDonor("b1", all)!.title).toBe("1");
    });
    it("returns null when every source shares a repo", () => {
        expect(pickDonor("a1", [{ key: "a1", pr: pr("o", "a", "1") }])).toBeNull();
    });
});
