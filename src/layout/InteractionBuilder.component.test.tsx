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
