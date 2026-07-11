import React from "react";
import ReactDOM from "react-dom/client";

// Fonts — bundled offline via @fontsource, no CDN.
import "@fontsource-variable/fraunces"; // display serif (upright, wght + opsz axes)
import "@fontsource-variable/fraunces/standard-italic.css"; // display serif (italic)
import "@fontsource/ibm-plex-sans/400.css";
import "@fontsource/ibm-plex-sans/500.css";
import "@fontsource/ibm-plex-sans/600.css";
import "@fontsource/ibm-plex-sans/700.css";
import "@fontsource/ibm-plex-mono/400.css";
import "@fontsource/ibm-plex-mono/500.css";
import "@fontsource/ibm-plex-mono/600.css";

import App from "./App";
import "./styles.css";

const rootElement = document.getElementById("root");
if (!rootElement) {
    throw new Error("Root element #root not found");
}

ReactDOM.createRoot(rootElement).render(
    <React.StrictMode>
        <App />
    </React.StrictMode>,
);
