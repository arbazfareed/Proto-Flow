import { act, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import { createEmptyProject } from "../project/schema";
import type { Widget } from "../project/schema";
import { useStore } from "../store";
import { renderWithProviders } from "../test/render";
import { RightInspector } from "./ShellComponents";

function buttonWidget(): Widget {
  return {
    id: crypto.randomUUID(),
    type: "button",
    x: 20,
    y: 20,
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
    <RightInspector onToggle={() => {}} onUpdates={() => {}} onRename={() => {}} tutorialProjectId={null} />,
  );
}

describe("right inspector with a selected element (B48)", () => {
  let button: Widget;

  beforeEach(() => {
    const project = createEmptyProject("Shop");
    button = buttonWidget();
    project.screens[0].widgets = [button];
    useStore.getState().setProject(project);
    useStore.setState({ rightPanelOpen: true, inspectorTab: "design" });
    useStore.getState().select([]);
  });

  it("shows the project details and the Updates card when nothing is selected", () => {
    renderInspector();

    expect(screen.getByText("PROJECT DETAILS")).toBeInTheDocument();
    expect(screen.getByLabelText("Project name")).toHaveValue("Shop");
    expect(screen.getByText("UPDATES")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Check for updates/ })).toBeInTheDocument();
    expect(screen.getByText(/autosaved on this device/)).toBeInTheDocument();
  });

  it("shows only the selected element's settings, not the project details or the Updates card", () => {
    useStore.getState().select([button.id]);
    renderInspector();

    expect(screen.getByLabelText("Selected element identity")).toBeInTheDocument();
    expect(screen.queryByText("PROJECT DETAILS")).toBeNull();
    expect(screen.queryByLabelText("Project name")).toBeNull();
    expect(screen.queryByText("UPDATES")).toBeNull();
    expect(screen.queryByRole("button", { name: /Check for updates/ })).toBeNull();
    expect(screen.queryByText(/autosaved on this device/)).toBeNull();
    // The footer stays.
    expect(screen.getByText("Project schema")).toBeInTheDocument();
  });

  it("brings the project details back when the selection is cleared", () => {
    useStore.getState().select([button.id]);
    renderInspector();
    expect(screen.queryByText("PROJECT DETAILS")).toBeNull();

    act(() => useStore.getState().select([]));

    expect(screen.getByText("PROJECT DETAILS")).toBeInTheDocument();
  });

  it("scrolls the dock back to the top when an element is selected", () => {
    const { container } = renderInspector();
    const dock = container.querySelector("aside.right-dock") as HTMLElement;
    dock.scrollTop = 480; // scrolled down to the Layers list

    act(() => useStore.getState().select([button.id]));

    expect(dock.scrollTop).toBe(0);
  });

  it("does not jump the dock back to the top while nothing is selected", () => {
    const { container } = renderInspector();
    const dock = container.querySelector("aside.right-dock") as HTMLElement;
    dock.scrollTop = 480;

    act(() => useStore.getState().select([]));

    expect(dock.scrollTop).toBe(480);
  });
});
