import { describe, it, expect } from "vitest";
import { renderTerminal } from "./terminal.js";
import type { Review } from "@rubric/core";

const aligned: Review = {
    verdict: "aligned",
    summary: "Everything the PR claims is implemented.",
    claims: [
        {
            id: "c1",
            text: "Moves the replacement before the slug pattern",
            status: "implemented",
            evidence: [{ file: "index.js", lines: "78-84" }],
            explanation: "",
        },
    ],
    unstatedChanges: [],
    truncated: false,
};

const misaligned: Review = {
    verdict: "misaligned",
    summary: "Claims a docs-only change but edits code.",
    claims: [
        {
            id: "c1",
            text: "Adds an Installation section to the README",
            status: "missing",
            evidence: [],
            explanation: "",
        },
    ],
    unstatedChanges: [
        {
            file: "index.js",
            description: "Rewrote the contraction regex — a real behavior change.",
            risk: "high",
        },
    ],
    truncated: false,
};

const opts = { color: false };

describe("renderTerminal", () => {
    it("names the verdict prominently", () => {
        expect(renderTerminal(aligned, opts).toLowerCase()).toContain("aligned");
        expect(renderTerminal(misaligned, opts).toLowerCase()).toContain("misaligned");
    });

    it("includes the summary text", () => {
        expect(renderTerminal(aligned, opts)).toContain(aligned.summary);
    });

    it("lists each claim with its status and text", () => {
        const out = renderTerminal(misaligned, opts);
        expect(out).toContain("missing");
        expect(out).toContain("Adds an Installation section to the README");
    });

    it("shows evidence as file:lines", () => {
        expect(renderTerminal(aligned, opts)).toContain("index.js:78-84");
    });

    it("lists unstated changes with file and risk only when present", () => {
        const out = renderTerminal(misaligned, opts);
        expect(out.toLowerCase()).toContain("unstated");
        expect(out).toContain("index.js");
        expect(out).toContain("high");
        expect(renderTerminal(aligned, opts).toLowerCase()).not.toContain("unstated");
    });

    it("shows a truncation notice only when truncated", () => {
        expect(renderTerminal(aligned, opts).toLowerCase()).not.toContain("truncat");
        expect(renderTerminal({ ...aligned, truncated: true }, opts).toLowerCase()).toContain(
            "truncat",
        );
    });

    it("emits no ANSI escape codes when color is disabled", () => {
        // eslint-disable-next-line no-control-regex
        expect(renderTerminal(misaligned, opts)).not.toMatch(/\x1b\[/);
    });
});
