#!/usr/bin/env node
// rubric-eval — internal eval harness. Paid commands: `generate --drafted`, `run`.
import { access, readFile, readdir, writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { execSync } from "node:child_process";
import { userInfo } from "node:os";
import { Octokit } from "@octokit/rest";
import {
    GitHubClient,
    buildInferSystemPrompt,
    buildSystemPrompt,
    type PullRequestData,
} from "@rubric/core";
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
import { SMUGGLE_SIZES, SMUGGLE_TEMPLATES } from "./templates.js";
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
    },
});

const [command, ...args] = positionals;
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
    const manifest = await readJson<Manifest>(join(runDir, "manifest.json"));
    const results = (await readFile(join(runDir, "results.jsonl"), "utf8"))
        .split("\n")
        .filter(Boolean)
        .map((l) => JSON.parse(l) as ResultLine);
    const dir = dataDir();
    const cases = await Promise.all(manifest.caseIds.map((id) => readCase(dir, id)));
    const obs = toObservations(cases, results);
    return { manifest, obs, metrics: computeMetrics(obs) };
}

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
        for (const ref of refs) {
            const id = sourceId(ref);
            const pr = await gh().getPullRequestData(ref.owner, ref.repo, ref.number);
            const { data } = await octokit.pulls.get({
                owner: ref.owner,
                repo: ref.repo,
                pull_number: ref.number,
            });
            const reasons = checkSource(pr, data.merged_at !== null);
            if (reasons.length > 0) {
                console.error(`reject ${id}: ${reasons.join("; ")}`);
                continue;
            }
            await writeJsonAtomic(join(dir, "sources", `${id}.json`), pr);
            console.log(`fetched ${id}`);
        }
        break;
    }
    case "generate": {
        const dir = dataDir();
        const sources = await loadSources(dir);
        if (values.scripted) {
            // behavior.json is human-maintained: only a person can say a diff changes behavior.
            const behavior = await readJson<Record<string, boolean>>(
                join(dir, "behavior.json"),
            ).catch(() => ({}) as Record<string, boolean>);
            const cases: EvalCase[] = [];
            sources.forEach(({ key, pr }, i) => {
                cases.push(control(key, pr), controlStripped(key, pr));
                const donor = pickDonor(key, sources);
                if (donor) cases.push(swap(key, pr, donor));
                if (behavior[key]) cases.push(scopeLie(key, pr, i % SCOPE_LIE_PHRASES.length));
            });
            await saveCases(dir, cases);
        } else if (values.drafted) {
            const drafter = cachedDrafter(
                claudeDrafter(assertPaidAllowed()),
                join(dir, "generation-cache"),
            );
            const limit = values.limit ? Number(values.limit) : sources.length;
            for (const [i, { key, pr }] of sources.slice(0, limit).entries()) {
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
                    console.error(`claim_drop ${key}: ${err instanceof Error ? err.message : err}`);
                }
                const target = pickSmuggleTarget(pr);
                if (!target) continue;
                const template = SMUGGLE_TEMPLATES[i % SMUGGLE_TEMPLATES.length]!;
                const size = SMUGGLE_SIZES[i % SMUGGLE_SIZES.length]!;
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
                    console.error(`smuggle ${key}: ${err instanceof Error ? err.message : err}`);
                }
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
        const cases = await Promise.all((await listCaseIds(dir)).map((id) => readCase(dir, id)));
        const splits = makeSplits(cases, Number(values["dev-per-mutation"]));
        await writeJsonAtomic(join(dir, "splits.json"), splits);
        console.log(`dev ${splits.dev.length}, full ${splits.full.length}`);
        break;
    }
    case "run": {
        const apiKey = assertPaidAllowed();
        const dir = dataDir();
        const split = values.split === "full" ? "full" : "dev";
        const config = getConfig(values.config!);
        const cases = await loadSplitCases(dir, split);
        const samples = Number(values.samples);
        const outcome = await runEval({
            cases,
            config,
            samples,
            maxUsd: Number(values["max-usd"]),
            concurrency: Number(values.concurrency),
            cacheDir: join(dir, "output-cache"),
            engineFingerprint: await engineFingerprint(),
            reviewer: realReviewer(apiKey),
            estimator: realEstimator(apiKey, Number(values["assume-output-tokens"])),
            prompts: { review: buildSystemPrompt(), infer: buildInferSystemPrompt() },
        });
        const runId = `${new Date().toISOString().replace(/[:.]/g, "-")}-${split}-${config.name}`;
        const runDir = join(dir, "runs", runId);
        await mkdir(runDir, { recursive: true });
        const manifest: Manifest = {
            runId,
            createdAt: new Date().toISOString(),
            rubricSha: execSync("git rev-parse --short HEAD").toString().trim(),
            split,
            config,
            samples,
            caseIds: cases.map((c) => c.id),
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
