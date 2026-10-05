import { describe, it, expect } from "vitest";
import type { ChangedFile } from "@rubric/core";
import {
    appendHunk,
    countChanges,
    insertIntoHunk,
    hunkId,
    parsePatch,
    removeHunks,
    serializePatch,
} from "./diff.js";

const TWO_HUNKS = [
    "@@ -1,3 +1,4 @@ function a() {",
    " one",
    "+two",
    " three",
    " four",
    "@@ -10,2 +11,3 @@",
    " ten",
    "-eleven",
    "+eleven!",
    "+twelve",
].join("\n");

function file(patch: string, extra: Partial<ChangedFile> = {}): ChangedFile {
    const { additions, deletions } = countChanges(patch);
    return { filename: "src/a.ts", status: "modified", additions, deletions, patch, ...extra };
}

describe("parsePatch / serializePatch", () => {
    it("parses headers, section text, and bodies", () => {
        const hunks = parsePatch(TWO_HUNKS);
        expect(hunks).toHaveLength(2);
        expect(hunks[0]).toMatchObject({ oldStart: 1, oldLines: 3, newStart: 1, newLines: 4 });
        expect(hunks[0]!.section).toBe(" function a() {");
        expect(hunks[1]).toMatchObject({ oldStart: 10, oldLines: 2, newStart: 11, newLines: 3 });
        expect(hunks[1]!.lines).toEqual([" ten", "-eleven", "+eleven!", "+twelve"]);
    });

    it("round-trips exactly", () => {
        expect(serializePatch(parsePatch(TWO_HUNKS))).toBe(TWO_HUNKS);
    });

    it("treats omitted header counts as 1", () => {
        const [h] = parsePatch("@@ -5 +5 @@\n-a\n+b");
        expect(h).toMatchObject({ oldStart: 5, oldLines: 1, newStart: 5, newLines: 1 });
    });

    it("keeps no-newline markers and does not count them", () => {
        const patch =
            "@@ -1 +1 @@\n-a\n\\ No newline at end of file\n+b\n\\ No newline at end of file";
        expect(serializePatch(parsePatch(patch))).toBe(patch);
        expect(countChanges(patch)).toEqual({ additions: 1, deletions: 1 });
    });

    it("throws on text that is not a unified diff", () => {
        expect(() => parsePatch("hello")).toThrow(/hunk header/);
    });
});

describe("countChanges", () => {
    it("counts + and - body lines only", () => {
        expect(countChanges(TWO_HUNKS)).toEqual({ additions: 3, deletions: 1 });
    });
});

describe("hunkId", () => {
    it("joins filename and index", () => {
        expect(hunkId("src/a.ts", 2)).toBe("src/a.ts#2");
    });
});

describe("removeHunks", () => {
    it("removes a hunk, recounts, and shifts later newStart", () => {
        const out = removeHunks(file(TWO_HUNKS), [0])!;
        const hunks = parsePatch(out.patch!);
        expect(hunks).toHaveLength(1);
        // Hunk 0 added one net line; without it, hunk 1 starts one line earlier.
        expect(hunks[0]!.newStart).toBe(10);
        expect(out.additions).toBe(2);
        expect(out.deletions).toBe(1);
    });

    it("returns null when every hunk is removed", () => {
        expect(removeHunks(file(TWO_HUNKS), [0, 1])).toBeNull();
    });

    it("rejects out-of-range indexes", () => {
        expect(() => removeHunks(file(TWO_HUNKS), [5])).toThrow(/out of range/);
    });
});

describe("appendHunk", () => {
    it("appends a pure-addition hunk after the last hunk with valid line numbers", () => {
        const out = appendHunk(file(TWO_HUNKS), ["const x = 1;", "send(x);"]);
        const hunks = parsePatch(out.patch!);
        expect(hunks).toHaveLength(3);
        // Last hunk covered old 10–11; insertion goes after old line 11.
        // Net delta before it is +1 (hunk 0) +1 (hunk 1) = +2, so new line = 11 + 2 + 1.
        expect(hunks[2]).toMatchObject({ oldStart: 11, oldLines: 0, newStart: 14, newLines: 2 });
        expect(hunks[2]!.lines).toEqual(["+const x = 1;", "+send(x);"]);
        expect(out.additions).toBe(5);
    });

    it("extends the single hunk of an added file", () => {
        const added = file("@@ -0,0 +1,2 @@\n+a\n+b", { status: "added" });
        const out = appendHunk(added, ["c"]);
        const hunks = parsePatch(out.patch!);
        expect(hunks).toHaveLength(1);
        expect(hunks[0]).toMatchObject({ oldStart: 0, oldLines: 0, newStart: 1, newLines: 3 });
        expect(out.additions).toBe(3);
    });

    it("refuses a file without a patch", () => {
        expect(() => appendHunk({ ...file(TWO_HUNKS), patch: undefined }, ["x"])).toThrow(
            /no patch/,
        );
    });

    it("refuses to append after a no-newline marker (modified and added files)", () => {
        const marker = "@@ -1 +1 @@\n-a\n+b\n\\ No newline at end of file";
        expect(() => appendHunk(file(marker), ["x"])).toThrow(/no newline at end of file/i);
        const added = file("@@ -0,0 +1 @@\n+a\n\\ No newline at end of file", { status: "added" });
        expect(() => appendHunk(added, ["x"])).toThrow(/no newline at end of file/i);
    });

    it("anchors after oldStart when the last hunk has no old lines", () => {
        const out = appendHunk(file("@@ -5,0 +6,2 @@\n+a\n+b"), ["c"]);
        const hunks = parsePatch(out.patch!);
        // Pure insertion after old line 5: old side is 5, and +2 already shifted the new side.
        expect(hunks[1]).toMatchObject({ oldStart: 5, oldLines: 0, newStart: 8, newLines: 1 });
    });

    it("refuses an empty append", () => {
        expect(() => appendHunk(file(TWO_HUNKS), [])).toThrow(/nothing to append/);
    });
});

describe("insertIntoHunk", () => {
    it("inserts lines after a body line and shifts later hunks", () => {
        // After " one" (index 0) in hunk 0.
        const out = insertIntoHunk(file(TWO_HUNKS), 0, 0, ["track();"]);
        const hunks = parsePatch(out.patch!);
        expect(hunks[0]).toMatchObject({ oldStart: 1, oldLines: 3, newStart: 1, newLines: 5 });
        expect(hunks[0]!.lines).toEqual([" one", "+track();", "+two", " three", " four"]);
        expect(hunks[1]).toMatchObject({ oldStart: 10, newStart: 12, newLines: 3 });
        expect(out.additions).toBe(4);
    });

    it("can insert into the last hunk without touching earlier ones", () => {
        const out = insertIntoHunk(file(TWO_HUNKS), 1, 3, ["a();", "b();"]);
        const hunks = parsePatch(out.patch!);
        expect(hunks[0]).toMatchObject({ newStart: 1, newLines: 4 });
        expect(hunks[1]).toMatchObject({ newStart: 11, newLines: 5 });
        expect(hunks[1]!.lines.slice(-2)).toEqual(["+a();", "+b();"]);
    });

    it("rejects out-of-range hunks and lines", () => {
        expect(() => insertIntoHunk(file(TWO_HUNKS), 2, 0, ["x"])).toThrow(/hunk 2/);
        expect(() => insertIntoHunk(file(TWO_HUNKS), 0, 4, ["x"])).toThrow(/line 4/);
        expect(() => insertIntoHunk(file(TWO_HUNKS), 0, -1, ["x"])).toThrow(/line -1/);
    });

    it("refuses to split a line from its no-newline marker", () => {
        const marker = "@@ -1 +1,2 @@\n a\n+b\n\\ No newline at end of file";
        expect(() => insertIntoHunk(file(marker), 0, 1, ["x"])).toThrow(/no newline/i);
        expect(() => insertIntoHunk(file(marker), 0, 2, ["x"])).toThrow(/no newline/i);
        expect(insertIntoHunk(file(marker), 0, 0, ["x"]).additions).toBe(2);
    });

    it("refuses empty input and patchless files", () => {
        expect(() => insertIntoHunk(file(TWO_HUNKS), 0, 0, [])).toThrow(/nothing to insert/);
        expect(() => insertIntoHunk({ ...file(TWO_HUNKS), patch: undefined }, 0, 0, ["x"])).toThrow(
            /no patch/,
        );
    });
});
