import { fireEvent, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useWalletStore } from "../wallet/store";
import { renderWithProviders } from "../test/render";
import { MeteredActionProvider } from "../wallet/meteredActions";
import { ReactCodeExportDialog } from "./ReactCodeExportDialog";
import { TopBar } from "./ShellComponents";

function renderTopBar(onOpenPrivacySettings = () => undefined) {
  const noop = () => undefined;
  return renderWithProviders(
    <TopBar
      onRenameProject={noop}
      onNew={noop}
      onOpen={noop}
      onSave={noop}
      onSaveAs={noop}
      onUndo={noop}
      onRedo={noop}
      onOpenPalette={noop}
      onOpenPreview={noop}
      onImportCode={noop}
      onPublishCloudPreview={noop}
      onOpenCollaboration={noop}
      onExportReactCode={noop}
      onExportHtml={noop}
      onOpenWallet={noop}
      onOpenPrivacySettings={onOpenPrivacySettings}
      onOpenBetaFeedback={noop}
      onNotify={vi.fn()}
      onStartDragging={noop}
      onWindowAction={noop}
    />,
  );
}

describe("Settings remains reachable from the top bar", () => {
  it("places the Settings icon before crowded toolbar actions and opens the dialog", () => {
    const onOpenSettings = vi.fn();
    renderTopBar(onOpenSettings);
    const settingsButton = screen.getByRole("button", { name: "Open settings" });
    const actions = settingsButton.parentElement;
    expect(actions?.classList.contains("topbar-actions")).toBe(true);
    expect(actions?.firstElementChild).toBe(settingsButton);
    fireEvent.click(settingsButton);
    expect(onOpenSettings).toHaveBeenCalledOnce();
  });
});

describe("credits are not shown as 0 when the balance is unknown (B15)", () => {
  beforeEach(() => {
    useWalletStore.setState({
      status: "loading",
      networkStatus: "offline",
      balance: 0,
      lastSyncedAt: null,
      error: null,
    });
  });

  it("shows no number before a balance has loaded, and says so in the menu", () => {
    renderTopBar();
    expect(screen.queryByText(/\b0 Credits\b/i)).toBeNull();
    const pill = screen.getByRole("button", { name: "Credits not loaded yet; open wallet details" });
    expect(pill).toHaveTextContent(/^Credits$/);

    fireEvent.click(pill);
    expect(screen.getByText("Credits not loaded yet")).toBeInTheDocument();
    expect(screen.queryByText(/Lifetime granted/)).toBeNull();
    // The way into wallet settings and sign-in stays available.
    expect(screen.getByRole("button", { name: "Wallet settings" })).toBeInTheDocument();
  });

  it("shows the real balance once the wallet has synced, including a genuine 0", () => {
    useWalletStore.setState({ status: "online", networkStatus: "online", balance: 50, lastSyncedAt: Date.now() });
    const { unmount } = renderTopBar();
    expect(screen.getByRole("button", { name: "50 credits; open wallet details" })).toHaveTextContent("50 Credits");
    unmount();

    useWalletStore.setState({ balance: 0 });
    renderTopBar();
    expect(screen.getByRole("button", { name: "0 credits; open wallet details" })).toHaveTextContent("0 Credits");
  });
});

describe("the React export dialog says which export is cloud and which is free (B15)", () => {
  it("explains why the ZIP uses credits and that the local exports never do", () => {
    renderWithProviders(
      <MeteredActionProvider>
        <ReactCodeExportDialog onClose={() => undefined} />
      </MeteredActionProvider>,
    );
    expect(screen.getByText(/ZIP export costs 3 credits/)).toBeInTheDocument();
    expect(screen.getByText(/built in the cloud, which is why it uses credits/)).toBeInTheDocument();
    expect(screen.getByText(/never use credits/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Export fixed-layout JSX (free)" })).toBeInTheDocument();
  });
});
