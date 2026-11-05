import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { AUTOSAVE_KEY } from "../project/autosave";
import { createEmptyProject } from "../project/schema";
import { useStore } from "../store";
import { renderWithProviders } from "../test/render";
import { RestoreModal } from "./RestoreModal";

describe("RestoreModal", () => {
  it("restores a valid autosave and removes the recovery snapshot", async () => {
    const user = userEvent.setup();
    const project = createEmptyProject("Recovered project");
    localStorage.setItem(AUTOSAVE_KEY, JSON.stringify({
      project,
      ts: Date.now(),
      filePath: "C:\\designs\\recovered.pflow",
    }));
    renderWithProviders(<RestoreModal />);

    await user.click(await screen.findByRole("button", { name: /Restore project/ }));

    expect(useStore.getState().project.name).toBe("Recovered project");
    expect(useStore.getState().filePath).toBe("C:\\designs\\recovered.pflow");
    expect(useStore.getState().isDirty).toBe(true);
    expect(localStorage.getItem(AUTOSAVE_KEY)).toBeNull();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("discards the recovery snapshot without changing the open project", async () => {
    const user = userEvent.setup();
    const originalProject = useStore.getState().project;
    localStorage.setItem(AUTOSAVE_KEY, JSON.stringify({
      project: createEmptyProject("Unwanted recovery"),
      ts: Date.now(),
    }));
    renderWithProviders(<RestoreModal />);

    await user.click(await screen.findByRole("button", { name: "Discard" }));

    expect(useStore.getState().project).toBe(originalProject);
    expect(localStorage.getItem(AUTOSAVE_KEY)).toBeNull();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("does not render a prompt when there is no recovery snapshot", async () => {
    renderWithProviders(<RestoreModal />);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });
});
