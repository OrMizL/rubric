import { useEffect, useLayoutEffect, useRef, useState } from "react";

const PR_URL = "https://github.com/unjs/h3/pull/1513";
const CODE_URL = `${PR_URL}/files`;

interface Wire {
    d: string;
    start: { x: number; y: number };
    end: { x: number; y: number };
    label: { x: number; y: number } | null;
    width: number;
    height: number;
}

/**
 * The hero: the real sentence from unjs/h3#1513's description, the merged code that contradicts
 * it, and a wire between them. The wire is measured from the live layout rather than drawn as a
 * fixed graphic, so it always lands on the exact struck phrase and the exact code line, at any
 * width. Side by side it bridges the gutter; stacked it runs down the left margin.
 */
export function Redline({ play = true }: { play?: boolean }) {
    const stageRef = useRef<HTMLDivElement>(null);
    const strikeRef = useRef<HTMLSpanElement>(null);
    const descRef = useRef<HTMLElement>(null);
    const codeRef = useRef<HTMLElement>(null);
    const targetRef = useRef<HTMLSpanElement>(null);
    const [wire, setWire] = useState<Wire | null>(null);
    const [drawn, setDrawn] = useState(false);

    useLayoutEffect(() => {
        const stage = stageRef.current;
        if (!stage) return;
        const measure = () => {
            const s = stage.getBoundingClientRect();
            const strike = strikeRef.current!.getBoundingClientRect();
            const desc = descRef.current!.getBoundingClientRect();
            const code = codeRef.current!.getBoundingClientRect();
            const target = targetRef.current!.getBoundingClientRect();
            const sy = strike.top + strike.height * 0.55 - s.top;
            const ty = target.top + target.height / 2 - s.top;
            const sideBySide = code.left > desc.right;
            let d: string;
            let start: Wire["start"];
            let end: Wire["end"];
            let label: Wire["label"] = null;
            if (sideBySide) {
                const x0 = desc.right - s.left;
                const x1 = code.left - s.left;
                const mid = (x0 + x1) / 2;
                start = { x: x0, y: sy };
                end = { x: x1, y: ty };
                d = `M${x0} ${sy} H${mid} V${ty} H${x1}`;
                // Set on the vertical run like a dimension label on a drawing, breaking the line.
                label = { x: mid, y: (sy + ty) / 2 };
            } else {
                const gx = desc.left - s.left - 12;
                const x0 = desc.left - s.left;
                const x1 = code.left - s.left;
                start = { x: x0, y: sy };
                end = { x: x1, y: ty };
                d = `M${x0} ${sy} H${gx} V${ty} H${x1}`;
            }
            setWire({ d, start, end, label, width: s.width, height: s.height });
        };
        measure();
        const observer = new ResizeObserver(measure);
        observer.observe(stage);
        // Fonts change line breaks after first paint; the wire must follow them.
        document.fonts?.ready.then(measure);
        return () => observer.disconnect();
    }, []);

    useEffect(() => {
        if (!play) return;
        const timer = window.setTimeout(() => setDrawn(true), 250);
        return () => window.clearTimeout(timer);
    }, [play]);

    return (
        <div ref={stageRef} className={drawn ? "redline redline--drawn" : "redline"}>
            <figure ref={descRef} className="doc doc--desc">
                <figcaption className="doc__tag">
                    The description,{" "}
                    <a href={PR_URL} target="_blank" rel="noreferrer">
                        unjs/h3#1513
                    </a>
                </figcaption>
                <blockquote className="doc__prose">
                    The reseal-only-past-halfway optimization was{" "}
                    <span ref={strikeRef} className="strike">
                        <strong>deliberately not</strong> implemented
                    </span>
                    : it changes the guarantee from &ldquo;exactly <code>idleTimeout</code> of
                    inactivity&rdquo; to &ldquo;somewhere between <code>idleTimeout/2</code> and{" "}
                    <code>idleTimeout</code>&rdquo;&hellip;
                </blockquote>
            </figure>

            <figure ref={codeRef} className="doc doc--code">
                <figcaption className="doc__tag">
                    The merged code,{" "}
                    <a href={CODE_URL} target="_blank" rel="noreferrer">
                        src/utils/session.ts
                    </a>
                </figcaption>
                <pre className="doc__code">
                    <span className="ln ln--add">
                        +const SLIDE_THRESHOLD = <span className="hit">0.5</span>;
                    </span>
                    <span className="ln ln--gap">…</span>
                    <span className="ln ln--add">
                        + * So reseal only once the window is more than half used.
                    </span>
                    <span className="ln ln--gap">…</span>
                    <span className="ln ln--add">
                        + * the last request by up to half the window, so an idle session is signed
                        out
                    </span>
                    <span className="ln ln--add">
                        + *{" "}
                        <span ref={targetRef} className="hit">
                            somewhere between `idleTimeout / 2` and `idleTimeout`
                        </span>{" "}
                        after the last request,
                    </span>
                    <span className="ln ln--add">+ * never later.</span>
                    <span className="ln ln--add">
                        +function shouldSlide(session: Session&lt;any&gt;, config: SessionConfig):
                        boolean {"{"}
                    </span>
                </pre>
            </figure>

            {wire && (
                <svg
                    className="wire"
                    width={wire.width}
                    height={wire.height}
                    viewBox={`0 0 ${wire.width} ${wire.height}`}
                    aria-hidden="true"
                >
                    <path className="wire__path" d={wire.d} pathLength={1} />
                    <circle className="wire__dot" cx={wire.start.x} cy={wire.start.y} r={4.5} />
                    <circle
                        className="wire__dot wire__dot--end"
                        cx={wire.end.x}
                        cy={wire.end.y}
                        r={4.5}
                    />
                </svg>
            )}
            {wire?.label && (
                <span className="wire__label" style={{ left: wire.label.x, top: wire.label.y }}>
                    contradicted
                </span>
            )}
        </div>
    );
}
