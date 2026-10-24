import { invoke, isTauri } from "@tauri-apps/api/core";
import {
  appendDiagnosticLine,
  getRecentDiagnosticLines,
  readPrivacySettings,
  sanitizeDiagnosticText,
  type PrivacySettings,
} from "./privacy";
import { useStore } from "../store";
import { collectWidgetsDeep } from "../project/dynamicPanels";

export const TELEMETRY_BATCH_INTERVAL_MS = 30_000;
export const TELEMETRY_BATCH_SIZE = 20;
const MAX_QUEUED_TELEMETRY_EVENTS = 1_000;

export const TELEMETRY_EVENTS = [
  "app_launched",
  "app_updated",
  "app_crashed",
  "project_created",
  "project_opened",
  "project_saved",
  "shape_created",
  "widget_created",
  "symbol_created",
  "variable_created",
  "rule_created",
  "expression_used",
  "preview_opened",
  "preview_rule_fired",
  "panel_created",
  "panel_state_changed",
  "repeater_created",
  "repeater_row_added",
  "flow_diagram_opened",
  "annotation_added",
  "rich_text_used",
  "version_history_restored",
  "action_attempted",
  "action_succeeded",
  "action_failed",
  "export_used",
  "signin_completed",
  "error_shown",
] as const;

export type TelemetryEventProperties = {
  app_launched: undefined;
  app_updated: undefined;
  app_crashed: undefined;
  project_created: undefined;
  project_opened: undefined;
  project_saved: undefined;
  shape_created: { type: ShapeType };
  widget_created: { type: WidgetType };
  symbol_created: undefined;
  variable_created: undefined;
  rule_created: undefined;
  expression_used: undefined;
  preview_opened: undefined;
  preview_rule_fired: undefined;
  panel_created: undefined;
  panel_state_changed: undefined;
  repeater_created: undefined;
  repeater_row_added: { count: number };
  flow_diagram_opened: undefined;
  annotation_added: undefined;
  rich_text_used: undefined;
  version_history_restored: undefined;
  action_attempted: { actionType: MeteredActionType };
  action_succeeded: { actionType: MeteredActionType };
  action_failed: { actionType: MeteredActionType; reason: ActionFailureReason };
  export_used: { exportType: ExportType };
  signin_completed: { provider: "email" | "google" };
  error_shown: { category: ErrorCategory };
};

export type TelemetryEvent = keyof TelemetryEventProperties;
export type ShapeType = "rectangle" | "ellipse" | "text" | "line" | "arrow" | "icon" | "other";
export type WidgetType = "button" | "input" | "image" | "checkbox" | "radio" | "toggle" | "other";
export type MeteredActionType =
  | "ai_interaction_generator"
  | "collaboration_session"
  | "cloud_preview_publish"
  | "react_tailwind_code_export";
export type ActionFailureReason =
  | "cancelled"
  | "insufficient_balance"
  | "rate_limited"
  | "network"
  | "invalid_request"
  | "provider"
  | "other";
export type ExportType = "html" | "react" | "responsive" | "per_device" | "images";
export type ErrorCategory = "validation" | "network" | "storage" | "export" | "cloud_action" | "application";

type QueuedTelemetryEvent = {
  name: TelemetryEvent;
  data?: Record<string, string>;
  attempts: number;
};

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

function installTelemetryFlushHandlers(): void {
  if (telemetryFlushHandlersInstalled) return;
  if (typeof document === "undefined" || typeof window === "undefined") return;
  telemetryFlushHandlersInstalled = true;
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") void flushTelemetryQueue();
  });
  window.addEventListener("pagehide", () => void flushTelemetryQueue());
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
let telemetryQueue: QueuedTelemetryEvent[] = [];
let telemetryFlushTimer: ReturnType<typeof setTimeout> | null = null;
let telemetryFlushInProgress = false;
let telemetryAbortController: AbortController | null = null;
let telemetryFlushHandlersInstalled = false;
let projectFeatureScanTimer: ReturnType<typeof setTimeout> | null = null;
let projectFeatureScanBaseline: ReturnType<typeof useStore.getState>["project"] | null = null;

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
  if (!settings.anonymousTelemetry) clearTelemetryQueue();
  try {
    await initializeCrashReporting(settings.crashReports);
  } catch (error) {
    currentSettings = previous;
    throw error;
  }
  currentSettings = settings;
  installGlobalErrorHandlers();
  appendDiagnosticLine("info", "Privacy preferences updated.");
  if (settings.anonymousTelemetry) {
    if (!launchEventSent) {
      launchEventSent = true;
      trackEvent("app_launched");
    }
    scheduleTelemetryFlush();
  }
}

export async function startObservability(): Promise<void> {
  const settings = readPrivacySettings();
  currentSettings = settings ?? { crashReports: false, anonymousTelemetry: false };
  installGlobalErrorHandlers();
  installUsageListener();
  installTelemetryFlushHandlers();
  await initializeCrashReporting(currentSettings.crashReports);
  if (currentSettings.anonymousTelemetry && !launchEventSent) {
    launchEventSent = true;
    trackEvent("app_launched");
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
      if (projectFeatureScanTimer !== null) return;
      projectFeatureScanBaseline = previousState.project;
      projectFeatureScanTimer = setTimeout(() => {
        projectFeatureScanTimer = null;
        const baseline = projectFeatureScanBaseline;
        projectFeatureScanBaseline = null;
        const latest = useStore.getState().project;
        if (currentSettings.anonymousTelemetry && baseline?.id === latest.id) {
          trackProjectFeatureChanges(baseline, latest);
        }
      }, 500);
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
  if (typeof window === "undefined") return;
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
  if (currentSettings.crashReports && sentry && context) {
    const sanitizedError = new Error("Unhandled application error.");
    sanitizedError.name = reportedErrorType;
    sentry.captureException(sanitizedError, {
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
    trackEvent("app_crashed");
  }
}

export function trackEvent(
  event: TelemetryEvent,
  properties?: TelemetryEventProperties[typeof event],
): void {
  if (!currentSettings.anonymousTelemetry) return;
  if (!isTelemetryProviderConfigured()) return;
  const safeProperties = validateTelemetryProperties(event, properties);
  if (properties !== undefined && !safeProperties) {
    recordDiagnostic("warning", `Rejected invalid anonymous telemetry properties: ${event}.`);
    return;
  }
  if (telemetryQueue.length >= MAX_QUEUED_TELEMETRY_EVENTS) telemetryQueue.shift();
  telemetryQueue.push({ name: event, ...(safeProperties ? { data: safeProperties } : {}), attempts: 0 });
  if (
    telemetryQueue.length >= TELEMETRY_BATCH_SIZE ||
    event === "app_updated" ||
    event === "app_crashed"
  ) void flushTelemetryQueue();
  else scheduleTelemetryFlush();
}

function validateTelemetryProperties(
  event: TelemetryEvent,
  properties?: TelemetryEventProperties[typeof event],
): Record<string, string> | undefined {
  if (properties === undefined) return undefined;
  if (typeof properties !== "object" || properties === null || Array.isArray(properties)) return undefined;
  const record = properties as Record<string, unknown>;
  const keys = Object.keys(record);
  switch (event) {
    case "shape_created":
      return keys.length === 1 && keys[0] === "type" && isShapeType(record.type)
        ? { type: record.type }
        : undefined;
    case "widget_created":
      return keys.length === 1 && keys[0] === "type" && isWidgetType(record.type)
        ? { type: record.type }
        : undefined;
    case "repeater_row_added":
      return keys.length === 1 && keys[0] === "count" &&
        typeof record.count === "number" && Number.isSafeInteger(record.count) &&
        record.count > 0 && record.count <= 1_000
        ? { count: String(record.count) }
        : undefined;
    case "action_attempted":
    case "action_succeeded":
      return keys.length === 1 && keys[0] === "actionType" && isMeteredActionType(record.actionType)
        ? { action_type: record.actionType }
        : undefined;
    case "action_failed":
      return keys.length === 2 && keys.includes("actionType") && keys.includes("reason") &&
        isMeteredActionType(record.actionType) && isActionFailureReason(record.reason)
        ? { action_type: record.actionType, reason: record.reason }
        : undefined;
    case "export_used":
      return keys.length === 1 && keys[0] === "exportType" && isExportType(record.exportType)
        ? { export_type: record.exportType }
        : undefined;
    case "signin_completed":
      return keys.length === 1 && keys[0] === "provider" &&
        (record.provider === "email" || record.provider === "google")
        ? { provider: record.provider }
        : undefined;
    case "error_shown":
      return keys.length === 1 && keys[0] === "category" && isErrorCategory(record.category)
        ? { category: record.category }
        : undefined;
    default:
      return undefined;
  }
}

function scheduleTelemetryFlush(): void {
  if (
    telemetryFlushTimer !== null ||
    !currentSettings.anonymousTelemetry ||
    !isTelemetryProviderConfigured() ||
    telemetryQueue.length === 0
  ) return;
  telemetryFlushTimer = setTimeout(() => {
    telemetryFlushTimer = null;
    void flushTelemetryQueue();
  }, TELEMETRY_BATCH_INTERVAL_MS);
}

async function flushTelemetryQueue(): Promise<void> {
  if (
    telemetryFlushInProgress ||
    !currentSettings.anonymousTelemetry ||
    !isTelemetryProviderConfigured() ||
    telemetryQueue.length === 0
  ) return;
  if (telemetryFlushTimer !== null) {
    clearTimeout(telemetryFlushTimer);
    telemetryFlushTimer = null;
  }
  telemetryFlushInProgress = true;
  const controller = new AbortController();
  telemetryAbortController = controller;
  const batch = telemetryQueue.splice(0, TELEMETRY_BATCH_SIZE);
  const results = await Promise.allSettled(batch.map(async (event) => {
    const response = await fetch(`${umamiEndpoint}/api/send`, {
      method: "POST",
      credentials: "omit",
      keepalive: true,
      referrerPolicy: "no-referrer",
      signal: controller.signal,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        type: "event",
        payload: {
          website: umamiWebsiteId,
          name: event.name,
          url: "/",
          title: "ProtoFlow",
          referrer: "",
          ...(event.data ? { data: event.data } : {}),
        },
      }),
    });
    if (!response.ok) throw new Error(`Analytics endpoint returned ${response.status}.`);
  }));
  const retry: QueuedTelemetryEvent[] = [];
  for (const [index, result] of results.entries()) {
    if (result.status === "rejected" && batch[index].attempts < 2) {
      retry.push({ ...batch[index], attempts: batch[index].attempts + 1 });
    } else if (result.status === "rejected") {
      recordDiagnostic("warning", `Anonymous telemetry event delivery failed: ${batch[index].name}.`);
    }
  }
  if (currentSettings.anonymousTelemetry) {
    telemetryQueue = [...retry, ...telemetryQueue].slice(-MAX_QUEUED_TELEMETRY_EVENTS);
  }
  telemetryAbortController = null;
  telemetryFlushInProgress = false;
  if (telemetryQueue.length >= TELEMETRY_BATCH_SIZE) void flushTelemetryQueue();
  else scheduleTelemetryFlush();
}

function clearTelemetryQueue(): void {
  telemetryQueue = [];
  telemetryAbortController?.abort();
  telemetryAbortController = null;
  if (telemetryFlushTimer !== null) {
    clearTimeout(telemetryFlushTimer);
    telemetryFlushTimer = null;
  }
}

const SHAPE_TYPES = new Set<ShapeType>(["rectangle", "ellipse", "text", "line", "arrow", "icon", "other"]);
const WIDGET_TYPES = new Set<WidgetType>(["button", "input", "image", "checkbox", "radio", "toggle", "other"]);
const ACTION_TYPES = new Set<MeteredActionType>([
  "ai_interaction_generator", "collaboration_session", "cloud_preview_publish", "react_tailwind_code_export",
]);
const ACTION_FAILURE_REASONS = new Set<ActionFailureReason>([
  "cancelled", "insufficient_balance", "rate_limited", "network", "invalid_request", "provider", "other",
]);
const EXPORT_TYPES = new Set<ExportType>(["html", "react", "responsive", "per_device", "images"]);
const ERROR_CATEGORIES = new Set<ErrorCategory>([
  "validation", "network", "storage", "export", "cloud_action", "application",
]);
const PRIMITIVE_WIDGETS = new Set(["rectangle", "ellipse", "text", "line", "arrow", "icon"]);

function isShapeType(value: unknown): value is ShapeType {
  return typeof value === "string" && SHAPE_TYPES.has(value as ShapeType);
}

function isWidgetType(value: unknown): value is WidgetType {
  return typeof value === "string" && WIDGET_TYPES.has(value as WidgetType);
}

function isMeteredActionType(value: unknown): value is MeteredActionType {
  return typeof value === "string" && ACTION_TYPES.has(value as MeteredActionType);
}

function isActionFailureReason(value: unknown): value is ActionFailureReason {
  return typeof value === "string" && ACTION_FAILURE_REASONS.has(value as ActionFailureReason);
}

function isExportType(value: unknown): value is ExportType {
  return typeof value === "string" && EXPORT_TYPES.has(value as ExportType);
}

function isErrorCategory(value: unknown): value is ErrorCategory {
  return typeof value === "string" && ERROR_CATEGORIES.has(value as ErrorCategory);
}

function normalizeWidgetType(type: string): WidgetType {
  return WIDGET_TYPES.has(type as WidgetType) ? type as WidgetType : "other";
}

interface ProjectFeatureCounts {
  widgets: Map<string, string>;
  ruleCount: number;
  variables: number;
  symbols: number;
  expressions: number;
  annotations: number;
  richText: number;
  repeaterRows: number;
  panelStates: Map<string, string>;
}

function getProjectFeatureCounts(project: ReturnType<typeof useStore.getState>["project"]): ProjectFeatureCounts {
  const widgets = new Map<string, string>();
  const panelStates = new Map<string, string>();
  let expressions = 0;
  let annotations = 0;
  let richText = 0;
  let repeaterRows = 0;
  let ruleCount = 0;
  for (const screen of project.screens) {
    ruleCount += screen.interactionRules.length;
    for (const widget of collectWidgetsDeep(screen.widgets)) {
      widgets.set(widget.id, widget.type);
      if (widget.notes && (
        widget.notes.description.length > 0 ||
        widget.notes.requirementId.length > 0 ||
        widget.notes.tags.length > 0 ||
        Object.keys(widget.notes.custom).length > 0
      )) annotations += 1;
      if (widget.props.richText === true || Array.isArray(widget.props.richTextRuns)) richText += 1;
      if (Object.entries(widget.props).some(([key, value]) =>
        (/expression/i.test(key) && value !== undefined) ||
        (typeof value === "string" && /\[\[[\s\S]{1,120}\]\]/.test(value))
      )) expressions += 1;
      if (widget.type === "dynamic-panel" && typeof widget.props.activeStateId === "string") {
        panelStates.set(widget.id, widget.props.activeStateId);
      }
      if (widget.type === "repeater" && Array.isArray(widget.props.dataset)) {
        repeaterRows += widget.props.dataset.length;
      }
    }
  }
  return {
    widgets,
    ruleCount,
    variables: project.variables.length,
    symbols: project.symbols.length,
    expressions,
    annotations,
    richText,
    repeaterRows,
    panelStates,
  };
}

function trackProjectFeatureChanges(
  beforeProject: ReturnType<typeof useStore.getState>["project"],
  afterProject: ReturnType<typeof useStore.getState>["project"],
): void {
  const before = getProjectFeatureCounts(beforeProject);
  const after = getProjectFeatureCounts(afterProject);
  for (const [widgetId, widgetType] of after.widgets) {
    if (before.widgets.has(widgetId)) continue;
    if (PRIMITIVE_WIDGETS.has(widgetType)) {
      trackEvent("shape_created", { type: isShapeType(widgetType) ? widgetType : "other" });
    } else {
      trackEvent("widget_created", { type: normalizeWidgetType(widgetType) });
    }
    if (widgetType === "dynamic-panel") trackEvent("panel_created");
    if (widgetType === "repeater") trackEvent("repeater_created");
  }
  if (after.ruleCount > before.ruleCount) {
    for (let index = before.ruleCount; index < after.ruleCount; index += 1) trackEvent("rule_created");
  }
  if (after.variables > before.variables) {
    for (let index = before.variables; index < after.variables; index += 1) trackEvent("variable_created");
  }
  if (after.symbols > before.symbols) {
    for (let index = before.symbols; index < after.symbols; index += 1) trackEvent("symbol_created");
  }
  if (after.expressions > before.expressions) trackEvent("expression_used");
  if (after.annotations > before.annotations) trackEvent("annotation_added");
  if (after.richText > before.richText) trackEvent("rich_text_used");
  if (after.repeaterRows > before.repeaterRows) {
    trackEvent("repeater_row_added", { count: Math.min(1_000, after.repeaterRows - before.repeaterRows) });
  }
  if (havePanelStatesChanged(before.panelStates, after.panelStates)) trackEvent("panel_state_changed");
}

function havePanelStatesChanged(before: Map<string, string>, after: Map<string, string>): boolean {
  for (const [panelId, stateId] of after) {
    if (before.has(panelId) && before.get(panelId) !== stateId) return true;
  }
  return false;
}

export function categorizeTelemetryError(message: string): ErrorCategory {
  if (/invalid|validation|required|must be|unsupported/i.test(message)) return "validation";
  if (/network|offline|connection|request failed/i.test(message)) return "network";
  if (/export|download|archive/i.test(message)) return "export";
  if (/wallet|cloud|credit|collaboration/i.test(message)) return "cloud_action";
  if (/file|storage|save|open/i.test(message)) return "storage";
  return "application";
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
