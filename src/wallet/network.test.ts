import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { startNetworkMonitor, type NetworkStatus } from "./network";

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

beforeEach(() => {
  vi.stubGlobal("window", new EventTarget());
});

describe("cloud network monitor", () => {
  it("backs off from 30 seconds to 1 minute after consecutive failures", async () => {
    vi.useFakeTimers();
    const check = vi.fn().mockResolvedValue(false);
    const onStatus = vi.fn<(status: NetworkStatus) => void>();
    const stop = startNetworkMonitor(check, onStatus, vi.fn());
    await Promise.resolve();
    expect(onStatus).toHaveBeenNthCalledWith(1, "checking");
    expect(onStatus).toHaveBeenLastCalledWith("offline");

    await vi.advanceTimersByTimeAsync(29_999);
    expect(check).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(check).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(59_999);
    expect(check).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(1);
    expect(check).toHaveBeenCalledTimes(3);
    stop();
  });

  it("caps repeated health-check failures at a 15-minute retry interval", async () => {
    vi.useFakeTimers();
    const check = vi.fn().mockResolvedValue(false);
    const stop = startNetworkMonitor(check, vi.fn(), vi.fn());
    await Promise.resolve();

    let expectedCalls = 1;
    for (const delay of [30_000, 60_000, 5 * 60_000, 15 * 60_000, 15 * 60_000]) {
      await vi.advanceTimersByTimeAsync(delay);
      expectedCalls += 1;
      expect(check).toHaveBeenCalledTimes(expectedCalls);
    }
    expect(check).toHaveBeenCalledTimes(6);
    stop();
  });

  it("marks the cloud online and syncs the wallet after recovery", async () => {
    vi.useFakeTimers();
    const check = vi.fn()
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(true);
    const onStatus = vi.fn<(status: NetworkStatus) => void>();
    const onReconnect = vi.fn();
    const stop = startNetworkMonitor(check, onStatus, onReconnect);
    await Promise.resolve();

    await vi.advanceTimersByTimeAsync(30_000);

    expect(onStatus).toHaveBeenLastCalledWith("online");
    expect(onReconnect).toHaveBeenCalledTimes(1);
    stop();
  });

  it("checks the Worker every 30 seconds while reachable", async () => {
    vi.useFakeTimers();
    const check = vi.fn().mockResolvedValue(true);
    const stop = startNetworkMonitor(check, vi.fn(), vi.fn());
    await Promise.resolve();

    await vi.advanceTimersByTimeAsync(29_999);
    expect(check).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(check).toHaveBeenCalledTimes(2);
    stop();
  });

  it("stops polling and removes network event listeners", async () => {
    vi.useFakeTimers();
    const check = vi.fn().mockResolvedValue(false);
    const stop = startNetworkMonitor(check, vi.fn(), vi.fn());
    await Promise.resolve();
    stop();
    window.dispatchEvent(new Event("online"));
    await vi.advanceTimersByTimeAsync(15 * 60_000);
    expect(check).toHaveBeenCalledTimes(1);
  });
});
