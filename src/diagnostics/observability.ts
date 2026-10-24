import { invoke, isTauri } from "@tauri-apps/api/core";
import {
  appendDiagnosticLine,
  getRecentDiagnosticLines,
  readPrivacySettings,
  sanitizeDiagnosticText,
  type PrivacySettings,
} from "./privacy";
import { useStore } from "../store";

export type TelemetryEvent =
  | "app_launched"
  | "project_created"
  | "first_widget_added"
  | "first_rule_created"
  | "dynamic_panel_created"
  | "repeater_created"
  | "expression_used"
  | "flow_diagram_opened"
  | "annotation_added"
  | "rich_text_used"
  | "version_history_restored"
  | "metered_action_used"
  | "export_used"
  | "update_result"
  | "crash";

export type TelemetryProperties =
  | { actionType: "ai_interaction_generator" | "collaboration_session" | "cloud_preview_publish" | "react_tailwind_code_export" }
  | { exportType: "html" | "react" | "responsive" | "per_device" }
  | { updateResult: "available" | "not_available" | "failed" | "installed" }
  | { sentryEventId: string };

interface AggregateContext {
  appVersion: string;
  os: string;
  architecture: string;
  webview: string;
  screenCount: number;
  widgetCount: number;
  activePanelCount: number;
  repeaterRowCount: number;
  recentLogs: string[];
}

interface SentryModule {
  init: (options: Record<string, unknown>) => void;
  close: (timeout?: number) => Promise<boolean>;
  captureException: (error: unknown, context?: Record<string, unknown>) => string;
}

const sentryDsn = import.meta.env.VITE_GLITCHTIP_DSN?.trim() ?? "";
const umamiEndpoint = import.meta.env.VITE_UMAMI_ENDPOINT?.trim().replace(/\/+$/, "") ?? "";
const umamiWebsiteId = import.meta.env.VITE_UMAMI_WEBSITE_ID?.trim() ?? "";
const applicationVersion = import.meta.env.VITE_APP_VERSION?.trim() || "0.1.0";
const sentryEventIdPattern = /^[a-f0-9]{32}$/i;
const allowedActionTypes = new Set([
  "ai_interaction_generator",
  "collaboration_session",
  "cloud_preview_publish",
  "react_tailwind_code_export",
]);
const allowedExportTypes = new Set(["html", "react", "responsive", "per_device"]);
const allowedUpdateResults = new Set(["available", "not_available", "failed", "installed"]);
const allowedErrorTypes = new Set([
  "Error",
  "TypeError",
  "RangeError",
  "ReferenceError",
  "SyntaxError",
  "URIError",
  "AggregateError",
  "DOMException",
]);

let currentSettings: PrivacySettings = {
  crashReports: false,
  anonymousTelemetry: false,
};
let sentry: SentryModule | null = null;
let sentryInitialization: Promise<void> | null = null;
let globalHandlersInstalled = false;
let launchEventSent = false;
let usageListenerInstalled = false;

export function isCrashProviderConfigured(): boolean {
  return sentryDsn.length > 0;
}

export function isTelemetryProviderConfigured(): boolean {
  return umamiEndpoint.length > 0 && umamiWebsiteId.length > 0;
}

export function getProviderStatus(): {
  crashReporting: "ready" | "not_configured";
  telemetry: "ready" | "not_configured";
} {
  return {
    crashReporting: isCrashProviderConfigured() ? "ready" : "not_configured",
    telemetry: isTelemetryProviderConfigured() ? "ready" : "not_configured",
  };
}

export async function configureObservability(settings: PrivacySettings): Promise<void> {
  const previous = currentSettings;
  if (!settings.crashReports || !settings.anonymousTelemetry) {
    currentSettings = {
      crashReports: settings.crashReports && previous.crashReports,
      anonymousTelemetry: settings.anonymousTelemetry && previous.anonymousTelemetry,
    };
  }
  try {
    await initializeCrashReporting(settings.crashReports);
  } catch (error) {
    currentSettings = previous;
    throw error;
  }
  currentSettings = settings;
  installGlobalErrorHandlers();
  appendDiagnosticLine("info", "Privacy preferences updated.");
}

export async function startObservability(): Promise<void> {
  const settings = readPrivacySettings();
  currentSettings = settings ?? { crashReports: false, anonymousTelemetry: false };
  installGlobalErrorHandlers();
  installUsageListener();
  await initializeCrashReporting(currentSettings.crashReports);
  if (!launchEventSent) {
    launchEventSent = true;
    trackEvent("app_launched");
  }

  interface FeatureCounts {
    widgets: number;
    rules: number;
    dynamicPanels: number;
    repeaters: number;
    expressions: number;
    annotations: number;
    richText: number;
  }

  function getFeatureCounts(project: ReturnType<typeof useStore.getState>["project"]): FeatureCounts {
    const counts: FeatureCounts = {
      widgets: 0,
      rules: project.screens.reduce((total, screen) => total + screen.interactionRules.length, 0),
      dynamicPanels: 0,
      repeaters: 0,
      expressions: 0,
      annotations: 0,
      richText: 0,
    };
    const seen = new WeakSet<object>();
    const visit = (value: unknown, depth: number) => {
      if (depth > 16 || typeof value !== "object" || value === null || seen.has(value)) return;
      seen.add(value);
      if (Array.isArray(value)) {
        value.forEach((item) => visit(item, depth + 1));
        return;
      }
      const record = value as Record<string, unknown>;
      if (
        typeof record.type === "string" &&
        typeof record.id === "string" &&
        typeof record.props === "object" &&
        record.props !== null &&
        !Array.isArray(record.props)
      ) {
        counts.widgets += 1;
        if (record.type === "dynamic-panel") counts.dynamicPanels += 1;
        if (record.type === "repeater") counts.repeaters += 1;
        if (record.notes && typeof record.notes === "object" && Object.keys(record.notes).length > 0) {
          counts.annotations += 1;
        }
        const props = record.props;
        if (props && typeof props === "object" && !Array.isArray(props)) {
          const widgetProps = props as Record<string, unknown>;
          if (widgetProps.richText === true || Array.isArray(widgetProps.richTextRuns)) {
            counts.richText += 1;
          }
          if (Object.entries(widgetProps).some(([key, value]) =>
            (/expression/i.test(key) && value !== undefined) ||
            (typeof value === "string" && /\[\[[\s\S]{1,120}\]\]/.test(value))
          )) {
            counts.expressions += 1;
          }
        }
      }
      for (const child of Object.values(record)) visit(child, depth + 1);
    };
    visit(project.screens, 0);
    return counts;
  }

  function installUsageListener(): void {
    if (usageListenerInstalled) return;
    usageListenerInstalled = true;
    useStore.subscribe((state, previousState) => {
      if (
        !currentSettings.anonymousTelemetry ||
        state.project === previousState.project ||
        state.project.id !== previousState.project.id
      ) return;
      const before = getFeatureCounts(previousState.project);
      const after = getFeatureCounts(state.project);
      if (before.widgets === 0 && after.widgets > 0) trackEvent("first_widget_added");
      if (before.rules === 0 && after.rules > 0) trackEvent("first_rule_created");
      if (after.dynamicPanels > before.dynamicPanels) trackEvent("dynamic_panel_created");
      if (after.repeaters > before.repeaters) trackEvent("repeater_created");
      if (after.expressions > before.expressions) trackEvent("expression_used");
      if (after.annotations > before.annotations) trackEvent("annotation_added");
      if (after.richText > before.richText) trackEvent("rich_text_used");
    });
  }
  appendDiagnosticLine("info", "Application started.");
}

async function initializeCrashReporting(enabled: boolean): Promise<void> {
  if (isTauri()) {
    await invoke("set_crash_reporting_consent", {
      enabled,
      dsn: enabled && sentryDsn ? sentryDsn : null,
    });
  }
  if (!enabled || !sentryDsn) {
    if (sentry) {
      await sentry.close(1_000);
      sentry = null;
    }
    return;
  }
  if (sentry) return;
  if (sentryInitialization) {
    await sentryInitialization;
    return;
  }
  sentryInitialization = import("@sentry/react")
    .then((sdk) => {
      sdk.init({
        dsn: sentryDsn,
        maxBreadcrumbs: 0,
        tracesSampleRate: 0,
        beforeSend: (event) => sanitizeSentryEvent(event),
      });
      sentry = sdk;
    })
    .finally(() => {
      sentryInitialization = null;
    });
  await sentryInitialization;
}

function sanitizeSentryEvent(event: import("@sentry/core").ErrorEvent): import("@sentry/core").ErrorEvent {
  delete event.user;
  delete event.request;
  delete event.breadcrumbs;
  delete event.transaction;
  delete event.extra;
  delete event.tags;
  delete event.debug_meta;
  if (event.message) event.message = sanitizeDiagnosticText(event.message);
  for (const exception of event.exception?.values ?? []) {
    if (exception.value) exception.value = sanitizeDiagnosticText(exception.value);
    if (!exception.stacktrace?.frames) continue;
    for (const frame of exception.stacktrace.frames) {
      frame.filename = "application";
      frame.abs_path = undefined;
      frame.pre_context = undefined;
      frame.post_context = undefined;
      frame.vars = undefined;
    }
  }
  event.contexts = {
    app: {
      app_version: applicationVersion,
      os: getPlatformName(),
      webview: getWebviewVersion(),
      architecture: "reported by desktop runtime when available",
    },
    project_metrics: getProjectMetrics(),
    recent_logs: { lines: getRecentDiagnosticLines() },
  };
  return event;
}

function installGlobalErrorHandlers(): void {
  if (globalHandlersInstalled) return;
  globalHandlersInstalled = true;
  window.addEventListener("error", (event) => {
    void reportException(event.error ?? new Error("Unhandled application error.")).catch(() => {
      recordDiagnostic("warning", "Crash reporting could not process an application error.");
    });
  });
  window.addEventListener("unhandledrejection", (event) => {
    void reportException(event.reason).catch(() => {
      recordDiagnostic("warning", "Crash reporting could not process an unhandled rejection.");
    });
  });
}

export function recordDiagnostic(
  level: "info" | "warning" | "error",
  message: string,
): void {
  const line = appendDiagnosticLine(level, message);
  if (isTauri()) {
    void invoke("append_diagnostic_log", { line }).catch(() => {
      appendDiagnosticLine("warning", "Could not persist a diagnostic log entry.");
    });
  }
}

export async function reportException(error: unknown): Promise<void> {
  const reportedErrorType = error instanceof Error && allowedErrorTypes.has(error.name)
    ? error.name
    : "ApplicationError";
  recordDiagnostic("error", `Unhandled application error (${reportedErrorType}).`);
  const context = currentSettings.crashReports && sentry
    ? await collectAggregateContext()
    : undefined;
  let sentryEventId: string | undefined;
  if (currentSettings.crashReports && sentry && context) {
    const sanitizedError = new Error("Unhandled application error.");
    sanitizedError.name = reportedErrorType;
    sentryEventId = sentry.captureException(sanitizedError, {
      extra: {
        app_version: context.appVersion,
        os: context.os,
        architecture: context.architecture,
        webview: context.webview,
        screen_count: context.screenCount,
        widget_count: context.widgetCount,
        active_panel_count: context.activePanelCount,
        repeater_row_count: context.repeaterRowCount,
        recent_logs: context.recentLogs,
      },
    });
  }
  if (currentSettings.anonymousTelemetry) {
    trackEvent("crash", sentryEventId && sentryEventIdPattern.test(sentryEventId)
      ? { sentryEventId }
      : undefined);
  }
}

export function trackEvent(
  event: TelemetryEvent,
  properties?: TelemetryProperties,
): void {
  if (!currentSettings.anonymousTelemetry) return;
  if (!isTelemetryProviderConfigured()) {
    recordDiagnostic("info", `Telemetry provider is not configured; skipped ${event}.`);
    return;
  }
  const safeProperties = validateTelemetryProperties(properties);
  const payload = {
    type: "event",
    payload: {
      website: umamiWebsiteId,
      name: event,
      url: "/",
      title: "ProtoFlow",
      referrer: "",
      ...(safeProperties ? { data: safeProperties } : {}),
    },
  };
  void fetch(`${umamiEndpoint}/api/send`, {
    method: "POST",
    credentials: "omit",
    referrerPolicy: "no-referrer",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  }).catch(() => {
    recordDiagnostic("warning", `Could not send anonymous telemetry event: ${event}.`);
  });
}

function validateTelemetryProperties(
  properties?: TelemetryProperties,
): Record<string, string> | undefined {
  if (!properties) return undefined;
  if ("actionType" in properties && allowedActionTypes.has(properties.actionType)) {
    return { action_type: properties.actionType };
  }
  if ("exportType" in properties && allowedExportTypes.has(properties.exportType)) {
    return { export_type: properties.exportType };
  }
  if ("updateResult" in properties && allowedUpdateResults.has(properties.updateResult)) {
    return { result: properties.updateResult };
  }
  if ("sentryEventId" in properties && sentryEventIdPattern.test(properties.sentryEventId)) {
    return { crash_id: properties.sentryEventId };
  }
  return undefined;
}

async function collectAggregateContext(): Promise<AggregateContext> {
  let architecture = "unknown";
  let os = getPlatformName();
  if (isTauri()) {
    const native = await invoke<{ os: string; architecture: string }>("get_diagnostics_platform");
    architecture = native.architecture;
    os = native.os;
  }
  const metrics = getProjectMetrics();
  return {
    appVersion: applicationVersion,
    os,
    architecture,
    webview: getWebviewVersion(),
    ...metrics,
    recentLogs: getRecentDiagnosticLines(),
  };
}

function getProjectMetrics(): Pick<
  AggregateContext,
  "screenCount" | "widgetCount" | "activePanelCount" | "repeaterRowCount"
> {
  const project = useStore.getState().project;
  const seen = new WeakSet<object>();
  let widgetCount = 0;
  let activePanelCount = 0;
  let repeaterRowCount = 0;
  const visit = (value: unknown, depth: number) => {
    if (depth > 16 || typeof value !== "object" || value === null || seen.has(value)) return;
    seen.add(value);
    if (Array.isArray(value)) {
      value.forEach((item) => visit(item, depth + 1));
      return;
    }
    const record = value as Record<string, unknown>;
    if (
      typeof record.type === "string" &&
      typeof record.id === "string" &&
      typeof record.props === "object" &&
      record.props !== null &&
      !Array.isArray(record.props)
    ) {
      widgetCount += 1;
      if (record.type === "dynamic-panel") activePanelCount += 1;
      if (record.type === "repeater") {
        const props = record.props as Record<string, unknown>;
        if (Array.isArray(props.dataset)) repeaterRowCount += props.dataset.length;
      }
    }
    for (const child of Object.values(record)) visit(child, depth + 1);
  };
  visit(project.screens, 0);
  return {
    screenCount: project.screens.length,
    widgetCount,
    activePanelCount,
    repeaterRowCount,
  };
}

function getPlatformName(): string {
  const platform = navigator.platform || "unknown";
  if (/win/i.test(platform)) return "Windows";
  if (/mac/i.test(platform)) return "macOS";
  if (/linux/i.test(platform)) return "Linux";
  return "unknown";
}

function getWebviewVersion(): string {
  const match = navigator.userAgent.match(/(?:Chrome|Chromium)\/([\d.]+)/);
  return match ? `Chromium ${match[1]}` : "unknown";
}
