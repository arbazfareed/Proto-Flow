import { fireEvent, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { createEmptyProject } from "../project/schema";
import type { Widget } from "../project/schema";
import { useStore } from "../store";
import { renderWithProviders } from "../test/render";
import { WidgetNotesManager } from "./WidgetNotes";

function annotatedWidget(name: string, priority: "low" | "high" = "low"): Widget {
  return {
    id: crypto.randomUUID(),
    name,
    type: "text",
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
    props: { text: name },
    notes: {
      description: `${name} notes`,
      requirementId: "",
      priority,
      status: "draft",
      tags: [],
      custom: {},
    },
  };
}

describe("WidgetNotesManager", () => {
  it("filters notes and applies bulk metadata changes to selected widgets", () => {
    const project = createEmptyProject();
    const first = annotatedWidget("Login", "low");
    const second = annotatedWidget("Checkout", "high");
    project.screens[0].widgets.push(first, second);
    useStore.getState().setProject(project);

    renderWithProviders(<WidgetNotesManager onClose={vi.fn()} />);
    fireEvent.change(screen.getByRole("textbox", { name: "Search notes" }), {
      target: { value: "Checkout" },
    });
    expect(screen.getByRole("button", { name: /Checkout/ })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Login/ })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("checkbox", { name: "Select Checkout" }));
    fireEvent.change(screen.getByRole("textbox", { name: "Bulk add tag" }), {
      target: { value: "release" },
    });
    fireEvent.change(screen.getByRole("combobox", { name: "Bulk set status" }), {
      target: { value: "approved" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Apply" }));

    expect(useStore.getState().project.screens[0].widgets[1].notes).toMatchObject({
      status: "approved",
      tags: ["release"],
    });
    expect(screen.getByText("0 selected")).toBeInTheDocument();
  });

  it("opens a note in the inspector and closes the manager", () => {
    const project = createEmptyProject();
    const widget = annotatedWidget("Login");
    project.screens[0].widgets.push(widget);
    useStore.getState().setProject(project);
    const onClose = vi.fn();

    renderWithProviders(<WidgetNotesManager onClose={onClose} />);
    fireEvent.click(screen.getByRole("button", { name: /Login/ }));

    expect(useStore.getState().selectedIds).toContain(widget.id);
    expect(useStore.getState().inspectorTab).toBe("notes");
    expect(onClose).toHaveBeenCalledOnce();
  });
});
