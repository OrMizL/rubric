import type { ChangedFile } from "@rubric/core";

export interface Hunk {
    oldStart: number;
    oldLines: number;
    newStart: number;
    newLines: number;
    /** Text after the closing @@ (often a function signature). Preserved verbatim. */
    section: string;
    /** Body lines, each starting with " ", "+", "-", or "\". */
    lines: string[];
}

const HEADER_RE = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@(.*)$/;

export function parsePatch(patch: string): Hunk[] {
    const hunks: Hunk[] = [];
    for (const line of patch.split("\n")) {
        const m = HEADER_RE.exec(line);
        if (m) {
            hunks.push({
                oldStart: Number(m[1]),
                // An omitted count means 1 in unified diff, not 0.
                oldLines: m[2] === undefined ? 1 : Number(m[2]),
                newStart: Number(m[3]),
                newLines: m[4] === undefined ? 1 : Number(m[4]),
                section: m[5] ?? "",
                lines: [],
            });
            continue;
        }
        const current = hunks[hunks.length - 1];
        if (!current) throw new Error(`expected a hunk header, got: ${line.slice(0, 60)}`);
        current.lines.push(line);
    }
    return hunks;
}

function fmtRange(start: number, lines: number): string {
    return lines === 1 ? `${start}` : `${start},${lines}`;
}

export function serializePatch(hunks: Hunk[]): string {
    return hunks
        .map((h) =>
            [
                `@@ -${fmtRange(h.oldStart, h.oldLines)} +${fmtRange(h.newStart, h.newLines)} @@${h.section}`,
                ...h.lines,
            ].join("\n"),
        )
        .join("\n");
}

function countLines(lines: string[]): { additions: number; deletions: number } {
    let additions = 0;
    let deletions = 0;
    for (const l of lines) {
        if (l.startsWith("+")) additions++;
        else if (l.startsWith("-")) deletions++;
    }
    return { additions, deletions };
}

export function countChanges(patch: string): { additions: number; deletions: number } {
    return countLines(parsePatch(patch).flatMap((h) => h.lines));
}

export function hunkId(filename: string, index: number): string {
    return `${filename}#${index}`;
}

function withPatch(file: ChangedFile, hunks: Hunk[]): ChangedFile {
    const patch = serializePatch(hunks);
    return { ...file, patch, ...countChanges(patch) };
}

/**
 * Drop whole hunks only. Editing inside a hunk would require the full file to keep
 * context lines honest; removing whole hunks keeps every remaining header valid
 * once later newStart values are shifted by the removed hunks' net line change.
 */
export function removeHunks(file: ChangedFile, indexes: number[]): ChangedFile | null {
    if (!file.patch) throw new Error(`${file.filename} has no patch`);
    const hunks = parsePatch(file.patch);
    for (const i of indexes) {
        if (i < 0 || i >= hunks.length) {
            throw new Error(`hunk index ${i} out of range for ${file.filename}`);
        }
    }
    const drop = new Set(indexes);
    const kept: Hunk[] = [];
    let shift = 0;
    hunks.forEach((h, i) => {
        if (drop.has(i)) {
            shift -= h.newLines - h.oldLines;
            return;
        }
        kept.push({ ...h, newStart: h.newStart + shift });
    });
    return kept.length === 0 ? null : withPatch(file, kept);
}

/**
 * Append added lines after the file's last hunk. Appending (rather than inserting
 * mid-file) means no existing header moves, and we never need lines we cannot see.
 */
export function appendHunk(file: ChangedFile, added: string[]): ChangedFile {
    if (!file.patch) throw new Error(`${file.filename} has no patch`);
    const hunks = parsePatch(file.patch);
    if (added.length === 0) throw new Error("nothing to append");
    const body = added.map((l) => `+${l}`);
    const last = hunks[hunks.length - 1]!;
    // Anything after the marker would read as the file's final line gaining a newline.
    if (last.lines[last.lines.length - 1]?.startsWith("\\")) {
        throw new Error(`cannot append to ${file.filename}: no newline at end of file`);
    }

    // An added file has no old side; its one hunk simply grows.
    if (file.status === "added") {
        const grown = {
            ...last,
            newLines: last.newLines + added.length,
            lines: [...last.lines, ...body],
        };
        return withPatch(file, [...hunks.slice(0, -1), grown]);
    }

    const delta = hunks.reduce((sum, h) => sum + (h.newLines - h.oldLines), 0);
    // With no old lines the header's oldStart already names the line the insertion follows.
    const afterOld = last.oldLines === 0 ? last.oldStart : last.oldStart + last.oldLines - 1;
    const hunk: Hunk = {
        oldStart: afterOld,
        oldLines: 0,
        newStart: afterOld + delta + 1,
        newLines: added.length,
        section: "",
        lines: body,
    };
    return withPatch(file, [...hunks, hunk]);
}

/**
 * Insert added lines inside an existing hunk, after body line `afterLine`. Unlike
 * appendHunk this can land code inside a function the diff already shows, so the
 * added code actually runs instead of being a helper nothing calls. Only this
 * hunk's newLines and later hunks' newStart move; old-side numbers never change.
 */
export function insertIntoHunk(
    file: ChangedFile,
    hunkIndex: number,
    afterLine: number,
    added: string[],
): ChangedFile {
    if (!file.patch) throw new Error(`${file.filename} has no patch`);
    if (added.length === 0) throw new Error(`${file.filename}: nothing to insert`);
    const hunks = parsePatch(file.patch);
    const hunk = hunks[hunkIndex];
    if (!hunk) throw new Error(`${file.filename}: hunk ${hunkIndex} out of range`);
    if (afterLine < 0 || afterLine >= hunk.lines.length) {
        throw new Error(`${file.filename}: line ${afterLine} out of range in hunk ${hunkIndex}`);
    }
    // A "\" marker belongs to the line before it; nothing may come between them.
    if (hunk.lines[afterLine]!.startsWith("\\") || hunk.lines[afterLine + 1]?.startsWith("\\")) {
        throw new Error(
            `${file.filename}: cannot insert next to a no newline at end of file marker`,
        );
    }
    const body = added.map((l) => `+${l}`);
    const out = hunks.map((h, i) => {
        if (i === hunkIndex) {
            return {
                ...h,
                newLines: h.newLines + added.length,
                lines: [
                    ...h.lines.slice(0, afterLine + 1),
                    ...body,
                    ...h.lines.slice(afterLine + 1),
                ],
            };
        }
        return i > hunkIndex ? { ...h, newStart: h.newStart + added.length } : h;
    });
    return withPatch(file, out);
}
