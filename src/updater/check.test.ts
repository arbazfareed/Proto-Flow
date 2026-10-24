import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { isTauri } from "@tauri-apps/api/core";
import { check } from "@tauri-apps/plugin-updater";
import { checkForUpdate } from "./check";

vi.mock("@tauri-apps/api/core", () => ({ isTauri: vi.fn() }));
vi.mock("@tauri-apps/plugin-updater", () => ({ check: vi.fn() }));

const isTauriMock = vi.mocked(isTauri);
const checkMock = vi.mocked(check);

describe("production updater checks", () => {
  beforeEach(() => {
    vi.stubEnv("PROD", true);
    isTauriMock.mockReturnValue(true);
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("does not contact the updater in development", async () => {
    vi.stubEnv("PROD", false);

    await expect(checkForUpdate()).resolves.toBeNull();
    expect(checkMock).not.toHaveBeenCalled();
  });

  it("does not contact the updater outside the desktop app", async () => {
    isTauriMock.mockReturnValue(false);

    await expect(checkForUpdate()).resolves.toBeNull();
    expect(checkMock).not.toHaveBeenCalled();
  });

  it("returns the available update in a production desktop app", async () => {
    const update = { version: "0.2.0" };
    checkMock.mockResolvedValue(update as Awaited<ReturnType<typeof check>>);

    await expect(checkForUpdate()).resolves.toBe(update);
    expect(checkMock).toHaveBeenCalledOnce();
  });

  it("surfaces updater verification and network errors to the caller", async () => {
    checkMock.mockRejectedValue(new Error("offline"));

    await expect(checkForUpdate()).rejects.toThrow("offline");
  });
});
