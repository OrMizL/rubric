import { describe, it, expect } from "vitest";
import { makeSplits } from "./splits.js";
import { makeCase } from "./fixtures.js";
import type { EvalCase, Mutation } from "./case.js";

function c(id: string, repo: string, mutation: Mutation): EvalCase {
    return makeCase({ id, mutation, meta: { repo, diffLines: 2, fileCount: 1 } });
}

describe("makeSplits", () => {
    const cases = [
        ...["a", "b", "c", "d"].flatMap((repo) =>
            [1, 2, 3].map((n) => c(`${repo}${n}.control`, repo, "control")),
        ),
        c("a1.swap", "a", "swap"),
        c("b1.swap", "b", "swap"),
    ];

    it("puts every case in full", () => {
        expect(makeSplits(cases).full).toHaveLength(cases.length);
    });

    it("caps dev per mutation and spreads it across repos", () => {
        const { dev } = makeSplits(cases, 4);
        const controls = dev.filter((id) => id.endsWith(".control"));
        expect(controls).toHaveLength(4);
        expect(new Set(controls.map((id) => id[0])).size).toBe(4);
        expect(dev.filter((id) => id.endsWith(".swap"))).toHaveLength(2);
    });

    it("rotates repos across mutations so dev covers every repo", () => {
        const repos = "abcdefghijklm".split("");
        const mutations: Mutation[] = ["control", "control_stripped", "swap", "scope_lie"];
        const many = mutations.flatMap((m) => repos.map((r) => c(`${r}1.${m}`, r, m)));
        const { dev } = makeSplits(many, 6);
        expect(dev).toHaveLength(24);
        expect(new Set(dev.map((id) => id[0])).size).toBe(13);
    });

    it("is deterministic", () => {
        expect(makeSplits(cases, 4)).toEqual(makeSplits([...cases].reverse(), 4));
    });
});
