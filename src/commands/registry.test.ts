import { describe, expect, it, vi } from "vitest";
import { CommandRegistry, createCoreCommands } from "./registry";

describe("command registry", () => {
  it("notifies subscribers as commands register and unregister", () => {
    const registry = new CommandRegistry();
    const listener = vi.fn();
    const unsubscribe = registry.subscribe(listener);
    const command = {
      id: "test.command",
      label: "Test command",
      icon: null,
      run: vi.fn(),
    };

    const unregister = registry.register(command);
    expect(registry.getSnapshot()).toEqual([command]);
    expect(listener).toHaveBeenCalledTimes(1);

    unregister();
    expect(registry.getSnapshot()).toEqual([]);
    expect(listener).toHaveBeenCalledTimes(2);

    unsubscribe();
  });

  it("rejects duplicate command ids", () => {
    const registry = new CommandRegistry();
    registry.register({ id: "duplicate", label: "One", icon: null, run: vi.fn() });

    expect(() =>
      registry.register({ id: "duplicate", label: "Two", icon: null, run: vi.fn() }),
    ).toThrow('A command with id "duplicate" is already registered.');
  });

  it("routes each core command to its matching application action", async () => {
    const actions = {
      newProject: vi.fn(),
      openProject: vi.fn(),
      saveProject: vi.fn(),
      undo: vi.fn(),
      redo: vi.fn(),
      toggleGrid: vi.fn(),
      toggleSnap: vi.fn(),
      checkForUpdates: vi.fn(),
      openPlugins: vi.fn(),
      openVersionHistory: vi.fn(),
      createCheckpoint: vi.fn(),
    };
    const commands = new Map(
      createCoreCommands(actions).map((command) => [command.id, command]),
    );

    for (const id of [
      "project.new",
      "project.open",
      "project.save",
      "project.save-as",
      "project.version-history",
      "project.checkpoint",
      "edit.undo",
      "edit.redo",
      "canvas.toggle-grid",
      "canvas.toggle-snap",
      "app.check-updates",
      "app.plugins",
    ]) {
      await commands.get(id)?.run();
    }

    expect(actions.newProject).toHaveBeenCalledOnce();
    expect(actions.openProject).toHaveBeenCalledOnce();
    expect(actions.saveProject.mock.calls).toEqual([[], [true]]);
    expect(actions.undo).toHaveBeenCalledOnce();
    expect(actions.redo).toHaveBeenCalledOnce();
    expect(actions.toggleGrid).toHaveBeenCalledOnce();
    expect(actions.toggleSnap).toHaveBeenCalledOnce();
    expect(actions.checkForUpdates).toHaveBeenCalledOnce();
    expect(actions.openPlugins).toHaveBeenCalledOnce();
    expect(actions.openVersionHistory).toHaveBeenCalledOnce();
    expect(actions.createCheckpoint).toHaveBeenCalledOnce();
  });
});
