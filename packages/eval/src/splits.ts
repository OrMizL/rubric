import { createHash } from "node:crypto";
import type { EvalCase } from "./case.js";
import type { Splits } from "./store.js";

function hash(s: string): string {
    return createHash("sha256").update(s).digest("hex");
}

/**
 * Dev takes up to `devPerMutation` cases per mutation, round-robin across repos in
 * a hash order, so tuning prompts on dev does not overfit to one codebase and the
 * selection does not depend on file listing order. Each mutation starts where the
 * previous one stopped in that repo order; restarting from the same repo every time
 * would draw every mutation's dev cases from the same handful of repos.
 */
export function makeSplits(cases: EvalCase[], devPerMutation = 6): Splits {
    const full = cases.map((c) => c.id).sort();
    const byMutation = new Map<string, EvalCase[]>();
    for (const c of cases) {
        byMutation.set(c.mutation, [...(byMutation.get(c.mutation) ?? []), c]);
    }
    const repoOrder = [...new Set(cases.map((c) => c.meta.repo))].sort((a, b) =>
        hash(a).localeCompare(hash(b)),
    );
    let cursor = 0;
    const dev: string[] = [];
    for (const mutation of [...byMutation.keys()].sort()) {
        const group = byMutation.get(mutation)!;
        const byRepo = new Map<string, EvalCase[]>();
        for (const c of [...group].sort((a, b) => hash(a.id).localeCompare(hash(b.id)))) {
            byRepo.set(c.meta.repo, [...(byRepo.get(c.meta.repo) ?? []), c]);
        }
        const rotated = [...repoOrder.slice(cursor), ...repoOrder.slice(0, cursor)];
        const queues = rotated.filter((r) => byRepo.has(r)).map((r) => byRepo.get(r)!);
        const picked: string[] = [];
        let lastRepo: string | undefined;
        while (picked.length < devPerMutation && queues.some((q) => q.length > 0)) {
            for (const q of queues) {
                const next = q.shift();
                if (next && picked.length < devPerMutation) {
                    picked.push(next.id);
                    lastRepo = next.meta.repo;
                }
            }
        }
        if (lastRepo !== undefined) {
            cursor = (repoOrder.indexOf(lastRepo) + 1) % repoOrder.length;
        }
        dev.push(...picked);
    }
    return { dev: dev.sort(), full };
}
