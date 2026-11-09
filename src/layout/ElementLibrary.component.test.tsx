import { fireEvent, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { renderWithProviders } from "../test/render";
import { ElementLibrary } from "./ElementLibrary";

describe("ElementLibrary imported code shortcuts", () => {
  it("searches the catalog by element names and exposes the audio element", () => {
    renderWithProviders(
      <ElementLibrary
        activeTool={null}
        mode="sidebar"
        onSelectTool={vi.fn()}
        onAddScreen={vi.fn()}
      />,
    );

    fireEvent.change(screen.getByRole("searchbox", { name: "Search elements" }), {
      target: { value: "date" },
    });

    expect(screen.getByRole("button", { name: "Add Date picker" })).toBeVisible();
    expect(screen.queryByRole("button", { name: "Add Video" })).toBeNull();
    fireEvent.change(screen.getByRole("searchbox", { name: "Search elements" }), {
      target: { value: "audio" },
    });
    expect(screen.getByRole("button", { name: "Add Audio player" })).toBeVisible();
  });

  it("searches and selects the remaining integration and mobile library elements", () => {
    const onSelectTool = vi.fn();
    renderWithProviders(
      <ElementLibrary
        activeTool={null}
        mode="sidebar"
        onSelectTool={onSelectTool}
        onAddScreen={vi.fn()}
      />,
    );

    const search = screen.getByRole("searchbox", { name: "Search elements" });
    const elements = [
      ["Image gallery", "image-gallery"],
      ["App bar", "app-bar"],
      ["Floating action button", "fab"],
      ["Pull to refresh", "pull-to-refresh"],
      ["Swipe gesture", "swipe-gesture"],
      ["API request", "api-request"],
      ["Database", "database"],
      ["Cloud sync", "cloud-sync"],
      ["WebSocket", "websocket"],
      ["Auth state", "auth-state"],
      ["Settings", "settings"],
      ["Theme", "theme"],
      ["Responsive device switch", "responsive-switch"],
    ] as const;

    for (const [label, tool] of elements) {
      fireEvent.change(search, { target: { value: label } });
      const button = screen.getByRole("button", { name: `Add ${label}` });
      expect(button).toBeVisible();
      fireEvent.click(button);
      expect(onSelectTool).toHaveBeenLastCalledWith(tool);
    }
  });

  it("shows imported native tools in their categories and selects them as drawing tools", () => {
    const onSelectTool = vi.fn();
    renderWithProviders(
      <ElementLibrary
        activeTool={null}
        unlockedTools={["table", "date-picker", "video"]}
        mode="sidebar"
        onSelectTool={onSelectTool}
        onAddScreen={vi.fn()}
      />,
    );

    const imported = screen.getByRole("region", { name: "Detected in imported code" });
    const dataGroup = within(imported).getByRole("group", { name: "Data" });
    const formGroup = within(imported).getByRole("group", { name: "Forms" });
    const displayGroup = within(imported).getByRole("group", { name: "Display" });
    const tableButton = within(dataGroup).getByRole("button", { name: "Add Table" });

    expect(tableButton).toBeVisible();
    expect(within(formGroup).getByRole("button", { name: "Add Date picker" })).toBeVisible();
    expect(within(displayGroup).getByRole("button", { name: "Add Video" })).toBeVisible();
    expect(tableButton).toHaveAttribute("draggable", "true");

    fireEvent.click(tableButton);

    expect(onSelectTool).toHaveBeenCalledWith("table");
  });

  it("does not show an imported-code section before semantic tools are discovered", () => {
    renderWithProviders(
      <ElementLibrary
        activeTool={null}
        mode="sidebar"
        onSelectTool={vi.fn()}
        onAddScreen={vi.fn()}
      />,
    );

    expect(screen.queryByRole("region", { name: "Detected in imported code" })).toBeNull();
  });
});
