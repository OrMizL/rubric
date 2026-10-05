// Records the demo clips and the social card from the site's `?clip=` views.
//
//   pnpm --filter @rubric/web build && pnpm --filter @rubric/web preview &
//   node apps/web/scripts/record-clips.mjs docs/media [card|redline|terminal|github ...]
//
// Frames come from Chrome's screencast with their real timestamps, so the video keeps the page's
// own timing instead of whatever rate a screenshot loop manages. Needs ffmpeg on PATH and a
// Playwright Chromium (`npx playwright install chromium`).
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium } from "playwright-core";

const BASE = process.env.CLIP_BASE ?? "http://localhost:4173/";
const OUT = process.argv[2] ?? "clips";
const VIEWPORT = { width: 1280, height: 720 };

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function ffmpeg(args) {
    const r = spawnSync("ffmpeg", ["-loglevel", "error", "-y", ...args], { stdio: "inherit" });
    if (r.status !== 0) throw new Error(`ffmpeg failed: ${args.join(" ")}`);
}

async function open(browser, mode, viewport = VIEWPORT) {
    const page = await browser.newPage({ viewport, deviceScaleFactor: 2 });
    await page.goto(`${BASE}?clip=${mode}&hold`, { waitUntil: "networkidle" });
    await page.evaluate(() => document.fonts.ready);
    await sleep(300);
    return page;
}

/** Captures `page` while `act` runs, then encodes `name`.mp4 and `name`.gif. */
async function record(page, name, act) {
    const cdp = await page.context().newCDPSession(page);
    const frames = [];
    cdp.on("Page.screencastFrame", async (f) => {
        frames.push({ data: f.data, t: f.metadata.timestamp });
        await cdp.send("Page.screencastFrameAck", { sessionId: f.sessionId }).catch(() => {});
    });
    await cdp.send("Page.startScreencast", {
        format: "png",
        maxWidth: VIEWPORT.width * 2,
        maxHeight: VIEWPORT.height * 2,
        everyNthFrame: 1,
    });
    await sleep(600); // a still lead-in before anything moves
    await act();
    await cdp.send("Page.stopScreencast");
    await page.close();

    // The screencast only emits a frame when the page changes, so each frame lasts until the next.
    const dir = mkdtempSync(join(tmpdir(), `clip-${name}-`));
    const list = [];
    frames.forEach((f, i) => {
        const file = join(dir, `${String(i).padStart(5, "0")}.png`);
        writeFileSync(file, Buffer.from(f.data, "base64"));
        const next = frames[i + 1];
        const duration = next ? next.t - f.t : 2.0; // hold the final frame
        list.push(`file '${file}'`, `duration ${duration.toFixed(4)}`);
    });
    list.push(`file '${join(dir, `${String(frames.length - 1).padStart(5, "0")}.png`)}'`);
    writeFileSync(join(dir, "list.txt"), list.join("\n"));

    const mp4 = join(OUT, `${name}.mp4`);
    ffmpeg([
        ...["-f", "concat", "-safe", "0", "-i", join(dir, "list.txt")],
        ...["-vf", "fps=30,scale=1920:-2:flags=lanczos", "-c:v", "libx264", "-crf", "18"],
        ...["-pix_fmt", "yuv420p", "-movflags", "+faststart", mp4],
    ]);
    ffmpeg([
        ...["-i", mp4, "-vf"],
        // Rectangle diffing re-encodes only the changed region per frame, which keeps a mostly static
        // terminal small enough for a README.
        "fps=12,scale=900:-1:flags=lanczos,split[a][b];[a]palettegen=stats_mode=diff[p];[b][p]paletteuse=dither=bayer:bayer_scale=4:diff_mode=rectangle",
        join(OUT, `${name}.gif`),
    ]);
    rmSync(dir, { recursive: true, force: true });
    console.log(`${name}: ${frames.length} frames -> ${mp4} + .gif`);
}

async function clip(browser, name, seconds) {
    const page = await open(browser, name);
    await record(page, name, async () => {
        await page.evaluate(() => window.startClip());
        await sleep(seconds * 1000);
    });
}

/** Eased scroll inside the page, so the motion is the page's own and not a jump per frame. */
async function scrollTo(page, y, ms) {
    await page.evaluate(
        ([to, dur]) =>
            new Promise((done) => {
                const from = window.scrollY;
                const t0 = performance.now();
                const step = () => {
                    const p = Math.min(1, (performance.now() - t0) / dur);
                    const e = p < 0.5 ? 2 * p * p : 1 - (-2 * p + 2) ** 2 / 2;
                    window.scrollTo(0, from + (to - from) * e);
                    if (p < 1) requestAnimationFrame(step);
                    else done();
                };
                requestAnimationFrame(step);
            }),
        [y, ms],
    );
}

/**
 * The Action's PR comment on this repo's trap PR (#2: a code change described as docs-only),
 * recorded from the public, logged-out page: the description first, then Rubric's verdict.
 */
async function github(browser) {
    const page = await browser.newPage({ viewport: VIEWPORT, deviceScaleFactor: 2 });
    // github.com never goes network-idle reliably; wait for the comment itself.
    await page.goto("https://github.com/OrMizL/rubric/pull/2", { waitUntil: "load" });
    const comment = page.locator(".timeline-comment", { hasText: "Misaligned" }).first();
    await comment.waitFor();
    await sleep(1000);
    const top = await comment.evaluate((el) => el.getBoundingClientRect().top + window.scrollY);
    const description = await page
        .locator(".timeline-comment")
        .first()
        .evaluate((el) => el.getBoundingClientRect().top + window.scrollY);
    await page.evaluate((y) => window.scrollTo(0, y), description - 90);
    await sleep(500);
    await record(page, "github", async () => {
        await sleep(2200);
        await scrollTo(page, top - 70, 1600);
        await sleep(2400);
        await scrollTo(page, top + 240, 1800);
        await sleep(2200);
    });
}

async function card(browser) {
    // GitHub's social preview size; the same image heads the README.
    const page = await open(browser, "card", { width: 1280, height: 640 });
    await page.evaluate(() => window.startClip());
    await sleep(2500);
    await page.screenshot({ path: join(OUT, "card.png"), scale: "css" });
    await page.close();
    console.log(`card: ${join(OUT, "card.png")}`);
}

const only = new Set(process.argv.slice(3));
const want = (name) => only.size === 0 || only.has(name);

mkdirSync(OUT, { recursive: true });
const browser = await chromium.launch();
try {
    if (want("card")) await card(browser);
    if (want("redline")) await clip(browser, "redline", 3.2);
    if (want("terminal")) await clip(browser, "terminal", 14);
    if (want("github")) await github(browser);
} finally {
    await browser.close();
}
