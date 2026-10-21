import { Suspense } from "react";
import AppShell from "./AppShell";
import "./App.css";
import { MeteredActionProvider } from "./wallet/meteredActions";
import { PreviewWindow } from "./preview/PreviewWindow";

export default function App() {
  if (new URLSearchParams(window.location.search).has("preview")) {
    return (
      <Suspense fallback={<main className="preview-loading">Loading preview…</main>}>
        <PreviewWindow />
      </Suspense>
    );
  }
  return (
    <MeteredActionProvider>
      <AppShell />
    </MeteredActionProvider>
  );
}
