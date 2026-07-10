import { describe, it, expect } from "vitest";
import { parseTarget } from "./target.js";

describe("parseTarget", () => {
    it("parses a full GitHub pull request URL", () => {
        expect(parseTarget("https://github.com/sindresorhus/slugify/pull/73")).toEqual({
            owner: "sindresorhus",
            repo: "slugify",
            number: 73,
        });
    });

    it("parses an owner/repo#number shorthand", () => {
        expect(parseTarget("sindresorhus/slugify#73")).toEqual({
            owner: "sindresorhus",
            repo: "slugify",
            number: 73,
        });
    });

    it("ignores a trailing slash or query string on a URL", () => {
        expect(parseTarget("https://github.com/a/b/pull/9/files?diff=split")).toEqual({
            owner: "a",
            repo: "b",
            number: 9,
        });
    });

    it("accepts a bare github.com URL without a scheme", () => {
        expect(parseTarget("github.com/a/b/pull/9")).toEqual({
            owner: "a",
            repo: "b",
            number: 9,
        });
    });

    it("throws on an unrecognized reference", () => {
        expect(() => parseTarget("not a pr")).toThrow();
    });

    it("throws when the PR number is missing", () => {
        expect(() => parseTarget("sindresorhus/slugify")).toThrow();
    });
});
