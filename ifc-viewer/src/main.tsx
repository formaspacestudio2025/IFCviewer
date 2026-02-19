import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { ErrorBoundary } from "./ErrorBoundary";

import "@thatopen/ui-obc"; // ✅ runtime registration only

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <ErrorBoundary fallback={<p>Failed to load IFC viewer</p>}>
      <App />
    </ErrorBoundary>
  </React.StrictMode>
);