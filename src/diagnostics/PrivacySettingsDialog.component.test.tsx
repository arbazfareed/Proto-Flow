import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { renderWithProviders } from "../test/render";
import { PrivacySettingsDialog } from "./PrivacySettingsDialog";

function renderDialog(firstLaunch = false, onThemeChange = vi.fn()) {
  const onClose = vi.fn();
  renderWithProviders(
    <PrivacySettingsDialog firstLaunch={firstLaunch} theme="system" onThemeChange={onThemeChange} onClose={onClose} />,
  );
  return onClose;
}

describe("PrivacySettingsDialog Escape (B54)", () => {
  it("closes Settings when Escape is pressed", async () => {
    const user = userEvent.setup();
    const onClose = renderDialog();
    expect(screen.getByRole("dialog")).toBeVisible();
    await user.keyboard("{Escape}");
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("does not close on first launch, where a choice is required", async () => {
    const user = userEvent.setup();
    const onClose = renderDialog(true);
    await user.keyboard("{Escape}");
    expect(onClose).not.toHaveBeenCalled();
  });
});

describe("PrivacySettingsDialog sections (B54)", () => {
  it("is a Settings dialog with Appearance as its own section before Privacy & diagnostics", () => {
    renderDialog();
    expect(screen.getByRole("dialog", { name: "Settings" })).toBeVisible();
    expect(screen.getAllByRole("heading", { level: 3 }).map((heading) => heading.textContent))
      .toEqual(["Appearance", "Privacy & diagnostics"]);

    const theme = screen.getByRole("combobox", { name: "Workspace appearance" });
    const privacyHeading = screen.getByRole("heading", { name: "Privacy & diagnostics" });
    const crashReports = screen.getByRole("checkbox", { name: /Send sanitized crash reports/ });
    expect(theme.compareDocumentPosition(privacyHeading) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(privacyHeading.compareDocumentPosition(crashReports) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("still changes the theme from the Appearance section", async () => {
    const user = userEvent.setup();
    const onThemeChange = vi.fn();
    renderDialog(false, onThemeChange);
    await user.selectOptions(screen.getByRole("combobox", { name: "Workspace appearance" }), "dark");
    expect(onThemeChange).toHaveBeenCalledWith("dark");
  });

  it("keeps the first-launch prompt about privacy only", () => {
    renderDialog(true);
    expect(screen.getByRole("dialog", { name: "Choose what you share" })).toBeVisible();
    expect(screen.queryByRole("combobox", { name: "Workspace appearance" })).toBeNull();
    expect(screen.queryAllByRole("heading", { level: 3 })).toHaveLength(0);
    expect(screen.queryByRole("button", { name: "Close settings" })).toBeNull();
  });
});
