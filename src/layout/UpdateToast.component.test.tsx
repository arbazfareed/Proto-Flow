import { act, fireEvent, screen, waitFor } from "@testing-library/react";
import type { Update } from "@tauri-apps/plugin-updater";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderWithProviders } from "../test/render";
import { UPDATE_RESULT_VISIBLE_MS, UpdateToast } from "./UpdateToast";

const { checkForUpdate, installAvailableUpdate } = vi.hoisted(() => ({
  checkForUpdate: vi.fn(),
  installAvailableUpdate: vi.fn(),
}));

vi.mock("../updater/check", () => ({ checkForUpdate }));
vi.mock("../updater/install", () => ({ installAvailableUpdate }));

function fakeUpdate(): Update {
  return {
    version: "2.0.0",
    close: vi.fn().mockResolvedValue(undefined),
  } as unknown as Update;
}

describe("UpdateToast", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  beforeEach(() => {
    checkForUpdate.mockReset();
    installAvailableUpdate.mockReset();
  });

  it("announces an available update, installs it, and tracks installation", async () => {
    const update = fakeUpdate();
    checkForUpdate.mockResolvedValue(update);
    installAvailableUpdate.mockResolvedValue(undefined);
    renderWithProviders(<UpdateToast requestId={1} />);

    expect(await screen.findByText("Proto Flow 2.0.0 is available")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /install update/i }));

    await waitFor(() => expect(installAvailableUpdate).toHaveBeenCalledWith(update));
    expect(screen.queryByText("Update could not be verified or installed. Please try again.")).not.toBeInTheDocument();
  });

  it("shows a clear, dismissible error when a requested update check fails", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    checkForUpdate.mockRejectedValue(new Error("network unavailable"));
    renderWithProviders(<UpdateToast requestId={1} />);

    expect(await screen.findByRole("alert")).toHaveTextContent("Update check failed");
    expect(screen.getByRole("alert")).toHaveTextContent("Check your internet connection and try again later.");
    fireEvent.click(screen.getByRole("button", { name: "Dismiss update message" }));
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("stays silent when the automatic check at startup fails", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    checkForUpdate.mockRejectedValue(new Error("offline"));
    renderWithProviders(<UpdateToast requestId={0} />);

    await waitFor(() => expect(consoleError).toHaveBeenCalled());
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(screen.queryByText("Update check failed")).not.toBeInTheDocument();
  });

  it("says the app is up to date after a requested check, then hides by itself", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      checkForUpdate.mockResolvedValue(null);
      renderWithProviders(<UpdateToast requestId={2} />);

      expect(await screen.findByRole("status")).toHaveTextContent("ProtoFlow is up to date");
      await act(async () => {
        await vi.advanceTimersByTimeAsync(UPDATE_RESULT_VISIBLE_MS + 50);
      });
      expect(screen.queryByText("ProtoFlow is up to date")).not.toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
  });

  it("still announces an update found by the automatic check", async () => {
    checkForUpdate.mockResolvedValue(fakeUpdate());
    renderWithProviders(<UpdateToast requestId={0} />);
    expect(await screen.findByText("Proto Flow 2.0.0 is available")).toBeInTheDocument();
  });

  it("releases a dismissed update", async () => {
    const update = fakeUpdate();
    checkForUpdate.mockResolvedValue(update);
    renderWithProviders(<UpdateToast requestId={1} />);

    fireEvent.click(await screen.findByRole("button", { name: "Dismiss update notification" }));

    await waitFor(() => expect(update.close).toHaveBeenCalledOnce());
    expect(screen.queryByText("Proto Flow 2.0.0 is available")).not.toBeInTheDocument();
  });
});
