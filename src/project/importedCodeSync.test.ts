// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { importHtmlToWidgets } from "./htmlImport";
import { updateImportedHtmlGeometry } from "./importedCodeSync";

describe("updateImportedHtmlGeometry", () => {
  it("writes canvas geometry into the matching source element as inline styles", () => {
    const source = '<button id="submit" style="color: red">Submit</button>';
    const updated = updateImportedHtmlGeometry(source, [{
      nodeId: "node-1",
      x: 120,
      y: 240,
      width: 180,
      height: 52,
    }]);

    expect(updated).toContain('id="submit"');
    expect(updated).toContain("position: absolute !important");
    expect(updated).toContain("left: 120px !important");
    expect(updated).toContain("top: 240px !important");
    expect(importHtmlToWidgets(updated, "", 900)[0]).toMatchObject({
      x: 120,
      y: 240,
      width: 180,
      height: 52,
    });
  });

  it("keeps embedded scripts and styles in full documents while updating markup", () => {
    const source = "<!doctype html><html><head><style>button { color: red; }</style></head><body>" +
      '<button id="submit">Submit</button><script>window.ready = true;</script>' +
      "</body></html>";
    const updated = updateImportedHtmlGeometry(source, [{
      nodeId: "node-1",
      x: 80,
      y: 90,
      width: 100,
      height: 42,
    }]);

    expect(updated).toContain("<!doctype html>");
    expect(updated).toContain("button { color: red; }");
    expect(updated).toContain("window.ready = true;");
    expect(updated).toContain("left: 80px !important");
  });
});
