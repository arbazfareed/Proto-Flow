import { fireEvent, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { commandRegistry } from "../commands/registry";
import { useStore } from "../store";
import { renderWithProviders } from "../test/render";
import { CommandPalette } from "./CommandPalette";

describe("CommandPalette", () => {
  afterEach(() => {
    useStore.getState().setPaletteOpen(false);
  });

  it("filters registered commands and executes the selected action", async () => {
    const user = userEvent.setup();
    const run = vi.fn();
    const unregister = commandRegistry.register({
      id: "component-test.export",
      label: "Export prototype",
      keywords: ["download"],
      icon: null,
      run,
    });
    useStore.getState().setPaletteOpen(true);
    renderWithProviders(<CommandPalette />);

    await user.type(screen.getByRole("combobox", { name: "Filter commands" }), "download");
    expect(screen.getByText("Export prototype")).toBeInTheDocument();
    expect(screen.queryByText("No results")).not.toBeInTheDocument();

    fireEvent.keyDown(screen.getByRole("combobox", { name: "Filter commands" }), {
      key: "Enter",
    });
    expect(run).toHaveBeenCalledOnce();
    expect(useStore.getState().paletteOpen).toBe(false);
    unregister();
  });

  it("closes on Escape and restores focus to the previously active control", async () => {
    const user = userEvent.setup();
    const opener = document.createElement("button");
    opener.textContent = "Open palette";
    document.body.append(opener);
    opener.focus();
    useStore.getState().setPaletteOpen(true);
    renderWithProviders(<CommandPalette />);

    await user.keyboard("{Escape}");

    expect(screen.queryByRole("dialog", { name: "Command palette" })).not.toBeInTheDocument();
    expect(useStore.getState().paletteOpen).toBe(false);
    expect(opener).toHaveFocus();
    opener.remove();
  });

  it("closes when the user clicks outside the dialog", async () => {
    const user = userEvent.setup();
    useStore.getState().setPaletteOpen(true);
    renderWithProviders(<CommandPalette />);

    await user.click(screen.getByRole("dialog", { name: "Command palette" }).parentElement!);

    expect(useStore.getState().paletteOpen).toBe(false);
  });
});
