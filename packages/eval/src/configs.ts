import { DEFAULT_MODEL } from "@rubric/core";

/** A named experiment. Adding an experiment means adding one entry here. */
export interface EvalConfig {
    name: string;
    model: string;
    infer: boolean;
    maxDiffTokens?: number;
}

export const CONFIGS: Record<string, EvalConfig> = {
    default: { name: "default", model: DEFAULT_MODEL, infer: true },
    "no-infer": { name: "no-infer", model: DEFAULT_MODEL, infer: false },
    "opus-5-5": { name: "opus-5-5", model: "claude-opus-5-5", infer: true },
    "sonnet-5-5": { name: "sonnet-5-5", model: "claude-sonnet-5-5", infer: true },
    // Small enough that most real PRs truncate, to measure what truncation costs.
    "budget-8k": { name: "budget-8k", model: DEFAULT_MODEL, infer: true, maxDiffTokens: 8_000 },
};

export function getConfig(name: string): EvalConfig {
    const config = CONFIGS[name];
    if (!config) {
        throw new Error(`unknown config "${name}"; known: ${Object.keys(CONFIGS).join(", ")}`);
    }
    return config;
}
