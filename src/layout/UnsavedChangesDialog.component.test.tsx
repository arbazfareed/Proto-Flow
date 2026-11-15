import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { renderWithProviders } from "../test/render";
import { UnsavedChangesDialog } from "./UnsavedChangesDialog";

function renderDialog(saving = false) {
  const handlers = { onSave: vi.fn(), onDiscard: vi.fn(), onCancel: vi.fn() };
  renderWithProviders(
    <UnsavedChangesDialog projectName="ChatFlow" saving={saving} {...handlers} />,
  );
  return handlers;
}

describe("UnsavedChangesDialog", () => {
  it("names the project and focuses Save so Enter saves", async () => {
    const user = userEvent.setup();
    const handlers = renderDialog();

    expect(screen.getByRole("alertdialog", { name: "Save changes before closing?" })).toBeVisible();
    expect(screen.getByText("ChatFlow")).toBeVisible();
    expect(screen.getByRole("button", { name: "Save" })).toHaveFocus();

    await user.keyboard("{Enter}");
    expect(handlers.onSave).toHaveBeenCalledOnce();
  });

  it("offers Don't save and Cancel, and Escape cancels", async () => {
    const user = userEvent.setup();
    const handlers = renderDialog();

    await user.click(screen.getByRole("button", { name: "Don't save" }));
    expect(handlers.onDiscard).toHaveBeenCalledOnce();

    await user.click(screen.getByRole("button", { name: "Cancel" }));
    await user.keyboard("{Escape}");
    expect(handlers.onCancel).toHaveBeenCalledTimes(2);
  });

  it("disables every choice while saving", () => {
    renderDialog(true);
    expect(screen.getByRole("button", { name: "Saving…" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Don't save" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Cancel" })).toBeDisabled();
  });
});
