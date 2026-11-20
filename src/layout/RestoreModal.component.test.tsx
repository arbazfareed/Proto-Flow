import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it } from "vitest";
import { AUTOSAVE_KEY } from "../project/autosave";
import { createEmptyProject } from "../project/schema";
import { resetSessionTrackingForTests, startSessionTracking } from "../project/sessionExit";
import { useStore } from "../store";
import { renderWithProviders } from "../test/render";
import { RestoreModal } from "./RestoreModal";

describe("RestoreModal", () => {
  afterEach(() => {
    resetSessionTrackingForTests();
    localStorage.removeItem("proto-flow-session-state");
  });

  function seedSnapshot(name: string) {
    localStorage.setItem(AUTOSAVE_KEY, JSON.stringify({ project: createEmptyProject(name), ts: Date.now() }));
  }

  it("asks to restore unsaved work, without saying crash, after a normal close or reload (B35)", async () => {
    seedSnapshot("Reloaded project");
    localStorage.setItem("proto-flow-session-state", "clean");
    startSessionTracking();
    renderWithProviders(<RestoreModal />);

    const dialog = await screen.findByRole("dialog", { name: "Restore unsaved work?" });
    expect(dialog).toHaveTextContent("UNSAVED WORK");
    expect(dialog).toHaveTextContent("Proto Flow found unsaved changes");
    expect(dialog).not.toHaveTextContent(/crash/i);
    expect(dialog).not.toHaveTextContent("did not close properly");
  });

  it("says crash only when the last session really ended without closing (B35)", async () => {
    seedSnapshot("Crashed project");
    localStorage.setItem("proto-flow-session-state", "running");
    startSessionTracking();
    renderWithProviders(<RestoreModal />);

    const dialog = await screen.findByRole("dialog", { name: "Restore unsaved work?" });
    expect(dialog).toHaveTextContent("CRASH RECOVERY");
    expect(dialog).toHaveTextContent("Proto Flow did not close properly last time");
  });

  it("does not say crash on a first start, when nothing is known", async () => {
    seedSnapshot("First start project");
    renderWithProviders(<RestoreModal />);

    const dialog = await screen.findByRole("dialog", { name: "Restore unsaved work?" });
    expect(dialog).toHaveTextContent("UNSAVED WORK");
    expect(dialog).not.toHaveTextContent(/crash/i);
  });

  it("restores a valid autosave and keeps a fresh recovery snapshot", async () => {
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
    // Closing the app straight after restoring must not lose the project.
    const kept = JSON.parse(localStorage.getItem(AUTOSAVE_KEY) ?? "null");
    expect(kept?.project.name).toBe("Recovered project");
    expect(kept?.filePath).toBe("C:\\designs\\recovered.pflow");
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
