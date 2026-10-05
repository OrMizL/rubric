import { useEffect, useState } from "react";

import { Redline } from "./Redline";
import { TerminalReplay } from "./TerminalReplay";

export type ClipMode = "redline" | "terminal" | "card";

export function clipModeFromUrl(): ClipMode | null {
    const mode = new URLSearchParams(window.location.search).get("clip");
    return mode === "redline" || mode === "terminal" || mode === "card" ? mode : null;
}

/**
 * Framed single-purpose views that scripts/record-clips.mjs records into the demo videos, GIFs
 * and the social preview image. Not linked from the site; `?clip=<mode>` opens one. With `&hold`,
 * the animation waits for `window.startClip()`, so the recorder can begin capturing first.
 */
export function Clip({ mode }: { mode: ClipMode }) {
    const [play, setPlay] = useState(
        () => !new URLSearchParams(window.location.search).has("hold"),
    );
    useEffect(() => {
        (window as unknown as { startClip: () => void }).startClip = () => setPlay(true);
    }, []);

    return (
        <div className={`clip clip--${mode}`}>
            {mode === "terminal" ? (
                <TerminalReplay start={play} />
            ) : (
                <>
                    <h1 className="clip__title">Redline the pull request, not the code style.</h1>
                    <Redline play={play} />
                </>
            )}
            <footer className="clip__foot">
                <span className="wordmark">RUBRIC</span>
                <span>rubric.ormiz.dev</span>
            </footer>
        </div>
    );
}
