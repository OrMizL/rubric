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
}

const pct = (x: number) => `${(x * 100).toFixed(1)}`;

export function fmtRate(r: Rate): string {
    return `${pct(r.rate)}% [${pct(r.lo)}–${pct(r.hi)}] (${r.k}/${r.n})`;
}

const usd = (x: number) => `$${x.toFixed(3)}`;
const secs = (ms: number) => `${(ms / 1000).toFixed(1)}s`;

export function renderReport(manifest: Manifest, m: Metrics, obs: Observation[]): string {
    const lines: string[] = [
        `# Rubric eval — ${manifest.runId}`,
        ``,
        `- rubric: \`${manifest.rubricSha}\` · split: **${manifest.split}** · config: **${manifest.config.name}** (${manifest.config.model}, infer ${manifest.config.infer ? "on" : "off"}${manifest.config.maxDiffTokens ? `, diff budget ${manifest.config.maxDiffTokens}` : ""})`,
        `- ${m.cases} cases × ${m.samples} sample(s) = ${m.observations} observations · spent ${usd(manifest.spentUsd)} (estimated ${usd(manifest.estimatedUsd)})`,
        `- Rates show a 95% Wilson interval. At ~30 cases per row that is roughly ±14 points: treat small differences as noise.`,
    ];
    if (manifest.stoppedForBudget) {
        lines.push(
            ``,
            `> **Incomplete:** the run stopped at the spend cap. Rates cover only the cases that ran.`,
        );
    }

    lines.push(``, `## Catch rate by mutation`, ``, `| Mutation | Pass rate |`, `| --- | --- |`);
    for (const [mutation, rate] of Object.entries(m.catchRate)) {
        lines.push(`| ${mutation} | ${fmtRate(rate!)} |`);
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
        const sample = obs.find((o) => o.caseId === id)!;
        const why = sample.error
            ? `error: ${sample.error}`
            : (sample.score?.anchors ?? [])
                  .filter((a) => a.outcome !== "pass")
                  .map((a) => `${a.kind} ${a.outcome}: ${a.detail}`)
                  .join("; ");
        lines.push(`- **${id}** (${sample.mutation}) — ${why}`);
    }
    return lines.join("\n") + "\n";
}

function delta(a: Rate, b: Rate): string {
    const d = (b.rate - a.rate) * 100;
    return `${pct(a.rate)}% → ${pct(b.rate)}% (${d >= 0 ? "+" : ""}${d.toFixed(1)})`;
}

export function renderCompare(
    a: { manifest: Manifest; metrics: Metrics; obs: Observation[] },
    b: { manifest: Manifest; metrics: Metrics; obs: Observation[] },
): string {
    const lines = [
        `# Compare ${a.manifest.runId} → ${b.manifest.runId}`,
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
    lines.push(
        `| false alarm | ${delta(a.metrics.falseAlarm, b.metrics.falseAlarm)} |`,
        `| claim recall | ${delta(a.metrics.claimRecall, b.metrics.claimRecall)} |`,
        `| mean cost | $${a.metrics.cost.meanUsd.toFixed(3)} → $${b.metrics.cost.meanUsd.toFixed(3)} |`,
    );

    const oa = caseOutcomes(a.obs);
    const ob = caseOutcomes(b.obs);
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
