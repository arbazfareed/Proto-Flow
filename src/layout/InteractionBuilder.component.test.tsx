import { fireEvent, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { createEmptyProject } from "../project/schema";
import type { Widget } from "../project/schema";
import { useStore } from "../store";
import { renderWithProviders } from "../test/render";
import { MeteredActionProvider } from "../wallet/meteredActions";
import { InteractionBuilder } from "./InteractionBuilder";

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
    props: { text: "Go" },
  };
}

function renderBuilder() {
  const project = createEmptyProject();
  const widget = createButton();
  project.screens[0].widgets.push(widget);
  project.screens.push({ ...structuredClone(project.screens[0]), id: crypto.randomUUID(), name: "Second", widgets: [] });
  useStore.getState().setProject(project);
  renderWithProviders(
    <MeteredActionProvider>
      <InteractionBuilder project={project} screen={project.screens[0]} widget={widget} />
    </MeteredActionProvider>,
  );
  return { project };
}

describe("InteractionBuilder unfinished rules (B51)", () => {
  it("outlines the empty target and names it in the note, then clears both once a target is chosen", () => {
    const { project } = renderBuilder();
    const rules = screen.getByRole("region", { name: "Interaction rules" });
    fireEvent.click(within(rules).getByRole("button", { name: "Add rule" }));

    const target = within(rules).getByRole("combobox", { name: "Action target" });
    expect(target).toHaveAttribute("aria-invalid", "true");
    expect(within(rules).getByText(/Not active yet: choose a target in the field outlined in red/)).toBeInTheDocument();

    fireEvent.change(target, { target: { value: project.screens[1].id } });
    expect(within(rules).getByRole("combobox", { name: "Action target" })).not.toHaveAttribute("aria-invalid");
    expect(within(rules).queryByText(/Not active yet/)).not.toBeInTheDocument();
  });
});

describe("InteractionBuilder new actions (B49)", () => {
  it("offers Go back, Open link and Toggle, with the right field for each", () => {
    renderBuilder();
    const rules = screen.getByRole("region", { name: "Interaction rules" });
    fireEvent.click(within(rules).getByRole("button", { name: "Add rule" }));
    const type = within(rules).getByRole("combobox", { name: "Action type" });
    const labels = Array.from(type.querySelectorAll("option")).map((option) => option.textContent);
    expect(labels).toEqual(expect.arrayContaining(["Go back", "Open link", "Toggle show/hide"]));

    // Open link takes an address, outlined until one is typed.
    fireEvent.change(type, { target: { value: "openLink" } });
    const link = within(rules).getByRole("textbox", { name: "Link address" });
    expect(link).toHaveAttribute("aria-invalid", "true");
    fireEvent.change(link, { target: { value: "example.com" } });
    expect(within(rules).getByRole("textbox", { name: "Link address" })).not.toHaveAttribute("aria-invalid");

    // Go back needs no target at all.
    fireEvent.change(within(rules).getByRole("combobox", { name: "Action type" }), { target: { value: "goBack" } });
    expect(within(rules).getByText("Returns to the previous screen")).toBeInTheDocument();
    expect(within(rules).queryByRole("combobox", { name: "Action target" })).toBeNull();

    // Toggle picks a widget like Show and Hide do.
    fireEvent.change(within(rules).getByRole("combobox", { name: "Action type" }), { target: { value: "toggle" } });
    expect(within(rules).getByRole("combobox", { name: "Action target" })).toBeInTheDocument();
  });
});

