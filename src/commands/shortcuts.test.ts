import { describe, expect, it, vi } from "vitest";
import {
  handleGlobalShortcut,
  type ShortcutActions,
  type ShortcutEvent,
} from "./shortcuts";

function createActions(): ShortcutActions {
  return {
    paletteOpen: false,
    togglePalette: vi.fn(),
    closePalette: vi.fn(),
    saveProject: vi.fn(),
    undo: vi.fn(),
    redo: vi.fn(),
    newProject: vi.fn(),
    openProject: vi.fn(),
    toggleGrid: vi.fn(),
  };
}

function createEvent(
  key: string,
  options: Partial<KeyboardEvent> = {},
): ShortcutEvent {
  const eventTarget = options.target ?? new EventTarget();
  return {
    key,
    code: options.code ?? "",
    ctrlKey: options.ctrlKey ?? true,
    metaKey: options.metaKey ?? false,
    shiftKey: options.shiftKey ?? false,
    target: eventTarget,
    preventDefault: vi.fn(),
  };
}

describe("global keyboard shortcuts", () => {
  it("toggles the palette on Ctrl/Cmd+K", () => {
    const actions = createActions();
    const event = createEvent("k", { metaKey: true, ctrlKey: false });

    handleGlobalShortcut(event, actions);

    expect(event.preventDefault).toHaveBeenCalledOnce();
    expect(actions.togglePalette).toHaveBeenCalledOnce();
  });

  it("routes save, undo and redo shortcuts", () => {
    const actions = createActions();

    handleGlobalShortcut(createEvent("s", { shiftKey: true }), actions);
    handleGlobalShortcut(createEvent("z"), actions);
    handleGlobalShortcut(createEvent("z", { shiftKey: true }), actions);
    handleGlobalShortcut(createEvent("y"), actions);

    expect(actions.saveProject).toHaveBeenCalledWith(true);
    expect(actions.undo).toHaveBeenCalledOnce();
    expect(actions.redo).toHaveBeenCalledTimes(2);
  });

  it("routes grid, new-project, and open-project shortcuts", () => {
    const actions = createActions();

    handleGlobalShortcut(createEvent("'", { code: "Quote" }), actions);
    handleGlobalShortcut(createEvent("n"), actions);
    handleGlobalShortcut(createEvent("o"), actions);

    expect(actions.toggleGrid).toHaveBeenCalledOnce();
    expect(actions.newProject).toHaveBeenCalledOnce();
    expect(actions.openProject).toHaveBeenCalledOnce();
  });

  it("does not run editing shortcuts in text inputs", () => {
    const actions = createActions();
    const target = Object.assign(new EventTarget(), { tagName: "INPUT" });
    const event = createEvent("z", { target });

    handleGlobalShortcut(event, actions);

    expect(actions.undo).not.toHaveBeenCalled();
    expect(event.preventDefault).not.toHaveBeenCalled();
  });

  it("closes an open palette on Escape", () => {
    const actions = { ...createActions(), paletteOpen: true };

    handleGlobalShortcut(createEvent("Escape", { ctrlKey: false }), actions);

    expect(actions.closePalette).toHaveBeenCalledOnce();
  });
});
