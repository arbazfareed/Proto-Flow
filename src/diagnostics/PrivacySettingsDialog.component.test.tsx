import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { renderWithProviders } from "../test/render";
import { PrivacySettingsDialog } from "./PrivacySettingsDialog";

function renderDialog(firstLaunch = false) {
  const onClose = vi.fn();
  renderWithProviders(
    <PrivacySettingsDialog firstLaunch={firstLaunch} theme="system" onThemeChange={vi.fn()} onClose={onClose} />,
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
