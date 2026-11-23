import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { STARTER_TEMPLATE_IDS } from "../onboarding/templates";
import { renderWithProviders } from "../test/render";
import { NewProjectDialog } from "./NewProjectDialog";

function renderDialog() {
  const onSelect = vi.fn();
  const onClose = vi.fn();
  renderWithProviders(<NewProjectDialog onSelect={onSelect} onClose={onClose} />);
  return { onSelect, onClose };
}

describe("NewProjectDialog (B61)", () => {
  it("offers Blank first and every starter template", () => {
    renderDialog();
    expect(screen.getByRole("dialog", { name: "Pick a starting point" })).toBeVisible();
    const cards = screen.getAllByRole("button", { name: /^Start from / });
    expect(cards).toHaveLength(STARTER_TEMPLATE_IDS.length);
    expect(cards[0].getAttribute("aria-label")).toBe("Start from Blank project");
    expect(screen.getByRole("button", { name: "Start from Dashboard" })).toBeVisible();
  });

  it("creates from the template that was picked", async () => {
    const user = userEvent.setup();
    const { onSelect, onClose } = renderDialog();
    await user.click(screen.getByRole("button", { name: "Start from Dashboard" }));
    expect(onSelect).toHaveBeenCalledWith("dashboard");
    expect(onClose).not.toHaveBeenCalled();
  });

  it("closes without creating on Escape and on Cancel", async () => {
    const user = userEvent.setup();
    const { onSelect, onClose } = renderDialog();
    await user.keyboard("{Escape}");
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onClose).toHaveBeenCalledTimes(2);
    expect(onSelect).not.toHaveBeenCalled();
  });
});
