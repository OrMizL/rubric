/**
 * The SDK throws a plain AnthropicError starting with this text when the model's
 * structured output fails Zod validation (e.g. one out-of-range enum value). It is
 * intermittent: in the first full eval run, 2 of 183 reviews failed this way and
 * both succeeded on a second attempt. API errors carry an HTTP `status` and are
 * already retried by the SDK, so they are excluded here.
 */
export function isStructuredOutputParseError(err: unknown): boolean {
    return (
        err instanceof Error &&
        !("status" in err) &&
        err.message.startsWith("Failed to parse structured output")
    );
}

/**
 * Run `attempt`, and run it once more if it fails with a structured-output parse
 * error. One retry, not a loop: a second identical failure is a real outcome.
 * The failed attempt was billed, but the SDK throws before its usage is visible,
 * so an onCall observer only sees the retry.
 */
export async function retryOnParseError<T>(attempt: () => Promise<T>): Promise<T> {
    try {
        return await attempt();
    } catch (err) {
        if (!isStructuredOutputParseError(err)) throw err;
        return attempt();
    }
}
