/** Numeric CLI flags: Number("abc") is NaN, and NaN silently disables every `>` budget check. */
export function parsePositive(
    name: string,
    raw: string,
    opts: { allowZero?: boolean; integer?: boolean } = {},
): number {
    const n = raw.trim() === "" ? NaN : Number(raw);
    if (!Number.isFinite(n) || n < 0 || (n === 0 && !opts.allowZero)) {
        throw new Error(`--${name} must be a positive number, got "${raw}"`);
    }
    if (opts.integer && !Number.isInteger(n)) {
        throw new Error(`--${name} must be a positive integer, got "${raw}"`);
    }
    return n;
}
