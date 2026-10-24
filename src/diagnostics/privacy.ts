import { invoke } from "@tauri-apps/api/core";

export const PRIVACY_SETTINGS_KEY = "protoflow.privacy.v1";
export const MAX_DIAGNOSTIC_LOG_LINES = 20;
export const DIAGNOSTIC_LOG_MAX_BYTES = 512 * 1024;

export interface PrivacySettings {
  crashReports: boolean;
  anonymousTelemetry: boolean;
}

const diagnosticLines: string[] = [];

const sensitivePatterns = [
  /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi,
  /\b[A-F0-9]{8}(?:-[A-F0-9]{4}){3}-[A-F0-9]{12}\b/gi,
  /(?:[A-Z]:\\|\\\\|\/(?:Users|home|private|tmp|var)\/)[^\s"'<>)]*/gi,
  /\b(?:gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,})\b/g,
];

export function sanitizeDiagnosticText(
  input: string,
  sensitiveValues: readonly string[] = [],
): string {
  let result = input;
  for (const value of sensitiveValues) {
    if (!value) continue;
    result = result.replaceAll(value, "[redacted]");
  }
  for (const pattern of sensitivePatterns) {
    result = result.replace(pattern, "[redacted]");
  }
  return result.replace(/[\r\n\t]+/g, " ").slice(0, 2_000);
}

export function readPrivacySettings(): PrivacySettings | null {
  const stored = localStorage.getItem(PRIVACY_SETTINGS_KEY);
  if (stored === null) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(stored);
  } catch (error) {
    throw new Error("Saved privacy settings are invalid JSON.", { cause: error });
  }
  if (
    typeof parsed !== "object" ||
    parsed === null ||
    !("crashReports" in parsed) ||
    typeof parsed.crashReports !== "boolean" ||
    !("anonymousTelemetry" in parsed) ||
    typeof parsed.anonymousTelemetry !== "boolean"
  ) {
    throw new Error("Saved privacy settings have an unsupported format.");
  }
  return {
    crashReports: parsed.crashReports,
    anonymousTelemetry: parsed.anonymousTelemetry,
  };
}

export function writePrivacySettings(settings: PrivacySettings): void {
  localStorage.setItem(PRIVACY_SETTINGS_KEY, JSON.stringify(settings));
}

export function appendDiagnosticLine(
  level: "info" | "warning" | "error",
  message: string,
): string {
  const line = `${new Date().toISOString()} ${level.toUpperCase()} ${sanitizeDiagnosticText(message)}`;
  diagnosticLines.push(line);
  if (diagnosticLines.length > MAX_DIAGNOSTIC_LOG_LINES) {
    diagnosticLines.splice(0, diagnosticLines.length - MAX_DIAGNOSTIC_LOG_LINES);
  }
  return line;
}

export function getRecentDiagnosticLines(): string[] {
  return [...diagnosticLines];
}

export function clearRecentDiagnosticLines(): void {
  diagnosticLines.length = 0;
}

export async function exportDiagnosticLog(): Promise<void> {
  const lines = getRecentDiagnosticLines();
  const serialized = lines.join("\n");
  if (isTauriRuntime()) {
    await invoke("export_diagnostic_logs", { recentLines: lines });
    return;
  }
  const link = document.createElement("a");
  link.href = URL.createObjectURL(new Blob([serialized], { type: "text/plain;charset=utf-8" }));
  link.download = `protoflow-diagnostics-${new Date().toISOString().slice(0, 10)}.log`;
  link.click();
  URL.revokeObjectURL(link.href);
}

function isTauriRuntime(): boolean {
  return "__TAURI_INTERNALS__" in window;
}
