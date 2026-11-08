import { fireEvent, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { renderWithProviders } from "../test/render";
import { ElementLibrary } from "./ElementLibrary";

describe("ElementLibrary imported code shortcuts", () => {
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
