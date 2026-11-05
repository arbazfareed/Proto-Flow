import { fireEvent, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { createEmptyProject } from "../project/schema";
import type { Widget } from "../project/schema";
import { useStore } from "../store";
import { renderWithProviders } from "../test/render";
import { WidgetNotesPanel } from "./WidgetNotes";

function createWidget(): Widget {
  return {
    id: crypto.randomUUID(),
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
    props: { text: "Hello" },
  };
}

describe("WidgetNotesPanel", () => {
  it("persists note metadata, tags, and custom fields to the project", async () => {
    const project = createEmptyProject();
    const widget = createWidget();
    project.screens[0].widgets.push(widget);
    useStore.getState().setProject(project);

    renderWithProviders(<WidgetNotesPanel widget={widget} />);
    fireEvent.change(screen.getByLabelText("Description"), { target: { value: "Checkout entry point" } });
    fireEvent.change(screen.getByLabelText("Requirement ID"), { target: { value: "REQ-104" } });
    fireEvent.change(screen.getByLabelText("Priority"), { target: { value: "high" } });
    fireEvent.change(screen.getByLabelText("Status"), { target: { value: "in review" } });
    fireEvent.change(screen.getByLabelText("Tags"), { target: { value: "checkout, accessible, checkout" } });
    fireEvent.blur(screen.getByLabelText("Tags"));
    fireEvent.change(screen.getByLabelText("Custom field name"), { target: { value: "Owner" } });
    fireEvent.change(screen.getByLabelText("Custom field value"), { target: { value: "Design" } });
    fireEvent.click(screen.getByRole("button", { name: "Add custom field" }));

    const savedWidget = useStore.getState().project.screens[0].widgets[0];
    expect(savedWidget.notes).toEqual({
      description: "Checkout entry point",
      requirementId: "REQ-104",
      priority: "high",
      status: "in review",
      tags: ["checkout", "accessible"],
      custom: { Owner: "Design" },
    });
  });

  it("rejects duplicate custom field names", () => {
    const project = createEmptyProject();
    const widget = { ...createWidget(), notes: {
      description: "",
      requirementId: "",
      priority: "low" as const,
      status: "draft" as const,
      tags: [],
      custom: { Owner: "Design" },
    } };
    project.screens[0].widgets.push(widget);
    useStore.getState().setProject(project);

    renderWithProviders(<WidgetNotesPanel widget={widget} />);
    fireEvent.change(screen.getByLabelText("Custom field name"), { target: { value: "Owner" } });
    fireEvent.click(screen.getByRole("button", { name: "Add custom field" }));

    expect(screen.getByRole("alert")).toHaveTextContent("That custom field already exists.");
  });
});
