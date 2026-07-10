/** A pull request identified by its repository and number. */
export interface Target {
    owner: string;
    repo: string;
    number: number;
}

// github.com/<owner>/<repo>/pull/<n>, with optional scheme and trailing path.
const URL_RE = /(?:^|\/\/)(?:www\.)?github\.com\/([^/]+)\/([^/]+)\/pull\/(\d+)/i;
// <owner>/<repo>#<n> shorthand.
const SHORT_RE = /^([^/\s]+)\/([^/#\s]+)#(\d+)$/;

/** Parse a PR reference (URL or `owner/repo#number`) into a Target. */
export function parseTarget(input: string): Target {
    const ref = input.trim();

    const url = URL_RE.exec(ref);
    if (url) {
        return { owner: url[1]!, repo: url[2]!, number: Number(url[3]) };
    }

    const short = SHORT_RE.exec(ref);
    if (short) {
        return { owner: short[1]!, repo: short[2]!, number: Number(short[3]) };
    }

    throw new Error(
        `Could not parse PR reference "${input}". ` +
            `Use a URL (https://github.com/owner/repo/pull/123) or owner/repo#123.`,
    );
}
