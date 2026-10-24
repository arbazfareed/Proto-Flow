import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type Observability = typeof import("./observability");

describe("anonymous telemetry consent and delivery", () => {
  let observability: Observability;
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    vi.resetModules();
    vi.stubEnv("VITE_UMAMI_ENDPOINT", "https://analytics.example");
    vi.stubEnv("VITE_UMAMI_WEBSITE_ID", "protoflow-test");
    fetchMock = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal("fetch", fetchMock);
    observability = await import("./observability");
  });

  afterEach(async () => {
    await observability.configureObservability({
      crashReports: false,
      anonymousTelemetry: false,
    });
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it("exposes the finalized event catalog", () => {
    expect(observability.TELEMETRY_EVENTS).toEqual([
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
    ]);
  });

  it("does not send events before explicit consent", () => {
    observability.trackEvent("project_created");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("batches telemetry and sends only static allow-listed values", async () => {
    await observability.configureObservability({
      crashReports: false,
      anonymousTelemetry: true,
    });
    observability.trackEvent("shape_created", { type: "rectangle" });
    Reflect.apply(observability.trackEvent, undefined, [
      "shape_created",
      { type: "C:\\Users\\Alice\\my project" },
    ]);
    expect(fetchMock).not.toHaveBeenCalled();

    for (let index = 0; index < observability.TELEMETRY_BATCH_SIZE - 2; index += 1) {
      observability.trackEvent("project_created");
    }

    await vi.waitFor(() => {
      expect(fetchMock).toHaveBeenCalledTimes(observability.TELEMETRY_BATCH_SIZE);
    });
    const sentBodies = fetchMock.mock.calls.map((call) => JSON.parse(call[1].body as string));
    expect(sentBodies.every((body) =>
      body.type === "event" &&
      body.payload.website === "protoflow-test" &&
      body.payload.url === "/" &&
      body.payload.title === "ProtoFlow" &&
      body.payload.referrer === ""
    )).toBe(true);
    expect(JSON.stringify(sentBodies)).not.toMatch(/path|project name|variable value|email/i);
    expect(sentBodies.some((body) => body.payload.data?.type === "rectangle")).toBe(true);
  });

  it("flushes queued events after 30 seconds", async () => {
    vi.useFakeTimers();
    await observability.configureObservability({
      crashReports: false,
      anonymousTelemetry: true,
    });
    expect(fetchMock).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(observability.TELEMETRY_BATCH_INTERVAL_MS - 1);
    expect(fetchMock).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
  });

  it("clears pending events when telemetry consent is withdrawn", async () => {
    vi.useFakeTimers();
    await observability.configureObservability({
      crashReports: false,
      anonymousTelemetry: true,
    });
    await observability.configureObservability({
      crashReports: false,
      anonymousTelemetry: false,
    });
    await vi.advanceTimersByTimeAsync(observability.TELEMETRY_BATCH_INTERVAL_MS);

    expect(fetchMock).not.toHaveBeenCalled();
  });
});
