import { describe, expect, it } from "vitest";
import { arrangeShortcut } from "./arrangeShortcuts";

describe("arrangeShortcut (B47)", () => {
  it("groups with Ctrl+G and ungroups with Ctrl+Shift+G", () => {
    expect(arrangeShortcut({ key: "g" })).toBe("group");
    expect(arrangeShortcut({ key: "G", shiftKey: true })).toBe("ungroup");
  });

  it("reorders with Ctrl+] and Ctrl+[, and to the front or back with Shift", () => {
    expect(arrangeShortcut({ key: "]", code: "BracketRight" })).toBe("forward");
    expect(arrangeShortcut({ key: "[", code: "BracketLeft" })).toBe("backward");
    expect(arrangeShortcut({ key: "}", code: "BracketRight", shiftKey: true })).toBe("front");
    expect(arrangeShortcut({ key: "{", code: "BracketLeft", shiftKey: true })).toBe("back");
  });

  it("locks with Ctrl+Shift+L only, so Ctrl+L still focuses the address bar", () => {
    expect(arrangeShortcut({ key: "L", shiftKey: true })).toBe("lock");
    expect(arrangeShortcut({ key: "l" })).toBeNull();
  });

  it("hides with Ctrl+Shift+H only, so Ctrl+H keeps its browser meaning", () => {
    expect(arrangeShortcut({ key: "H", shiftKey: true })).toBe("hide");
    expect(arrangeShortcut({ key: "h" })).toBeNull();
  });

  it("ignores other keys", () => {
    expect(arrangeShortcut({ key: "d" })).toBeNull();
    expect(arrangeShortcut({ key: "a" })).toBeNull();
  });
});
