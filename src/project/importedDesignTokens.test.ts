import { describe, expect, it } from "vitest";
import { parseImportedDesignTokenMessage } from "./importedDesignTokens";

describe("parseImportedDesignTokenMessage", () => {
  it("normalizes duplicate colors and merges their usage categories", () => {
    const tokens = parseImportedDesignTokenMessage({
      type: "protoflow-design-tokens",
      nonce: "expected",
      colors: [
        { color: "rgb(18, 52, 86)", usages: ["background"] },
        { color: "rgba(18, 52, 86, 1)", usages: ["text", "invalid"] },
        { color: "rgba(1, 2, 3, 0)", usages: ["border"] },
      ],
      textStyles: [],
    }, "expected");

    expect(tokens?.colors).toEqual([
      { color: "#123456", opacity: 1, usages: ["background", "text"] },
    ]);
  });

  it("validates the preview nonce and bounds imported text styles", () => {
    const message = {
      type: "protoflow-design-tokens",
      nonce: "expected",
      colors: [],
      textStyles: [
        { fontFamily: "Inter, sans-serif", fontSize: 16, fontWeight: "600", count: 2 },
        { fontFamily: "bad".repeat(50), fontSize: 16, fontWeight: "400", count: 1 },
        { fontFamily: "Arial", fontSize: 0, fontWeight: "400", count: 1 },
      ],
    };

    expect(parseImportedDesignTokenMessage(message, "wrong")).toBeNull();
    expect(parseImportedDesignTokenMessage(message, "expected")?.textStyles).toEqual([
      { fontFamily: "Inter, sans-serif", fontSize: 16, fontWeight: "600", count: 2 },
    ]);
  });

  it("rejects malformed messages", () => {
    expect(parseImportedDesignTokenMessage(null, "expected")).toBeNull();
    expect(parseImportedDesignTokenMessage({
      type: "protoflow-design-tokens",
      nonce: "expected",
      colors: "not-an-array",
      textStyles: [],
    }, "expected")).toBeNull();
  });
});
