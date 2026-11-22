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

  it("search also filters the Screens, Import and Status groups (B14)", () => {
    renderWithProviders(
      <ElementLibrary activeTool={null} mode="sidebar" onSelectTool={vi.fn()} onAddScreen={vi.fn()} />,
    );
    const search = screen.getByRole("searchbox", { name: "Search elements" });

    // Before searching, everything is listed.
    expect(screen.getAllByRole("button", { name: /^Create .* screen$/ })).toHaveLength(5);
    expect(screen.getByRole("region", { name: "Status indicators" })).toBeVisible();

    fireEvent.change(search, { target: { value: "text" } });
    expect(screen.queryByRole("button", { name: /^Create .* screen$/ })).toBeNull();
    expect(screen.queryByRole("region", { name: "Screens" })).toBeNull();
    expect(screen.queryByRole("region", { name: "Status indicators" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Image URL import" })).toBeNull();
    expect(screen.getByRole("button", { name: "Add Text" })).toBeVisible();

    // Screens can still be found by their own words.
    fireEvent.change(search, { target: { value: "mobile" } });
    expect(screen.getAllByRole("button", { name: /^Create .* screen$/ })).toHaveLength(1);
    expect(screen.getByRole("button", { name: "Create Mobile screen" })).toBeVisible();

    fireEvent.change(search, { target: { value: "zzzz" } });
    expect(screen.getByRole("status").textContent).toContain("No elements match");
  });

  it("explains expert elements in plain words in the tooltip, the info panel and the search (B64)", () => {
    renderWithProviders(
      <ElementLibrary activeTool={null} mode="sidebar" onSelectTool={vi.fn()} onAddScreen={vi.fn()} />,
    );
    const repeater = screen.getByRole("button", { name: "Add Repeater" });
    expect(repeater.getAttribute("title")).toContain("A list that repeats one design for each item.");

    fireEvent.click(screen.getByRole("button", { name: "Show Repeater code tips" }));
    expect(screen.getByText("In plain words:")).toBeVisible();
    expect(screen.getByText(/A list that repeats one design/)).toBeVisible();

    // The search also understands the plain words, so "repeats" finds the Repeater.
    fireEvent.change(screen.getByRole("searchbox", { name: "Search elements" }), { target: { value: "repeats" } });
    expect(screen.getByRole("button", { name: "Add Repeater" })).toBeVisible();
    expect(screen.queryByRole("button", { name: "Add Skeleton" })).toBeNull();
  });
});
