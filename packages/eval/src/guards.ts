export function dataDir(env: NodeJS.ProcessEnv = process.env): string {
    const dir = env.RUBRIC_EVAL_DATA;
    if (!dir)
        throw new Error("RUBRIC_EVAL_DATA is not set (path to the private rubric-evals data)");
    return dir;
}

/** Paid commands never run in CI: a stray workflow must not be able to spend money. */
export function assertPaidAllowed(env: NodeJS.ProcessEnv = process.env): string {
    if (env.CI) throw new Error("refusing to make paid Anthropic calls with CI set");
    const key = env.ANTHROPIC_API_KEY;
    if (!key) throw new Error("ANTHROPIC_API_KEY is not set");
    return key;
}
