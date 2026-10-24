import { Component, type ErrorInfo, type ReactNode } from "react";
import { CircleAlert, RotateCcw } from "lucide-react";
import { recordDiagnostic, reportException, trackEvent } from "./observability";

interface AppErrorBoundaryProps {
  children: ReactNode;
}

interface AppErrorBoundaryState {
  error: Error | null;
}

export class AppErrorBoundary extends Component<
  AppErrorBoundaryProps,
  AppErrorBoundaryState
> {
  state: AppErrorBoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): AppErrorBoundaryState {
    return { error };
  }

  componentDidCatch(error: Error, _info: ErrorInfo): void {
    recordDiagnostic("error", "The application UI encountered an unrecoverable error.");
    trackEvent("error_shown", { category: "application" });
    void reportException(error).catch(() => {
      recordDiagnostic("warning", "Crash reporting could not process the UI error.");
    });
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <main className="app-error-fallback" role="alert">
        <CircleAlert size={22} />
        <h1>ProtoFlow hit a problem</h1>
        <p>Your project is still stored locally. Restart the app to continue.</p>
        <button className="button button-primary" onClick={() => window.location.reload()}>
          <RotateCcw size={14} /> Restart ProtoFlow
        </button>
      </main>
    );
  }
}
