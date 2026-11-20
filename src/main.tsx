import React from "react";
import ReactDOM from "react-dom/client";
import "@fontsource-variable/inter";
import App from "./App";
import { startAutosave } from "./project/autosave";
import { startSessionTracking } from "./project/sessionExit";
import { AppErrorBoundary } from "./diagnostics/AppErrorBoundary";
import "./theme-light.css";
import "./styles.css";

async function startApplication() {
  if (import.meta.env.VITE_WDIO === "true") {
    await import("@wdio/tauri-plugin");
  }
  startSessionTracking();
  startAutosave();

  ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
    <React.StrictMode>
      <AppErrorBoundary>
        <App />
      </AppErrorBoundary>
    </React.StrictMode>,
  );
}

void startApplication();
