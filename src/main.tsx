import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { startAutosave } from "./project/autosave";
import { AppErrorBoundary } from "./diagnostics/AppErrorBoundary";
import "./styles.css";

startAutosave();

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <AppErrorBoundary>
      <App />
    </AppErrorBoundary>
  </React.StrictMode>,
);
