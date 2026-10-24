import { afterEach, describe, expect, it, vi } from "vitest";
import { trackEvent } from "./observability";

describe("anonymous telemetry consent gate", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("does not send events before explicit consent", () => {
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);

    trackEvent("app_launched");

    expect(fetch).not.toHaveBeenCalled();
  });
});
