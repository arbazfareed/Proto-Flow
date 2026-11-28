import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { renderWithProviders } from "../test/render";
import { PrivacySettingsDialog } from "./PrivacySettingsDialog";

function renderDialog(firstLaunch = false, onThemeChange = vi.fn(), onShowOnboarding = vi.fn()) {
  const onClose = vi.fn();
  renderWithProviders(
    <PrivacySettingsDialog
      firstLaunch={firstLaunch}
      theme="system"
      onThemeChange={onThemeChange}
      onClose={onClose}
      onShowOnboarding={onShowOnboarding}
    />,
  );
  return { onClose, onShowOnboarding };
}

describe("Settings dialog navigation and accessibility", () => {
  it("opens on General and exposes Appearance, onboarding, and keyboard shortcuts", () => {
    renderDialog();
    expect(screen.getByRole("dialog", { name: "Settings" })).toBeVisible();
    expect(screen.getByRole("button", { name: /General/ })).toHaveAttribute("aria-current", "page");
    expect(screen.getByRole("combobox", { name: "Workspace appearance" })).toHaveValue("system");
    expect(screen.getByRole("button", { name: "Show again" })).toBeVisible();
    expect(screen.getByLabelText("Keyboard shortcuts")).toBeVisible();
  });

  it("changes the theme immediately from General settings", async () => {
    const user = userEvent.setup();
    const onThemeChange = vi.fn();
    renderDialog(false, onThemeChange);
    await user.selectOptions(screen.getByRole("combobox", { name: "Workspace appearance" }), "dark");
    expect(onThemeChange).toHaveBeenCalledWith("dark");
  });

  it("opens Privacy and retains the existing consent and diagnostics controls", async () => {
    const user = userEvent.setup();
    renderDialog();
    await user.click(screen.getByRole("button", { name: /^Privacy$/ }));
    expect(screen.getByRole("heading", { name: "Privacy & diagnostics" })).toBeVisible();
    expect(screen.getByRole("checkbox", { name: /Send sanitized crash reports/ })).not.toBeChecked();
    expect(screen.getByRole("checkbox", { name: /Send anonymous feature usage/ })).not.toBeChecked();
    expect(screen.getByRole("button", { name: "Export logs" })).toBeVisible();
    expect(screen.getByRole("button", { name: "Save choices" })).toBeVisible();
  });

  it("opens About and shows the application version", async () => {
    const user = userEvent.setup();
    renderDialog();
    await user.click(screen.getByRole("button", { name: /^About$/ }));
    expect(screen.getByRole("heading", { name: "ProtoFlow" })).toBeVisible();
    expect(screen.getByText("Version")).toBeVisible();
  });

  it("runs the existing onboarding action", async () => {
    const user = userEvent.setup();
    const { onShowOnboarding } = renderDialog();
    await user.click(screen.getByRole("button", { name: "Show again" }));
    expect(onShowOnboarding).toHaveBeenCalledOnce();
  });

  it("closes Settings with Escape", async () => {
    const user = userEvent.setup();
    const { onClose } = renderDialog();
    await user.keyboard("{Escape}");
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("does not close on first launch, where a privacy choice is required", async () => {
    const user = userEvent.setup();
    const { onClose } = renderDialog(true);
    await user.keyboard("{Escape}");
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByRole("dialog", { name: "Choose what you share" })).toBeVisible();
    expect(screen.queryByRole("combobox", { name: "Workspace appearance" })).toBeNull();
  });
});
