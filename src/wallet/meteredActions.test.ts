import { afterEach, describe, expect, it, vi } from "vitest";
import {
  confirmationWasSkipped,
  isUsageTelemetryEnabled,
  METERED_ACTIONS,
  recordLocalActionUsage,
  saveConfirmationPreference,
  setUsageTelemetryEnabled,
} from "./meteredActions";

function stubLocalStorage() {
  const values = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
    removeItem: (key: string) => values.delete(key),
  });
  return values;
}

afterEach(() => vi.unstubAllGlobals());

describe("metered action preferences", () => {
  it("stores confirmation opt-outs separately for each account and action", () => {
    stubLocalStorage();
    saveConfirmationPreference("account-a", "ai_interaction_generator");

    expect(confirmationWasSkipped("account-a", "ai_interaction_generator")).toBe(true);
    expect(confirmationWasSkipped("account-a", "cloud_preview_publish")).toBe(false);
    expect(confirmationWasSkipped("account-b", "ai_interaction_generator")).toBe(false);
  });

  it("records only aggregate local usage after explicit opt-in", () => {
    const values = stubLocalStorage();
    recordLocalActionUsage("ai_interaction_generator");
    expect(values.has("protoflow.metered.telemetry.counts")).toBe(false);

    setUsageTelemetryEnabled(true);
    recordLocalActionUsage("ai_interaction_generator");
    recordLocalActionUsage("ai_interaction_generator");
    recordLocalActionUsage("cloud_preview_publish");

    expect(isUsageTelemetryEnabled()).toBe(true);
    expect(JSON.parse(values.get("protoflow.metered.telemetry.counts") ?? "{}")).toEqual({
      ai_interaction_generator: 2,
      cloud_preview_publish: 1,
    });
    expect(values.get("protoflow.metered.telemetry.counts")).not.toContain("payload");

    setUsageTelemetryEnabled(false);
    recordLocalActionUsage("ai_interaction_generator");
    expect(JSON.parse(values.get("protoflow.metered.telemetry.counts") ?? "{}").ai_interaction_generator).toBe(2);
  });

  it("keeps display costs aligned with the server catalog", () => {
    expect(METERED_ACTIONS).toMatchObject({
      ai_interaction_generator: { cost: 1 },
      cloud_preview_publish: { cost: 2 },
      react_tailwind_code_export: { cost: 3 },
    });
  });
});
