// index.tsx
import "polyfills";                // Cockpit polyfills
import "cockpit-dark-theme";       // Cockpit 다크 테마
import React from "react";
import { createRoot } from "react-dom/client";

import App from "./app";
import cockpit from "cockpit";

// Cockpit 초기화
function init() {
  cockpit.translate();             // Cockpit 번역 초기화

  const container = document.getElementById("status");
  if (!container) {
    console.error("Cockpit status container not found");
    return;
  }

  const root = createRoot(container);
  root.render(<App />);
}

// DOM 준비되면 React 초기화
document.addEventListener("DOMContentLoaded", init);
