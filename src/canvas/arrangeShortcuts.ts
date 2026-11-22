// B47: keyboard shortcuts for arranging widgets (the same actions as the right-click menu).
// Called only while Ctrl (or Cmd) is held.
export type ArrangeShortcut = "group" | "ungroup" | "forward" | "backward" | "front" | "back" | "lock" | "hide";

export function arrangeShortcut(event: { key: string; code?: string; shiftKey?: boolean }): ArrangeShortcut | null {
  const shift = Boolean(event.shiftKey);
  if (event.code === "BracketRight") return shift ? "front" : "forward";
  if (event.code === "BracketLeft") return shift ? "back" : "backward";
  const key = event.key.toLowerCase();
  if (key === "g") return shift ? "ungroup" : "group";
  if (key === "l" && shift) return "lock";
  if (key === "h" && shift) return "hide";
  return null;
}
