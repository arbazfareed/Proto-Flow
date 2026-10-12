import { beforeEach, describe, expect, it, vi } from "vitest";
import { relaunch } from "@tauri-apps/plugin-process";
import { installAvailableUpdate } from "./install";

vi.mock("@tauri-apps/plugin-process", () => ({ relaunch: vi.fn() }));

const relaunchMock = vi.mocked(relaunch);

describe("updater installation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("downloads and installs before relaunching", async () => {
    const events: string[] = [];
    const update = {
      downloadAndInstall: vi.fn(async () => {
        events.push("install");
      }),
    };
    relaunchMock.mockImplementation(async () => {
      events.push("relaunch");
    });

    await installAvailableUpdate(update);

    expect(events).toEqual(["install", "relaunch"]);
  });

  it("does not relaunch when the update install fails", async () => {
    const update = {
      downloadAndInstall: vi.fn().mockRejectedValue(new Error("download failed")),
    };

    await expect(installAvailableUpdate(update)).rejects.toThrow("download failed");
    expect(relaunchMock).not.toHaveBeenCalled();
  });
});
