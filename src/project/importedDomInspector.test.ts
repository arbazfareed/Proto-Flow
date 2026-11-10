import { describe, expect, it } from "vitest";
import {
  createImportedDomInspectorScript,
  parseImportedDomSelectionMessage,
} from "./importedDomInspector";

describe("imported DOM inspector messages", () => {
  it("accepts bounded selections from the expected preview nonce", () => {
    const message = {
      type: "protoflow-dom-selection",
      nonce: "expected",
      nodeId: "node-12",
      tagName: "button",
      label: "#continue",
      textContent: "Continue",
    };

    expect(parseImportedDomSelectionMessage(message, "wrong")).toBeNull();
    expect(parseImportedDomSelectionMessage(message, "expected")).toEqual({
      nodeId: "node-12",
      tagName: "button",
      label: "#continue",
      textContent: "Continue",
    });
    expect(parseImportedDomSelectionMessage({
      ...message,
      nodeId: "node-1-extra",
    }, "expected")).toBeNull();
  });

  it("tags DOM nodes and gates click inspection behind the parent nonce", () => {
    const script = createImportedDomInspectorScript("preview-nonce");

    expect(script).toContain('setAttribute("data-protoflow-node-id"');
    expect(script).toContain('message.type !== "protoflow-dom-inspector-mode"');
    expect(script).toContain('message.nonce !== nonce');
    expect(script).toContain('type: "protoflow-dom-selection"');
    expect(script).toContain('const nonce = "preview-nonce";');
  });
});
