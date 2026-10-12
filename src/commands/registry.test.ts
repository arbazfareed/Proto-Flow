import { describe, expect, it, vi } from "vitest";
import { CommandRegistry } from "./registry";

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
});
