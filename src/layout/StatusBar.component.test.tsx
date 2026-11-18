import { act, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { useWalletStore } from "../wallet/store";
import { renderWithProviders } from "../test/render";
import { StatusBar } from "./ShellComponents";

describe("StatusBar cloud status (B16)", () => {
  it("shows nothing about the cloud for someone who never synced", () => {
    useWalletStore.setState({ networkStatus: "offline", lastSyncedAt: null });
    renderWithProviders(<StatusBar />);
    expect(screen.queryByText(/Sync paused/)).toBeNull();
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("still warns after the wallet has synced before and the network drops", () => {
    useWalletStore.setState({ networkStatus: "offline", lastSyncedAt: Date.now() });
    renderWithProviders(<StatusBar />);
    expect(screen.getByRole("status").textContent).toContain("Sync paused");
  });

  it("shows Cloud connected when online", () => {
    useWalletStore.setState({ networkStatus: "online", lastSyncedAt: null });
    renderWithProviders(<StatusBar />);
    expect(screen.getByRole("status").textContent).toContain("Cloud connected");
    act(() => useWalletStore.setState({ networkStatus: "checking" }));
  });
});
