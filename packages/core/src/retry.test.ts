import { describe, it, expect, vi } from "vitest";
import { isStructuredOutputParseError, retryOnParseError } from "./retry.js";

const parseErr = () => new Error("Failed to parse structured output: invalid enum");

describe("isStructuredOutputParseError", () => {
    it("matches the SDK's structured-output parse failures", () => {
        expect(isStructuredOutputParseError(parseErr())).toBe(true);
        expect(
            isStructuredOutputParseError(new Error("Failed to parse structured output as JSON: x")),
        ).toBe(true);
    });
    it("ignores API errors (they carry an HTTP status) and other errors", () => {
        const api = Object.assign(new Error("Failed to parse structured output"), { status: 500 });
        expect(isStructuredOutputParseError(api)).toBe(false);
        expect(isStructuredOutputParseError(new Error("Connection error."))).toBe(false);
        expect(isStructuredOutputParseError("Failed to parse structured output")).toBe(false);
    });
});

describe("retryOnParseError", () => {
    it("retries exactly once after a parse failure", async () => {
        const attempt = vi.fn().mockRejectedValueOnce(parseErr()).mockResolvedValueOnce("ok");
        await expect(retryOnParseError(attempt)).resolves.toBe("ok");
        expect(attempt).toHaveBeenCalledTimes(2);
    });
    it("gives up after the second parse failure", async () => {
        const attempt = vi.fn().mockRejectedValue(parseErr());
        await expect(retryOnParseError(attempt)).rejects.toThrow(/Failed to parse/);
        expect(attempt).toHaveBeenCalledTimes(2);
    });
    it("does not retry other errors", async () => {
        const attempt = vi.fn().mockRejectedValue(new Error("Connection error."));
        await expect(retryOnParseError(attempt)).rejects.toThrow(/Connection/);
        expect(attempt).toHaveBeenCalledTimes(1);
    });
});
