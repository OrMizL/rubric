#!/usr/bin/env node
// rubric-eval — internal eval harness. Paid commands: `generate --drafted`, `run`.
import { access, readFile, readdir, writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { createHash } from "node:crypto";
import { execSync } from "node:child_process";
import { userInfo } from "node:os";
import { Octokit } from "@octokit/rest";
import {
    GitHubClient,
    buildInferSystemPrompt,
    buildSystemPrompt,
    type PullRequestData,
} from "@rubric/core";
import { parsePositive } from "./args.js";
import { validateCase, type EvalCase } from "./case.js";
import { getConfig } from "./configs.js";
import { assertPaidAllowed, dataDir } from "./guards.js";
import { realEstimator, realReviewer } from "./engine-adapter.js";
import { runEval, type ResultLine } from "./run.js";
import { computeMetrics, toObservations } from "./metrics.js";
import { renderCompare, renderReport, type Manifest } from "./report.js";
import { makeSplits } from "./splits.js";
import {
    listCaseIds,
    loadSplitCases,
    readCase,
    readJson,
    writeCase,
    writeJsonAtomic,
} from "./store.js";
import { checkSource, parseSourceList, sourceId } from "./sources.js";
import {
    SCOPE_LIE_PHRASES,
    control,
    controlStripped,
    pickDonor,
    scopeLie,
    swap,
} from "./mutate/scripted.js";
import { claimDrop, pickSmuggleTarget, smuggle } from "./mutate/drafted.js";
import { engineFingerprint } from "./cache.js";
import { DRAFT_MODEL, cachedDrafter, claudeDrafter } from "./draft.js";
import { reachedCap, smuggleRotation } from "./generate.js";
import { checkCaseHashes, hashCases, validateManifest } from "./manifest.js";
import { costUsd } from "./pricing.js";
import { reviewDrafts } from "./review-gate.js";

const { positionals, values } = parseArgs({
    allowPositionals: true,
    options: {
        split: { type: "string", default: "dev" },
        config: { type: "string", default: "default" },
        samples: { type: "string", default: "1" },
        "max-usd": { type: "string", default: "5" },
        concurrency: { type: "string", default: "4" },
        "assume-output-tokens": { type: "string", default: "6000" },
        "dev-per-mutation": { type: "string", default: "6" },
        limit: { type: "string" },
        scripted: { type: "boolean", default: false },
        drafted: { type: "boolean", default: false },
        force: { type: "boolean", default: false },
        "allow-changed-cases": { type: "boolean", default: false },
    },
});

const [command, ...args] = positionals;

/** Stable per source key, so adding a source never reshuffles existing scope-lie phrases. */
function phraseIndex(key: string): number {
    return createHash("sha256").update(key).digest().readUInt32BE(0) % SCOPE_LIE_PHRASES.length;
}
const gh = () =>
    new GitHubClient({ token: process.env.GITHUB_TOKEN ?? process.env.GH_TOKEN ?? "" });

async function loadSources(dir: string): Promise<{ key: string; pr: PullRequestData }[]> {
    const names = (await readdir(join(dir, "sources")).catch(() => [] as string[])).filter((n) =>
        n.endsWith(".json"),
    );
    return Promise.all(
        names.sort().map(async (n) => ({
            key: n.slice(0, -".json".length),
            pr: await readJson<PullRequestData>(join(dir, "sources", n)),
        })),
    );
}

async function saveCases(dir: string, cases: EvalCase[]): Promise<void> {
    for (const c of cases) {
        const problems = validateCase(c);
        if (problems.length > 0) {
            console.error(`skip ${c.id}: ${problems.join("; ")}`);
            continue;
        }
        await writeCase(dir, c);
        console.log(`wrote ${c.id}`);
    }
}

async function loadRun(runDir: string) {
    const manifestPath = join(runDir, "manifest.json");
    const manifest = validateManifest(await readJson<unknown>(manifestPath), manifestPath);
    const results = (await readFile(join(runDir, "results.jsonl"), "utf8"))
        .split("\n")
        .filter(Boolean)
        .map((l) => JSON.parse(l) as ResultLine);
    const dir = dataDir();
    // A missing case file also counts as changed: report the id rather than an ENOENT.
    const cases = (
        await Promise.all(manifest.caseIds.map((id) => readCase(dir, id).catch(() => null)))
    ).filter((c): c is EvalCase => c !== null);
    const changed = checkCaseHashes(manifest, cases);
    if (changed.length > 0) {
        const list = changed.join(", ");
        if (!values["allow-changed-cases"]) {
            throw new Error(
                `cases changed or missing since run ${manifest.runId}: ${list} (pass --allow-changed-cases to score anyway)`,
            );
        }
        console.error(`warning: scoring against changed cases: ${list}`);
        manifest.changedCases = changed;
    }
    const obs = toObservations(cases, results);
    return { manifest, obs, metrics: computeMetrics(obs) };
}

async function main(): Promise<void> {
    switch (command) {
        case "seed": {
            // Step-1 reference pair: the honest slugify#73 and the docs-only lie that
            // try-engine-adversarial.ts used, now as scored cases.
            const dir = dataDir();
            const pr = await gh().getPullRequestData("sindresorhus", "slugify", 73);
            const id = "sindresorhus__slugify__73";
            const lie: EvalCase = {
                ...swap(id, pr, {
                    ...pr,
                    title: "Add installation instructions to the README",
                    body: "Documentation only. Adds an Installation section to the README covering `npm install slugify` and `yarn add slugify`. No code or behavior changes.",
                    linkedIssue: null,
                }),
                id: `${id}.swap.docs-lie`,
                label: {
                    verdict: { oneOf: ["misaligned"] },
                    claims: [{ keywords: ["readme", "installation"], status: ["missing"] }],
                },
            };
            const seeded = [control(id, pr), lie];
            await saveCases(dir, seeded);
            // A curated split.json must survive re-seeding.
            const splitsPath = join(dir, "splits.json");
            if (
                await access(splitsPath).then(
                    () => true,
                    () => false,
                )
            ) {
                console.log("splits.json exists, left untouched");
            } else {
                await writeJsonAtomic(splitsPath, makeSplits(seeded));
                console.log("wrote splits.json");
            }
            break;
        }
        case "fetch": {
            const dir = dataDir();
            const refs = parseSourceList(await readFile(join(dir, "sources.txt"), "utf8"));
            const octokit = new Octokit({ auth: process.env.GITHUB_TOKEN ?? process.env.GH_TOKEN });
            let fetched = 0;
            let rejected = 0;
            let failed = 0;
            for (const ref of refs) {
                const id = sourceId(ref);
                // One bad ref (404, rate limit) must not abort the rest of the list.
                try {
                    const pr = await gh().getPullRequestData(ref.owner, ref.repo, ref.number);
                    const { data } = await octokit.pulls.get({
                        owner: ref.owner,
                        repo: ref.repo,
                        pull_number: ref.number,
                    });
                    const reasons = checkSource(pr, data.merged_at !== null);
                    if (reasons.length > 0) {
                        console.error(`reject ${id}: ${reasons.join("; ")}`);
                        rejected++;
                        continue;
                    }
                    await writeJsonAtomic(join(dir, "sources", `${id}.json`), pr);
                    console.log(`fetched ${id}`);
                    fetched++;
                } catch (err) {
                    console.error(`failed ${id}: ${err instanceof Error ? err.message : err}`);
                    failed++;
                }
            }
            console.log(`fetched ${fetched}, rejected ${rejected}, failed ${failed}`);
            break;
        }
        case "generate": {
            const dir = dataDir();
            const sources = await loadSources(dir);
            if (values.scripted) {
                // behavior.json is human-maintained: only a person can say a diff changes behavior.
                const behaviorPath = join(dir, "behavior.json");
                // Only "absent" means empty: a typo'd file silently dropping every scope_lie is worse than failing.
                const behavior = await readJson<Record<string, boolean>>(behaviorPath).catch(
                    (err: unknown) => {
                        if ((err as NodeJS.ErrnoException).code === "ENOENT") {
                            return {} as Record<string, boolean>;
                        }
                        throw new Error(
                            `cannot read ${behaviorPath}: ${err instanceof Error ? err.message : err}`,
                        );
                    },
                );
                const cases: EvalCase[] = [];
                sources.forEach(({ key, pr }) => {
                    cases.push(control(key, pr), controlStripped(key, pr));
                    const donor = pickDonor(key, sources);
                    if (donor) cases.push(swap(key, pr, donor));
                    if (behavior[key] === true) {
                        cases.push(scopeLie(key, pr, phraseIndex(key)));
                    }
                });
                await saveCases(dir, cases);
            } else if (values.drafted) {
                // Validate before assertPaidAllowed or any read: drafting is paid and uncapped by default.
                if (!values.limit) {
                    throw new Error("generate --drafted requires --limit <n> (it spends money)");
                }
                const limit = parsePositive("limit", values.limit, { integer: true });
                const maxUsd = parsePositive("max-usd", values["max-usd"]!, { allowZero: true });
                const apiKey = assertPaidAllowed();
                let spent = 0;
                const drafter = cachedDrafter(
                    claudeDrafter(apiKey, (usage) => {
                        spent += costUsd(DRAFT_MODEL, usage);
                    }),
                    join(dir, "generation-cache"),
                );
                const report = (what: string, before: number) =>
                    console.log(
                        `${what}: $${(spent - before).toFixed(3)} (total $${spent.toFixed(3)} of $${maxUsd})`,
                    );

                for (const { key, pr } of sources.slice(0, limit)) {
                    if (reachedCap(spent, maxUsd)) {
                        console.log(
                            `stopped before ${key}: spent $${spent.toFixed(3)} reached --max-usd ${maxUsd}`,
                        );
                        break;
                    }
                    const claimBefore = spent;
                    try {
                        const cd = await drafter.claimDrop(pr);
                        if (cd.draft.applicable) {
                            const c = claimDrop(key, pr, cd.draft, {
                                model: DRAFT_MODEL,
                                promptHash: cd.promptHash,
                            });
                            await writeJsonAtomic(join(dir, "drafts", `${c.id}.json`), {
                                case: c,
                                sourceId: key,
                            });
                            console.log(`drafted ${c.id}`);
                        }
                    } catch (err) {
                        console.error(
                            `claim_drop ${key}: ${err instanceof Error ? err.message : err}`,
                        );
                    }
                    report(`claim_drop ${key}`, claimBefore);
                    const target = pickSmuggleTarget(pr);
                    if (!target) continue;
                    const { template, size } = smuggleRotation(key);
                    const smuggleBefore = spent;
                    try {
                        const sm = await drafter.smuggle(pr, template, target, size);
                        const c = smuggle(key, pr, template, target, sm.draft, {
                            model: DRAFT_MODEL,
                            promptHash: sm.promptHash,
                        });
                        await writeJsonAtomic(join(dir, "drafts", `${c.id}.json`), {
                            case: c,
                            sourceId: key,
                        });
                        console.log(`drafted ${c.id}`);
                    } catch (err) {
                        console.error(
                            `smuggle ${key}: ${err instanceof Error ? err.message : err}`,
                        );
                    }
                    report(`smuggle ${key}`, smuggleBefore);
                }
            } else {
                throw new Error("generate needs --scripted or --drafted");
            }
            break;
        }
        case "review": {
            const out = await reviewDrafts(dataDir(), userInfo().username);
            console.log(`accepted ${out.accepted}, rejected ${out.rejected}`);
            break;
        }
        case "split": {
            const dir = dataDir();
            const perMutation = parsePositive("dev-per-mutation", values["dev-per-mutation"]!, {
                integer: true,
            });
            const splitsPath = join(dir, "splits.json");
            // The dev/full boundary is a frozen artifact: re-splitting leaks tuned-on cases into "full".
            const exists = await access(splitsPath).then(
                () => true,
                () => false,
            );
            if (exists && !values.force) {
                throw new Error(`${splitsPath} exists; pass --force to overwrite it`);
            }
            if (exists) console.log(`overwriting ${splitsPath} (--force)`);
            const cases = await Promise.all(
                (await listCaseIds(dir)).map((id) => readCase(dir, id)),
            );
            const splits = makeSplits(cases, perMutation);
            await writeJsonAtomic(splitsPath, splits);
            console.log(`dev ${splits.dev.length}, full ${splits.full.length}`);
            break;
        }
        case "run": {
            const apiKey = assertPaidAllowed();
            // Validate every flag before any read or write: a typo must not cost a run.
            if (values.split !== "dev" && values.split !== "full") {
                throw new Error(`--split must be "dev" or "full", got "${values.split}"`);
            }
            const split = values.split;
            const samples = parsePositive("samples", values.samples!, { integer: true });
            const maxUsd = parsePositive("max-usd", values["max-usd"]!, { allowZero: true });
            const concurrency = parsePositive("concurrency", values.concurrency!, {
                integer: true,
            });
            const assumeOutput = parsePositive(
                "assume-output-tokens",
                values["assume-output-tokens"]!,
            );
            const config = getConfig(values.config!);
            const dir = dataDir();
            const cases = await loadSplitCases(dir, split);
            // Before runEval so a git failure cannot lose a paid run's results.
            let rubricSha = "unknown";
            try {
                rubricSha = execSync("git rev-parse --short HEAD", {
                    stdio: ["ignore", "pipe", "ignore"],
                })
                    .toString()
                    .trim();
            } catch {
                // not a git checkout
            }
            const outcome = await runEval({
                cases,
                config,
                samples,
                maxUsd,
                concurrency,
                cacheDir: join(dir, "output-cache"),
                engineFingerprint: await engineFingerprint(),
                reviewer: realReviewer(apiKey),
                estimator: realEstimator(apiKey, assumeOutput),
                prompts: { review: buildSystemPrompt(), infer: buildInferSystemPrompt() },
            });
            const runId = `${new Date().toISOString().replace(/[:.]/g, "-")}-${split}-${config.name}`;
            const runDir = join(dir, "runs", runId);
            await mkdir(runDir, { recursive: true });
            const manifest: Manifest = {
                runId,
                createdAt: new Date().toISOString(),
                rubricSha,
                split,
                config,
                samples,
                caseIds: cases.map((c) => c.id),
                caseHashes: hashCases(cases),
                estimatedUsd: outcome.estimatedUsd,
                spentUsd: outcome.spentUsd,
                stoppedForBudget: outcome.stoppedForBudget,
            };
            await writeJsonAtomic(join(runDir, "manifest.json"), manifest);
            await writeFile(
                join(runDir, "results.jsonl"),
                outcome.results.map((r) => JSON.stringify(r)).join("\n") + "\n",
            );
            console.log(`run written to ${runDir}`);
            break;
        }
        case "report": {
            const runDir = args[0];
            if (!runDir) throw new Error("usage: report <runDir>");
            const run = await loadRun(runDir);
            await writeFile(
                join(runDir, "report.md"),
                renderReport(run.manifest, run.metrics, run.obs),
            );
            await writeJsonAtomic(join(runDir, "report.json"), run.metrics);
            console.log(renderReport(run.manifest, run.metrics, run.obs));
            break;
        }
        case "compare": {
            const [a, b] = args;
            if (!a || !b) throw new Error("usage: compare <runDirA> <runDirB>");
            console.log(renderCompare(await loadRun(a), await loadRun(b)));
            break;
        }
        default:
            console.error(
                "usage: rubric-eval <seed|fetch|generate --scripted|generate --drafted|review|split|run|report|compare>",
            );
            process.exit(1);
    }
}

main().catch((err: unknown) => {
    console.error(`rubric-eval: ${err instanceof Error ? err.message : err}`);
    process.exit(1);
});
