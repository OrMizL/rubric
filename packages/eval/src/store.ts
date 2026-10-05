import { randomUUID } from "node:crypto";
import { mkdir, readFile, readdir, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { CaseSchema, validateCase, type EvalCase } from "./case.js";

export interface Splits {
    dev: string[];
    full: string[];
}

export function casesDir(dataDir: string): string {
    return join(dataDir, "cases");
}

export async function readJson<T>(path: string): Promise<T> {
    return JSON.parse(await readFile(path, "utf8")) as T;
}

/** tmp + rename, so a crash mid-write never leaves a half-written file behind. */
export async function writeJsonAtomic(path: string, value: unknown): Promise<void> {
    await mkdir(dirname(path), { recursive: true });
    // Unique per write: concurrent runner workers can hit one key.
    const tmp = `${path}.${process.pid}.${randomUUID()}.tmp`;
    await writeFile(tmp, JSON.stringify(value, null, 2) + "\n");
    await rename(tmp, path);
}

export async function writeCase(dataDir: string, c: EvalCase): Promise<void> {
    await writeJsonAtomic(join(casesDir(dataDir), `${c.id}.json`), c);
}

export async function readCase(dataDir: string, id: string): Promise<EvalCase> {
    const path = join(casesDir(dataDir), `${id}.json`);
    let raw: unknown;
    try {
        raw = await readJson(path);
    } catch {
        throw new Error(`case "${id}" not found at ${path}`);
    }
    const parsed = CaseSchema.safeParse(raw);
    if (!parsed.success) {
        throw new Error(`case "${id}" at ${path} is malformed: ${parsed.error.message}`);
    }
    // A renamed or copied file would otherwise run under the wrong id and skew results.
    if (parsed.data.id !== id) {
        throw new Error(`case file for "${id}" at ${path} contains id "${parsed.data.id}"`);
    }
    return parsed.data;
}

export async function listCaseIds(dataDir: string): Promise<string[]> {
    const names = await readdir(casesDir(dataDir)).catch(() => [] as string[]);
    return names
        .filter((n) => n.endsWith(".json"))
        .map((n) => n.slice(0, -".json".length))
        .sort();
}

export async function loadSplits(dataDir: string): Promise<Splits> {
    return readJson<Splits>(join(dataDir, "splits.json"));
}

/** Loads and validates every case a split names; any missing or invalid case aborts. */
export async function loadSplitCases(dataDir: string, split: keyof Splits): Promise<EvalCase[]> {
    const ids = (await loadSplits(dataDir))[split];
    const cases = await Promise.all(ids.map((id) => readCase(dataDir, id)));
    const problems = cases.flatMap(validateCase);
    if (problems.length > 0) throw new Error(`invalid cases:\n${problems.join("\n")}`);
    return cases;
}
