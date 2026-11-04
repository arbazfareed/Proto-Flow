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
      "onboarding_started",
      "onboarding_step_1",
      "onboarding_step_2",
      "onboarding_step_3",
      "onboarding_step_4",
      "onboarding_step_5",
      "onboarding_completed",
      "onboarding_skipped",
      "device_tour_viewed",
      "tutorial_started",
      "tutorial_completed",
      "tutorial_step_1_completed",
      "tutorial_step_2_completed",
      "tutorial_step_3_completed",
      "tutorial_step_4_completed",
      "tutorial_step_5_completed",
      "tutorial_step_6_completed",
      "tutorial_step_7_completed",
      "tutorial_step_8_completed",
      "tutorial_step_9_completed",
      "tutorial_step_10_completed",
      "tutorial_step_11_completed",
      "tutorial_step_12_completed",
      "tutorial_step_13_completed",
      "tutorial_step_14_completed",
      "tutorial_step_15_completed",
    ]);
  });

  it("does not send events before explicit consent", () => {
    observability.trackEvent("project_created");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("sends onboarding events as names only after consent", async () => {
    await observability.configureObservability({
      crashReports: false,
      anonymousTelemetry: true,
    });
    const onboardingEvents = [
      "onboarding_started",
      "onboarding_step_1",
      "onboarding_step_2",
      "onboarding_step_3",
      "onboarding_step_4",
      "onboarding_step_5",
      "onboarding_completed",
      "onboarding_skipped",
      "device_tour_viewed",
    ] as const;
    onboardingEvents.forEach((event) => observability.trackEvent(event));
    for (let index = onboardingEvents.length; index < observability.TELEMETRY_BATCH_SIZE; index += 1) {
      observability.trackEvent("project_created");
    }

    await vi.waitFor(() => {
      expect(fetchMock).toHaveBeenCalledTimes(observability.TELEMETRY_BATCH_SIZE);
    });

    const sentNames = fetchMock.mock.calls.map((call) => {
      const request = call[1] as RequestInit;
      return JSON.parse(String(request.body)).payload;
    });
    onboardingEvents.forEach((event) => {
      const payload = sentNames.find((item) => item.name === event);
      expect(payload).toBeDefined();
      expect(payload).not.toHaveProperty("data");
    });
  });

  it("sends tutorial progress events without user-supplied data", async () => {
    await observability.configureObservability({
      crashReports: false,
      anonymousTelemetry: true,
    });
    const tutorialEvents = [
      "tutorial_started",
      "tutorial_step_1_completed",
      "tutorial_step_15_completed",
      "tutorial_completed",
    ] as const;
    tutorialEvents.forEach((event) => observability.trackEvent(event));
    for (let index = tutorialEvents.length; index < observability.TELEMETRY_BATCH_SIZE; index += 1) {
      observability.trackEvent("project_created");
    }

    await vi.waitFor(() => {
      expect(fetchMock).toHaveBeenCalledTimes(observability.TELEMETRY_BATCH_SIZE);
    });
    const payloads = fetchMock.mock.calls.map((call) =>
      JSON.parse(String((call[1] as RequestInit).body)).payload,
    );
    tutorialEvents.forEach((event) => {
      const payload = payloads.find((item) => item.name === event);
      expect(payload).toBeDefined();
      expect(payload).not.toHaveProperty("data");
    });
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
