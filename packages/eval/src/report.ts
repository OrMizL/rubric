import type { EvalConfig } from "./configs.js";
import { caseOutcomes, type Metrics, type Observation, type Rate } from "./metrics.js";

export interface Manifest {
    runId: string;
    createdAt: string;
    rubricSha: string;
    split: string;
    config: EvalConfig;
    samples: number;
    caseIds: string[];
    estimatedUsd: number;
    spentUsd: number;
    stoppedForBudget: boolean;
    /** Per-case sha256 of input+label at run time; report/compare refuse edited cases. */
    caseHashes: Record<string, string>;
    /** Set when a report was rendered with --allow-changed-cases. */
    changedCases?: string[];
}

const pct = (x: number) => `${(x * 100).toFixed(1)}`;

export function fmtRate(r: Rate): string {
    if (r.n === 0) return "n/a (0/0)";
    return `${pct(r.rate)}% [${pct(r.lo)}–${pct(r.hi)}] (${r.k}/${r.n})`;
}

const usd = (x: number) => `$${x.toFixed(3)}`;
const secs = (ms: number) => `${(ms / 1000).toFixed(1)}s`;

export function renderReport(manifest: Manifest, m: Metrics, obs: Observation[]): string {
    const planned = manifest.caseIds.length;
    const lines: string[] = [
        `# Rubric eval — ${manifest.runId}`,
        ``,
        `- rubric: \`${manifest.rubricSha}\` · split: **${manifest.split}** · config: **${manifest.config.name}** (${manifest.config.model}, infer ${manifest.config.infer ? "on" : "off"}${manifest.config.maxDiffTokens ? `, diff budget ${manifest.config.maxDiffTokens}` : ""})`,
        `- ${m.cases} of ${planned} planned cases × ${m.samples} sample(s) = ${m.observations} observations · spent ${usd(manifest.spentUsd)} (estimated ${usd(manifest.estimatedUsd)})`,
        `- Rates show a 95% Wilson interval. At ~30 cases per row that is roughly ±14 points: treat small differences as noise.`,
    ];
    if (manifest.changedCases && manifest.changedCases.length > 0) {
        lines.push(
            ``,
            `> **Cases changed since this run** (--allow-changed-cases): ${manifest.changedCases.join(", ")}. Scores use the current cases, not the ones the model saw.`,
        );
    }
    if (manifest.stoppedForBudget || m.cases < planned) {
        const cause = manifest.stoppedForBudget ? " The run stopped at the spend cap." : "";
        lines.push(
            ``,
            `> **Incomplete:** ran ${m.cases} of ${planned} planned cases.${cause} Rates cover only the cases that ran.`,
        );
    }

    lines.push(``, `## Catch rate by mutation`, ``, `| Mutation | Pass rate |`, `| --- | --- |`);
    for (const [mutation, rate] of Object.entries(m.catchRate)) {
        if (!rate) continue;
        lines.push(`| ${mutation} | ${fmtRate(rate)} |`);
    }

    lines.push(
        ``,
        `## Honest PRs`,
        ``,
        `- False alarm (\`misaligned\`): ${fmtRate(m.falseAlarm)}`,
        `- \`partially_aligned\` (allowed, tracked): ${fmtRate(m.partialOnControls)}`,
    );

    if (m.smuggleBySize.length > 0) {
        lines.push(
            ``,
            `## Smuggle detection by size`,
            ``,
            `| Smuggle lines | Diff lines | Caught |`,
            `| --- | --- | --- |`,
        );
        for (const b of m.smuggleBySize)
            lines.push(`| ${b.smuggle} | ${b.diff} | ${fmtRate(b.rate)} |`);
    }

    lines.push(
        ``,
        `## Claims`,
        ``,
        `- Recall (claim anchors matched, scored observations): ${fmtRate(m.claimRecall)}`,
        `- Precision (real cases, scored observations): ${m.claimPrecision ? fmtRate(m.claimPrecision) : "n/a (no real cases)"}`,
    );

    lines.push(``, `## Stability`, ``);
    lines.push(
        m.stability
            ? `- Mean verdict agreement (excludes all-errored cases): ${pct(m.stability.meanAgreement)}% · cases whose pass/fail flips: ${fmtRate(m.stability.flipRate)}`
            : `- n/a (1 sample per case)`,
    );

    lines.push(
        ``,
        `## Cost and latency (per observation)`,
        ``,
        `| | Mean | p90 |`,
        `| --- | --- | --- |`,
        `| Cost | ${usd(m.cost.meanUsd)} | ${usd(m.cost.p90Usd)} |`,
        `| Latency | ${secs(m.cost.meanMs)} | ${secs(m.cost.p90Ms)} |`,
        ``,
        `By stage: infer ${usd(m.cost.byStage.infer.meanUsd)} / ${secs(m.cost.byStage.infer.meanMs)}, review ${usd(m.cost.byStage.review.meanUsd)} / ${secs(m.cost.byStage.review.meanMs)}.`,
        ``,
        `## Errors`,
        ``,
        `- Failed calls: ${fmtRate(m.errors.failed)}`,
        `- Inference failed (review ran without it): ${fmtRate(m.errors.inferenceFailed)}`,
    );

    const outcomes = caseOutcomes(obs);
    const failing = [...outcomes.entries()]
        .filter(([, o]) => !o.pass)
        .map(([id]) => id)
        .sort();
    lines.push(``, `## Failing cases`, ``);
    if (failing.length === 0) lines.push(`None.`);
    for (const id of failing) {
        const samples = obs.filter((o) => o.caseId === id);
        const failed = samples.filter((o) => o.score?.pass !== true);
        const first = failed[0];
        if (!first) continue;
        const why = first.error
            ? `error: ${first.error}`
            : (first.score?.anchors ?? [])
                  .filter((a) => a.outcome !== "pass")
                  .map((a) => `${a.kind} ${a.outcome}: ${a.detail}`)
                  .join("; ");
        const count =
            samples.length > 1 ? ` (${failed.length} of ${samples.length} samples failed)` : "";
        lines.push(`- **${id}** (${first.mutation})${count} — ${why}`);
    }
    return lines.join("\n") + "\n";
}

function delta(a: Rate, b: Rate): string {
    const d = (b.rate - a.rate) * 100;
    return `${pct(a.rate)}% (n=${a.n}) → ${pct(b.rate)}% (n=${b.n}) (${d >= 0 ? "+" : ""}${d.toFixed(1)})`;
}

export function renderCompare(
    a: { manifest: Manifest; metrics: Metrics; obs: Observation[] },
    b: { manifest: Manifest; metrics: Metrics; obs: Observation[] },
): string {
    const lines = [
        `# Compare ${a.manifest.runId} → ${b.manifest.runId}`,
        ``,
        `Differences within the intervals are noise; check n before trusting a delta.`,
        ``,
        `| Metric | Change |`,
        `| --- | --- |`,
    ];
    const mutations = new Set([
        ...Object.keys(a.metrics.catchRate),
        ...Object.keys(b.metrics.catchRate),
    ]);
    for (const mut of mutations) {
        const ra = a.metrics.catchRate[mut as keyof Metrics["catchRate"]];
        const rb = b.metrics.catchRate[mut as keyof Metrics["catchRate"]];
        if (ra && rb) lines.push(`| catch: ${mut} | ${delta(ra, rb)} |`);
    }
    const oa = caseOutcomes(a.obs);
    const ob = caseOutcomes(b.obs);
    const warnings: string[] = [];
    for (const r of [a, b]) {
        if (r.manifest.stoppedForBudget) {
            warnings.push(`${r.manifest.runId} stopped at the spend cap (incomplete).`);
        }
    }
    if (a.manifest.split !== b.manifest.split) {
        warnings.push(`split differs: ${a.manifest.split} vs ${b.manifest.split}.`);
    }
    if (a.manifest.samples !== b.manifest.samples) {
        warnings.push(`samples differ: ${a.manifest.samples} vs ${b.manifest.samples}.`);
    }
    if (a.manifest.config.name !== b.manifest.config.name) {
        warnings.push(`config differs: ${a.manifest.config.name} vs ${b.manifest.config.name}.`);
    }
    const onlyA = [...oa.keys()].filter((id) => !ob.has(id)).length;
    const onlyB = [...ob.keys()].filter((id) => !oa.has(id)).length;
    if (onlyA > 0) warnings.push(`${onlyA} case(s) only in ${a.manifest.runId}.`);
    if (onlyB > 0) warnings.push(`${onlyB} case(s) only in ${b.manifest.runId}.`);
    if (warnings.length > 0) {
        lines.splice(4, 0, `## Warnings`, ``, ...warnings.map((w) => `- ${w}`), ``);
    }

    lines.push(
        `| false alarm | ${delta(a.metrics.falseAlarm, b.metrics.falseAlarm)} |`,
        `| claim recall | ${delta(a.metrics.claimRecall, b.metrics.claimRecall)} |`,
        `| mean cost | $${a.metrics.cost.meanUsd.toFixed(3)} → $${b.metrics.cost.meanUsd.toFixed(3)} |`,
    );

    const toFail: string[] = [];
    const toPass: string[] = [];
    for (const [id, before] of oa) {
        const after = ob.get(id);
        if (!after) continue;
        if (before.pass && !after.pass) toFail.push(id);
        if (!before.pass && after.pass) toPass.push(id);
    }
    lines.push(
        ``,
        `## pass → fail`,
        ``,
        ...(toFail.length ? toFail.sort().map((id) => `- ${id}`) : ["None."]),
    );
    lines.push(
        ``,
        `## fail → pass`,
        ``,
        ...(toPass.length ? toPass.sort().map((id) => `- ${id}`) : ["None."]),
    );
    return lines.join("\n") + "\n";
}
