import React from "react";
import ReactDOM from "react-dom/client";

// Fonts — bundled offline via @fontsource, no CDN.
import "@fontsource-variable/archivo/wdth.css"; // display + body (wght 100–900, wdth 62–125%)
import "@fontsource/ibm-plex-mono/400.css";
import "@fontsource/ibm-plex-mono/500.css";

import App from "./App";
import { Clip, clipModeFromUrl } from "./Clip";
import "./styles.css";

const rootElement = document.getElementById("root");
if (!rootElement) {
    throw new Error("Root element #root not found");
}

const clipMode = clipModeFromUrl();

ReactDOM.createRoot(rootElement).render(
    <React.StrictMode>{clipMode ? <Clip mode={clipMode} /> : <App />}</React.StrictMode>,
);
