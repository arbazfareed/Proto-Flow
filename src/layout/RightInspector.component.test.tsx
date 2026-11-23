import { act, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createEmptyProject } from "../project/schema";
import type { Widget } from "../project/schema";
import { useStore } from "../store";
import { renderWithProviders } from "../test/render";
import { RightInspector } from "./ShellComponents";

function createButton(): Widget {
  return {
    id: crypto.randomUUID(),
    type: "button",
    x: 0,
    y: 0,
    width: 120,
    height: 40,
    rotation: 0,
    opacity: 1,
    visible: true,
    locked: false,
    zIndex: 0,
    style: {},
    props: { label: "Buy now" },
  };
}

function renderInspector() {
  return renderWithProviders(
    <RightInspector onToggle={vi.fn()} onUpdates={vi.fn()} onRename={vi.fn()} tutorialProjectId={null} />,
  );
}

describe("RightInspector selection (B48)", () => {
  let button: Widget;

  beforeEach(() => {
    const project = createEmptyProject();
    button = createButton();
    project.screens[0].widgets.push(button);
    useStore.getState().setProject(project);
    useStore.setState({ rightPanelOpen: true, inspectorTab: "design" });
    useStore.getState().clearSelection();
  });

  it("shows project details and updates when nothing is selected", () => {
    renderInspector();
    expect(screen.getByText("PROJECT DETAILS")).toBeTruthy();
    expect(screen.getByText("UPDATES")).toBeTruthy();
    expect(screen.getByLabelText("Project name")).toBeTruthy();
  });

  it("hides project details and updates while a widget is selected", () => {
    renderInspector();
    act(() => useStore.getState().select([button.id]));
    expect(screen.queryByText("PROJECT DETAILS")).toBeNull();
    expect(screen.queryByText("UPDATES")).toBeNull();
    expect(screen.queryByLabelText("Project name")).toBeNull();
    expect(screen.getByRole("tablist", { name: "Inspector panels" })).toBeTruthy();
  });

  it("brings project details back when the selection is cleared", () => {
    renderInspector();
    act(() => useStore.getState().select([button.id]));
    act(() => useStore.getState().clearSelection());
    expect(screen.getByText("PROJECT DETAILS")).toBeTruthy();
  });

  it("scrolls the panel back to the top when a widget is selected", () => {
    const { container } = renderInspector();
    const dock = container.querySelector(".right-dock") as HTMLElement;
    dock.scrollTop = 400;
    expect(dock.scrollTop).toBe(400);
    act(() => useStore.getState().select([button.id]));
    expect(dock.scrollTop).toBe(0);
  });
});
