import { createHash } from "node:crypto";
import type { EvalCase } from "./case.js";
import type { Splits } from "./store.js";

function hash(s: string): string {
    return createHash("sha256").update(s).digest("hex");
}

/**
 * Dev takes up to `devPerMutation` cases per mutation, round-robin across repos in
 * a hash order, so tuning prompts on dev does not overfit to one codebase and the
 * selection does not depend on file listing order.
 */
export function makeSplits(cases: EvalCase[], devPerMutation = 6): Splits {
    const full = cases.map((c) => c.id).sort();
    const byMutation = new Map<string, EvalCase[]>();
    for (const c of cases) {
        byMutation.set(c.mutation, [...(byMutation.get(c.mutation) ?? []), c]);
    }
    const dev: string[] = [];
    for (const group of byMutation.values()) {
        const byRepo = new Map<string, EvalCase[]>();
        for (const c of [...group].sort((a, b) => hash(a.id).localeCompare(hash(b.id)))) {
            byRepo.set(c.meta.repo, [...(byRepo.get(c.meta.repo) ?? []), c]);
        }
        const queues = [...byRepo.entries()]
            .sort(([a], [b]) => hash(a).localeCompare(hash(b)))
            .map(([, q]) => q);
        const picked: string[] = [];
        while (picked.length < devPerMutation && queues.some((q) => q.length > 0)) {
            for (const q of queues) {
                const next = q.shift();
                if (next && picked.length < devPerMutation) picked.push(next.id);
            }
        }
        dev.push(...picked);
    }
    return { dev: dev.sort(), full };
}
