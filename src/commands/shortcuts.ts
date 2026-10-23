export interface ShortcutActions {
  paletteOpen: boolean;
  togglePalette: () => void;
  closePalette: () => void;
  saveProject: (saveAs?: boolean) => void;
  createCheckpoint: () => void;
  undo: () => void;
  redo: () => void;
  newProject: () => void;
  openProject: () => void;
  toggleGrid: () => void;
  toggleSnap: () => void;
}

export interface ShortcutEvent {
  key: string;
  code: string;
  ctrlKey: boolean;
  metaKey: boolean;
  shiftKey: boolean;
  target: EventTarget | null;
  preventDefault: () => void;
}

function isEditingTarget(target: EventTarget | null): boolean {
  if (!target || typeof target !== "object") return false;
  if (!("tagName" in target)) return false;

  const element = target as EventTarget & {
    tagName: string;
    isContentEditable?: boolean;
  };
  return Boolean(
    element.isContentEditable ||
      ["INPUT", "TEXTAREA", "SELECT"].includes(element.tagName),
  );
}

export function handleGlobalShortcut(
  event: ShortcutEvent,
  actions: ShortcutActions,
): void {
  const modifier = event.metaKey || event.ctrlKey;
  const key = event.key.toLowerCase();

  if (modifier && key === "k") {
    event.preventDefault();
    actions.togglePalette();
    return;
  }

  if (key === "escape" && actions.paletteOpen) {
    actions.closePalette();
    return;
  }

  if (!modifier) return;

  const editing = isEditingTarget(event.target);
  if (key === "s" && event.shiftKey) {
    event.preventDefault();
    if (!editing) actions.createCheckpoint();
    return;
  }

  if (key === "s") {
    event.preventDefault();
    actions.saveProject(false);
    return;
  }

  if (!editing && key === "z") {
    event.preventDefault();
    if (event.shiftKey) actions.redo();
    else actions.undo();
  } else if (!editing && key === "y") {
    event.preventDefault();
    actions.redo();
  } else if (key === "n") {
    event.preventDefault();
    actions.newProject();
  } else if (key === "o") {
    event.preventDefault();
    actions.openProject();
  } else if ((key === "'" || event.code === "Quote") && !editing) {
    event.preventDefault();
    if (event.shiftKey) actions.toggleSnap();
    else actions.toggleGrid();
  }
}
