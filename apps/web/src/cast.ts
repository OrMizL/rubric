/**
 * A real `npx @ormizl/rubric scan unjs/h3#1513` run, recorded 2026-10-05 with `script -T`.
 * Text and ANSI colors are verbatim; `t` compresses the waits for the replay and `real` keeps
 * the recorded seconds, so the caption can say what was sped up. Regenerate rather than edit.
 */
export interface CastLine {
    t: number;
    real: number;
    text: string;
}

export const CAST_COMMAND = "npx @ormizl/rubric scan unjs/h3#1513";
export const CAST_TOTAL_SECONDS = 75.6;

export const CAST: CastLine[] = [
    {
        t: 0.6,
        real: 1.8,
        text: "[rubric] fetching unjs/h3#1513…",
    },
    {
        t: 1.3,
        real: 3.8,
        text: "[rubric] signal score: 80/100 (high)",
    },
    {
        t: 2.6,
        real: 20.1,
        text: "[rubric] inferred 19 spec item(s)",
    },
    {
        t: 3,
        real: 20.8,
        text: "[rubric] assembled prompt: 18881 input tokens (diff budget 50000)",
    },
    {
        t: 5.6,
        real: 75.6,
        text: "",
    },
    {
        t: 5.6,
        real: 75.6,
        text: "\u001b[1m\u001b[31m✘  MISALIGNED\u001b[0m\u001b[0m",
    },
    {
        t: 5.6,
        real: 75.6,
        text: "",
    },
    {
        t: 5.6,
        real: 75.6,
        text: "The diff adds `idleTimeout` with independent maxAge/idle checks, a min-of-both cookie Expires, header-session hard expiry, seal-ttl independence, and the no-wasted-crypto gate. However, it directly contradicts the description in two places: it throttles reseals to once per half window (`SLIDE_THRESHOLD = 0.5`), the very optimization the PR says was deliberately not implemented, and it stamps `lastSeenAt` rather than `updatedAt`. It also changes error-response cookie handling for all sessions, including those without `idleTimeout`, and claimed status-code sanitization is absent.",
    },
    {
        t: 5.6,
        real: 75.6,
        text: "",
    },
    {
        t: 5.6,
        real: 75.6,
        text: "\u001b[1mClaims:\u001b[0m",
    },
    {
        t: 5.6,
        real: 75.6,
        text: "  \u001b[32m✔ implemented \u001b[0m Adds an optional `idleTimeout` sliding lifetime alongside `maxAge`; both are optional and `maxAge` keeps its absolute meaning counted from createdAt.",
    },
    {
        t: 5.6,
        real: 75.6,
        text: "\u001b[2m       └ src/utils/session.ts:44-71, src/utils/session.ts:319-338\u001b[0m",
    },
    {
        t: 5.6,
        real: 75.6,
        text: "  \u001b[31m✘ contradicted\u001b[0m With idleTimeout set, H3 reseals the session cookie on each request.",
    },
    {
        t: 5.6,
        real: 75.6,
        text: "\u001b[2m       └ src/utils/session.ts:189-195, src/utils/session.ts:361-396\u001b[0m",
    },
    {
        t: 5.6,
        real: 75.6,
        text: "  \u001b[31m✘ contradicted\u001b[0m The reseal time is stamped into the sealed payload as `updatedAt`.",
    },
    {
        t: 5.6,
        real: 75.6,
        text: "\u001b[2m       └ src/utils/session.ts:19-27, src/utils/session.ts:267-272\u001b[0m",
    },
    {
        t: 5.6,
        real: 75.6,
        text: "  \u001b[32m✔ implemented \u001b[0m Expiry is two independent checks: createdAt vs maxAge, and last-reseal-or-createdAt vs idleTimeout.",
    },
    {
        t: 5.6,
        real: 75.6,
        text: "\u001b[2m       └ src/utils/session.ts:322-338\u001b[0m",
    },
    {
        t: 5.6,
        real: 75.6,
        text: "  \u001b[32m✔ implemented \u001b[0m Cookie Expires is whichever limit runs out first.",
    },
    {
        t: 5.6,
        real: 75.6,
        text: "\u001b[2m       └ src/utils/session.ts:426-437, src/utils/session.ts:244\u001b[0m",
    },
    {
        t: 5.6,
        real: 75.6,
        text: "  \u001b[32m✔ implemented \u001b[0m createdAt keeps its meaning.",
    },
    {
        t: 5.6,
        real: 75.6,
        text: "\u001b[2m       └ src/utils/session.ts:267-272\u001b[0m",
    },
    {
        t: 5.6,
        real: 75.6,
        text: "  \u001b[32m✔ implemented \u001b[0m Expiry never depends on the seal TTL, and this is covered by a regression test.",
    },
    {
        t: 5.6,
        real: 75.6,
        text: "\u001b[2m       └ src/utils/session.ts:319-338, test/session.test.ts:343-372\u001b[0m",
    },
    {
        t: 5.6,
        real: 75.6,
        text: "  \u001b[32m✔ implemented \u001b[0m Only cookie sessions slide; header-carried seals hard-expire.",
    },
    {
        t: 5.6,
        real: 75.6,
        text: "\u001b[2m       └ src/utils/session.ts:193, test/session.test.ts:313-341\u001b[0m",
    },
    {
        t: 5.6,
        real: 75.6,
        text: "  \u001b[32m✔ implemented \u001b[0m No public API change: unsealSession's signature is untouched.",
    },
    {
        t: 5.6,
        real: 75.6,
        text: "\u001b[2m       └ src/utils/session.ts:287-293\u001b[0m",
    },
    {
        t: 5.6,
        real: 75.6,
        text: "  \u001b[32m✔ implemented \u001b[0m No wasted crypto: the reseal is gated on a successful unseal.",
    },
    {
        t: 5.6,
        real: 75.6,
        text: "\u001b[2m       └ src/utils/session.ts:193\u001b[0m",
    },
    {
        t: 5.6,
        real: 75.6,
        text: "  \u001b[33m◐ partial     \u001b[0m Without idleTimeout, behavior and the sealed payload are byte-for-byte unchanged.",
    },
    {
        t: 5.6,
        real: 75.6,
        text: "\u001b[2m       └ src/utils/session.ts:247, src/utils/session.ts:356, src/response.ts:147-159\u001b[0m",
    },
    {
        t: 5.6,
        real: 75.6,
        text: "  \u001b[31m✘ contradicted\u001b[0m The reseal-past-halfway optimization was deliberately NOT implemented; the guarantee is exactly idleTimeout of inactivity.",
    },
    {
        t: 5.6,
        real: 75.6,
        text: "\u001b[2m       └ src/utils/session.ts:361-396, src/utils/session.ts:64-69, docs/4.examples/handle-session.md:170-177, test/session.test.ts:407-499\u001b[0m",
    },
    {
        t: 5.6,
        real: 75.6,
        text: "  \u001b[32m✔ implemented \u001b[0m Docs and JSDoc state idleTimeout is equivalent to `rolling`, and document the crypto cost, Set-Cookie/CDN impact, and the concurrent-write loss risk.",
    },
    {
        t: 5.6,
        real: 75.6,
        text: "\u001b[2m       └ src/utils/session.ts:56-58, docs/4.examples/handle-session.md:151-189\u001b[0m",
    },
    {
        t: 5.6,
        real: 75.6,
        text: "  \u001b[32m✔ implemented \u001b[0m Tests cover sliding with data survival, the exact boundary, the maxAge cap with Expires flipping, header expiry, ttl independence, and unchanged defaults.",
    },
    {
        t: 5.6,
        real: 75.6,
        text: "\u001b[2m       └ test/session.test.ts:180-405\u001b[0m",
    },
    {
        t: 5.6,
        real: 75.6,
        text: "  \u001b[33m○ missing     \u001b[0m Sanitizes invalid response status codes and messages (release notes).",
    },
    {
        t: 5.6,
        real: 75.6,
        text: "\u001b[2m       └ (no evidence cited)\u001b[0m",
    },
    {
        t: 5.6,
        real: 75.6,
        text: "  \u001b[33m◐ partial     \u001b[0m useSession accepts an optional `idleTimeout` (seconds); when set, the session cookie is resealed on every request so an active user's session keeps extending and is not logged out at createdAt + maxAge solely due to elapsed time.",
    },
    {
        t: 5.6,
        real: 75.6,
        text: "\u001b[2m       └ src/utils/session.ts:189-195, src/utils/session.ts:384-391\u001b[0m",
    },
    {
        t: 5.6,
        real: 75.6,
        text: "  \u001b[31m✘ contradicted\u001b[0m On each reseal with idleTimeout set, the sealed payload records the reseal time as `updatedAt`, while `createdAt` keeps its original value.",
    },
    {
        t: 5.6,
        real: 75.6,
        text: "\u001b[2m       └ src/utils/session.ts:267-272\u001b[0m",
    },
    {
        t: 5.6,
        real: 75.6,
        text: "  \u001b[32m✔ implemented \u001b[0m Session expiry is two independent checks: createdAt vs maxAge (absolute) and (updatedAt || createdAt) vs idleTimeout (sliding); failing either causes the session to be reset to a new empty session.",
    },
    {
        t: 5.6,
        real: 75.6,
        text: "\u001b[2m       └ src/utils/session.ts:322-338\u001b[0m",
    },
    {
        t: 5.6,
        real: 75.6,
        text: "  \u001b[32m✔ implemented \u001b[0m The cookie Expires/Max-Age is set to whichever limit (absolute maxAge or sliding idleTimeout) runs out first.",
    },
    {
        t: 5.6,
        real: 75.6,
        text: "\u001b[2m       └ src/utils/session.ts:426-437\u001b[0m",
    },
    {
        t: 5.6,
        real: 75.6,
        text: "  \u001b[33m◐ partial     \u001b[0m Without idleTimeout, behavior and the sealed payload are unchanged: no updatedAt field, no reseal on read-only requests, no Set-Cookie on read-only requests, and maxAge keeps its prior absolute meaning.",
    },
    {
        t: 5.6,
        real: 75.6,
        text: "\u001b[2m       └ src/utils/session.ts:267, src/utils/session.ts:247, test/session.test.ts:374-405\u001b[0m",
    },
    {
        t: 5.6,
        real: 75.6,
        text: "  \u001b[32m✔ implemented \u001b[0m idleTimeout works alone without maxAge (sliding only, no absolute cap), and maxAge works alone as before.",
    },
    {
        t: 5.6,
        real: 75.6,
        text: "\u001b[2m       └ src/utils/session.ts:296, test/session.test.ts:180-221\u001b[0m",
    },
    {
        t: 5.6,
        real: 75.6,
        text: "  \u001b[32m✔ implemented \u001b[0m Session data written in earlier requests survives across automatic reseals.",
    },
    {
        t: 5.6,
        real: 75.6,
        text: "\u001b[2m       └ test/session.test.ts:180-221\u001b[0m",
    },
    {
        t: 5.6,
        real: 75.6,
        text: "  \u001b[32m✔ implemented \u001b[0m A session is still valid just before idleTimeout of inactivity (e.g. 59s for 60s) and is reset just after (e.g. 61s), with no clock-skew slack.",
    },
    {
        t: 5.6,
        real: 75.6,
        text: "\u001b[2m       └ test/session.test.ts:223-252\u001b[0m",
    },
    {
        t: 5.6,
        real: 75.6,
        text: "  \u001b[32m✔ implemented \u001b[0m With both set, a continuously active session is still reset once maxAge from createdAt passes (e.g. reset at 121s despite only 31s idle), and cookie Expires flips from the idle limit to the absolute limit as the cap approaches.",
    },
    {
        t: 5.6,
        real: 75.6,
        text: "\u001b[2m       └ test/session.test.ts:254-311\u001b[0m",
    },
    {
        t: 5.6,
        real: 75.6,
        text: "  \u001b[32m✔ implemented \u001b[0m Sessions supplied via the `x-{name}-session` header are not resealed; their updatedAt stays at issuance so they hard-expire after idleTimeout regardless of activity.",
    },
    {
        t: 5.6,
        real: 75.6,
        text: "\u001b[2m       └ src/utils/session.ts:193, test/session.test.ts:313-341\u001b[0m",
    },
    {
        t: 5.6,
        real: 75.6,
        text: "  \u001b[32m✔ implemented \u001b[0m Expiry enforcement does not depend on the seal TTL; a custom `config.seal` with a long or different ttl does not extend or shorten idleTimeout/maxAge enforcement.",
    },
    {
        t: 5.6,
        real: 75.6,
        text: "\u001b[2m       └ src/utils/session.ts:319-338, test/session.test.ts:343-372\u001b[0m",
    },
    {
        t: 5.6,
        real: 75.6,
        text: "  \u001b[32m✔ implemented \u001b[0m A stale, expired, or tampered cookie does not trigger an extra reseal of an empty session; reseal happens only after a successful unseal.",
    },
    {
        t: 5.6,
        real: 75.6,
        text: "\u001b[2m       └ src/utils/session.ts:189-195\u001b[0m",
    },
    {
        t: 5.6,
        real: 75.6,
        text: "  \u001b[32m✔ implemented \u001b[0m Legacy sessions sealed without updatedAt are accepted and fall back to createdAt for the idle check.",
    },
    {
        t: 5.6,
        real: 75.6,
        text: "\u001b[2m       └ src/utils/session.ts:332-334\u001b[0m",
    },
    {
        t: 5.6,
        real: 75.6,
        text: "  \u001b[32m✔ implemented \u001b[0m The refreshed session Set-Cookie header is still emitted when the handler returns or throws an error response, without duplicate Set-Cookie or error headers.",
    },
    {
        t: 5.6,
        real: 75.6,
        text: "\u001b[2m       └ src/utils/session.ts:398-424, src/response.ts:147-159, test/session.test.ts:557-649\u001b[0m",
    },
    {
        t: 5.6,
        real: 75.6,
        text: "  \u001b[32m✔ implemented \u001b[0m Chunked/large session cookies are refreshed correctly on reseal without leaving stale or duplicated cookie chunks.",
    },
    {
        t: 5.6,
        real: 75.6,
        text: "\u001b[2m       └ src/utils/session.ts:411-413, test/session.test.ts:651-686\u001b[0m",
    },
    {
        t: 5.6,
        real: 75.6,
        text: "  \u001b[33m○ missing     \u001b[0m Invalid response status codes and status messages are sanitized rather than causing response errors.",
    },
    {
        t: 5.6,
        real: 75.6,
        text: "\u001b[2m       └ (no evidence cited)\u001b[0m",
    },
    {
        t: 5.6,
        real: 75.6,
        text: "  \u001b[32m✔ implemented \u001b[0m unsealSession's public signature is unchanged.",
    },
    {
        t: 5.6,
        real: 75.6,
        text: "\u001b[2m       └ src/utils/session.ts:287-293\u001b[0m",
    },
    {
        t: 5.6,
        real: 75.6,
        text: "  \u001b[33m◐ partial     \u001b[0m The idleTimeout JSDoc and docs/handle-session.md describe idleTimeout vs maxAge, state it is equivalent to `rolling` in other libraries, and document trade-offs: extra crypto per request, Set-Cookie on every response hurting CDN caching, and potential lost writes from concurrent read/write requests.",
    },
    {
        t: 5.6,
        real: 75.6,
        text: "\u001b[2m       └ src/utils/session.ts:53-70, docs/4.examples/handle-session.md:151-189\u001b[0m",
    },
    {
        t: 5.6,
        real: 75.6,
        text: "  \u001b[32m✔ implemented \u001b[0m Tests cover sliding with data survival, exact idleTimeout boundary, maxAge capping with Expires switching, header-session hard expiry, seal-ttl independence, and unchanged default behavior without idleTimeout.",
    },
    {
        t: 5.6,
        real: 75.6,
        text: "\u001b[2m       └ test/session.test.ts:180-405\u001b[0m",
    },
    {
        t: 5.6,
        real: 75.6,
        text: "",
    },
    {
        t: 5.6,
        real: 75.6,
        text: "\u001b[1mUnstated changes:\u001b[0m",
    },
    {
        t: 5.6,
        real: 75.6,
        text: "  \u001b[31mhigh risk  \u001b[0m \u001b[1msrc/utils/session.ts\u001b[0m — Adds `shouldSlide` with `SLIDE_THRESHOLD = 0.5`, throttling reseals to once per half window. This weakens the inactivity guarantee to idleTimeout/2–idleTimeout, despite the description explicitly rejecting this design.",
    },
    {
        t: 5.6,
        real: 75.6,
        text: "  \u001b[33mmedium risk\u001b[0m \u001b[1msrc/utils/session.ts\u001b[0m — `stageSessionErrCookies` runs on every updateSession/clearSession regardless of idleTimeout, so error responses now carry session Set-Cookie headers for all sessions. This contradicts 'purely additive / unchanged without idleTimeout'.",
    },
    {
        t: 5.6,
        real: 75.6,
        text: "  \u001b[33mmedium risk\u001b[0m \u001b[1msrc/response.ts\u001b[0m — The global error path now clears `event[kEventRes]` before `errorResponse` to avoid duplicate errHeaders. This changes core response handling for all apps.",
    },
    {
        t: 5.6,
        real: 75.6,
        text: "  \u001b[2mlow risk   \u001b[0m \u001b[1msrc/utils/session.ts\u001b[0m — The default seal ttl becomes `(maxAge || idleTimeout || 0) * 1000`, so iron-level ttl now also applies when only idleTimeout is set.",
    },
    {
        t: 5.6,
        real: 75.6,
        text: "  \u001b[2mlow risk   \u001b[0m \u001b[1mtest/session.test.ts\u001b[0m — Adds tests for throttling, the half-window floor, error-response cookies, the clear-on-error case, and chunked cookies on errors. None of these are described in the PR's test section.",
    },
    {
        t: 5.6,
        real: 75.6,
        text: "",
    },
    {
        t: 5.6,
        real: 75.6,
        text: "\u001b[32mSignal 80/100 (high)\u001b[0m",
    },
];
