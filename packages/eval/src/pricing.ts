import type { EngineCall } from "@rubric/core";

// USD per million tokens. Rubric does not use prompt caching, so cache-read and
// cache-write rates are deliberately absent. An unknown model throws: a silent $0
// would make a model-comparison run look free.
export const PRICES: Record<string, { inputPerM: number; outputPerM: number }> = {
    "claude-opus-4-8": { inputPerM: 5, outputPerM: 25 },
    "claude-opus-5-5": { inputPerM: 4, outputPerM: 20 },
    "claude-sonnet-5-5": { inputPerM: 2, outputPerM: 10 },
    "claude-haiku-4-5": { inputPerM: 1, outputPerM: 5 },
};

export function costUsd(
    model: string,
    usage: { input_tokens: number; output_tokens: number },
): number {
    const price = PRICES[model];
    if (!price) throw new Error(`no price for model "${model}"; add it to PRICES`);
    return (
        (usage.input_tokens * price.inputPerM + usage.output_tokens * price.outputPerM) / 1_000_000
    );
}

export function callsCostUsd(calls: EngineCall[]): number {
    return calls.reduce((sum, c) => sum + costUsd(c.model, c.usage), 0);
}
