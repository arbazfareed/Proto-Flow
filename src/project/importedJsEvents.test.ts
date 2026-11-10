// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { analyzeImportedJsListeners } from "./importedJsEvents";

describe("analyzeImportedJsListeners", () => {
  it("finds static event listeners and maps text updates to ProtoFlow events", () => {
    const analysis = analyzeImportedJsListeners(
      `document.querySelector("#save")?.addEventListener("click", (event) => {
        event.currentTarget.textContent = "Saved";
      });
      document.getElementById("email").addEventListener("change", function (event) {
        event.target.innerText = "Updated";
      });`,
      '<button id="save">Save</button><input id="email">',
    );

    expect(analysis.error).toBeUndefined();
    expect(analysis.listeners).toEqual([
      {
        id: "node-1:click:0",
        nodeId: "node-1",
        selector: "#save",
        eventName: "click",
        protoFlowEvent: "onClick",
        textValue: "Saved",
      },
      {
        id: "node-2:change:1",
        nodeId: "node-2",
        selector: "#email",
        eventName: "change",
        protoFlowEvent: "onChange",
        textValue: "Updated",
      },
    ]);
  });

  it("reports syntax errors and ignores unsupported, dynamic, or unmatched listeners", () => {
    expect(analyzeImportedJsListeners("document.querySelector(", "<button />")).toMatchObject({
      listeners: [],
      error: expect.stringContaining("line 1"),
    });

    expect(analyzeImportedJsListeners(
      `document.querySelector("#missing").addEventListener("click", () => {});
       document.querySelector(selector).addEventListener("click", () => {});
       document.querySelector("#button").addEventListener("wheel", () => {});`,
      '<button id="button">Button</button>',
    )).toEqual({ listeners: [] });
  });

  it("does not offer conversion for event handlers without a supported text update", () => {
    const analysis = analyzeImportedJsListeners(
      `document.querySelector("#save").addEventListener("click", () => {
        console.log("saved");
      });`,
      '<button id="save">Save</button>',
    );

    expect(analysis.listeners).toMatchObject([{
      nodeId: "node-1",
      protoFlowEvent: "onClick",
    }]);
    expect(analysis.listeners[0]).not.toHaveProperty("textValue");
  });

  it("bounds analysis of large JavaScript source", () => {
    expect(analyzeImportedJsListeners(" ".repeat(100_001), "<button />")).toEqual({
      listeners: [],
      error: "JavaScript event scanning is limited to 100 KB.",
    });
  });
});
