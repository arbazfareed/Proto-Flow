import { fireEvent, screen, waitFor } from "@testing-library/react";
import type { Update } from "@tauri-apps/plugin-updater";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderWithProviders } from "../test/render";
import { UpdateToast } from "./UpdateToast";

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

  it("shows a clear error if the update check fails", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    checkForUpdate.mockRejectedValue(new Error("network unavailable"));
    renderWithProviders(<UpdateToast requestId={1} />);

    expect(await screen.findByRole("alert")).toHaveTextContent("Update check failed");
    expect(screen.getByRole("alert")).toHaveTextContent("Check your connection and try again.");
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
