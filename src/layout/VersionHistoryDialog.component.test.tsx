import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { createEmptyProject } from "../project/schema";
import { createProjectCheckpoint } from "../project/versionHistory";
import { renderWithProviders } from "../test/render";
import { VersionHistoryDialog } from "./VersionHistoryDialog";

describe("VersionHistoryDialog", () => {
  it("creates and selects a named checkpoint", async () => {
    const user = userEvent.setup();
    const project = createEmptyProject("Prototype");
    const onNotify = vi.fn();
    renderWithProviders(
      <VersionHistoryDialog
        project={project}
        filePath={null}
        isDirty={false}
        onClose={vi.fn()}
        onRestore={vi.fn()}
        onNotify={onNotify}
      />,
    );

    await user.type(screen.getByRole("textbox", { name: "Named checkpoint" }), "Before redesign");
    await user.click(screen.getByRole("button", { name: "Create" }));

    expect(await screen.findByRole("button", { name: /Before redesign/ })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(onNotify).toHaveBeenCalledWith("Checkpoint created");
    expect(screen.getByRole("heading", { name: "Prototype" })).toBeInTheDocument();
  });

  it("restores a selected checkpoint after confirmation and saves a restore point", async () => {
    const user = userEvent.setup();
    const checkpointProject = createEmptyProject("Checkpoint");
    await createProjectCheckpoint(checkpointProject, null, "Baseline", "manual", true);
    const currentProject = { ...checkpointProject, name: "Current version" };
    const onClose = vi.fn();
    const onNotify = vi.fn();
    const onRestore = vi.fn();
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(true);
    renderWithProviders(
      <VersionHistoryDialog
        project={currentProject}
        filePath={null}
        isDirty
        onClose={onClose}
        onRestore={onRestore}
        onNotify={onNotify}
      />,
    );

    await screen.findByRole("heading", { name: "Checkpoint" });
    await user.click(screen.getByRole("button", { name: "Restore" }));

    await waitFor(() => expect(onRestore).toHaveBeenCalledWith(
      expect.objectContaining({ id: currentProject.id, name: "Checkpoint" }),
    ));
    expect(confirm).toHaveBeenCalledOnce();
    expect(onNotify).toHaveBeenCalledWith(
      "Checkpoint restored. Use Undo to return to the previous project state.",
    );
    expect(onClose).toHaveBeenCalledOnce();
    confirm.mockRestore();
  });

  it("closes when the dialog backdrop is clicked", async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    renderWithProviders(
      <VersionHistoryDialog
        project={createEmptyProject()}
        filePath={null}
        isDirty={false}
        onClose={onClose}
        onRestore={vi.fn()}
        onNotify={vi.fn()}
      />,
    );

    await user.click(screen.getByRole("dialog", { name: /Version history/ }).parentElement!);
    expect(onClose).toHaveBeenCalledOnce();
  });
});
