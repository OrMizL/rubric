import { useEffect, useMemo, useRef, useState } from "react";

import { CAST, CAST_COMMAND, CAST_TOTAL_SECONDS } from "./cast";

interface Segment {
    text: string;
    className: string;
}

/** Only the SGR codes the CLI emits: reset, bold, dim, red, green, yellow. */
const SGR_CLASS: Record<string, string> = {
    "1": "t-bold",
    "2": "t-dim",
    "31": "t-red",
    "32": "t-green",
    "33": "t-yellow",
};

function parseAnsi(line: string): Segment[] {
    const segments: Segment[] = [];
    const active = new Set<string>();
    const re = /\x1b\[([\d;]*)m/g;
    let last = 0;
    for (let m = re.exec(line); m; m = re.exec(line)) {
        if (m.index > last) {
            segments.push({ text: line.slice(last, m.index), className: [...active].join(" ") });
        }
        for (const code of (m[1] || "0").split(";")) {
            if (code === "0") active.clear();
            else if (SGR_CLASS[code]) active.add(SGR_CLASS[code]);
        }
        last = re.lastIndex;
    }
    if (last < line.length) {
        segments.push({ text: line.slice(last), className: [...active].join(" ") });
    }
    return segments;
}

const TYPE_MS = 38;
const SPINNER = "⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏";
/** After the output lands, scroll to the claim that matters, then to the unstated changes. */
const SCROLL_MARKS = ["deliberately NOT implemented", "Unstated changes:"];

/**
 * Eased scroll on requestAnimationFrame rather than `behavior: "smooth"`, so the clip recorder sees
 * the same motion frame by frame that a visitor does.
 */
function scrollBody(body: HTMLElement, top: number, ms = 1100): void {
    const from = body.scrollTop;
    const t0 = performance.now();
    const step = () => {
        const p = Math.min(1, (performance.now() - t0) / ms);
        const eased = p < 0.5 ? 2 * p * p : 1 - (-2 * p + 2) ** 2 / 2;
        body.scrollTop = from + (top - from) * eased;
        if (p < 1) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
}

function prefersReducedMotion(): boolean {
    return window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
}

/**
 * Replays a recorded CLI run as live text: crisp at any size, selectable, and small. Starts when
 * scrolled into view, or when `start` turns true if it is given (the clip recorder drives that).
 */
export function TerminalReplay({ start }: { start?: boolean }) {
    const autoplay = start !== undefined;
    const lines = useMemo(() => CAST.map((l) => ({ ...l, segments: parseAnsi(l.text) })), []);
    const outputStart = (CAST_COMMAND.length * TYPE_MS) / 1000 + 0.4;
    const end = outputStart + CAST[CAST.length - 1]!.t;

    const rootRef = useRef<HTMLDivElement>(null);
    const bodyRef = useRef<HTMLDivElement>(null);
    const [run, setRun] = useState(0);
    const [started, setStarted] = useState(false);
    const [elapsed, setElapsed] = useState(0);
    const [finished, setFinished] = useState(false);

    useEffect(() => {
        if (prefersReducedMotion()) {
            setStarted(true);
            setElapsed(Infinity);
            setFinished(true);
            return;
        }
        if (autoplay) {
            if (start) setStarted(true);
            return;
        }
        const root = rootRef.current;
        if (!root) return;
        const observer = new IntersectionObserver(
            (entries) => {
                if (entries.some((e) => e.isIntersecting)) {
                    setStarted(true);
                    observer.disconnect();
                }
            },
            { threshold: 0.45 },
        );
        observer.observe(root);
        return () => observer.disconnect();
    }, [autoplay, start]);

    useEffect(() => {
        if (!started || finished) return;
        const t0 = performance.now();
        let frame = 0;
        const tick = () => {
            const s = (performance.now() - t0) / 1000;
            setElapsed(s);
            if (s < end) frame = requestAnimationFrame(tick);
        };
        frame = requestAnimationFrame(tick);
        return () => cancelAnimationFrame(frame);
        // `run` restarts the clock on replay.
    }, [started, run, end, finished]);

    const outputDone = elapsed >= end;

    useEffect(() => {
        const body = bodyRef.current;
        if (!body || !outputDone || finished) return;
        const targets = SCROLL_MARKS.map((mark) =>
            [...body.querySelectorAll<HTMLElement>("[data-line]")].find((el) =>
                el.textContent?.includes(mark),
            ),
        );
        const timers = targets.map((el, i) =>
            window.setTimeout(
                () => {
                    if (el) scrollBody(body, el.offsetTop - 24);
                },
                900 + i * 2600,
            ),
        );
        timers.push(window.setTimeout(() => setFinished(true), 900 + targets.length * 2600));
        return () => timers.forEach((t) => window.clearTimeout(t));
    }, [outputDone, finished]);

    const typed = CAST_COMMAND.slice(0, Math.floor((elapsed * 1000) / TYPE_MS));
    const visible = lines.filter((l) => outputStart + l.t <= elapsed);
    const waiting = started && typed.length === CAST_COMMAND.length && !outputDone;
    const realSeconds = outputDone ? CAST_TOTAL_SECONDS : (visible.at(-1)?.real ?? 0);
    const spin = SPINNER[Math.floor(elapsed * 12) % SPINNER.length];

    const replay = () => {
        bodyRef.current?.scrollTo({ top: 0 });
        setElapsed(0);
        setFinished(false);
        setRun((r) => r + 1);
    };

    return (
        <div ref={rootRef} className="term" role="region" aria-label={`Terminal: ${CAST_COMMAND}`}>
            <div className="term__bar">
                <span className="term__title">~ zsh</span>
                <span className="term__clock" aria-hidden="true">
                    {outputDone
                        ? `${Math.round(CAST_TOTAL_SECONDS)} s`
                        : `${Math.round(realSeconds)} s`}{" "}
                    real
                </span>
            </div>
            <div ref={bodyRef} className="term__body">
                <div className="term__line">
                    <span className="t-dim">$ </span>
                    {started ? typed : ""}
                    {!outputDone && typed.length < CAST_COMMAND.length && (
                        <span className="term__caret" />
                    )}
                </div>
                {visible.map((line, i) => (
                    <div className="term__line" data-line key={i}>
                        {line.segments.length === 0
                            ? " "
                            : line.segments.map((seg, j) => (
                                  <span key={j} className={seg.className || undefined}>
                                      {seg.text}
                                  </span>
                              ))}
                    </div>
                ))}
                {waiting && <div className="term__line t-dim">{spin}</div>}
            </div>
            {finished && !autoplay && (
                <button type="button" className="term__replay" onClick={replay}>
                    Replay
                </button>
            )}
        </div>
    );
}
