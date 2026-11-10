// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { importHtmlToWidgets } from "./htmlImport";
import {
  getImportedHtmlGeometryUpdates,
  updateImportedHtmlGeometry,
} from "./importedCodeSync";
import { createEmptyProject } from "./schema";

describe("imported code geometry synchronization", () => {
  it("syncs geometry changed through an active breakpoint override", () => {
    const screen = createEmptyProject().screens[0];
    const [widget] = importHtmlToWidgets('<button id="submit">Submit</button>', "", 1440);
    const importedWidget = {
      ...widget,
      props: {
        ...widget.props,
        importedCodeId: "import-1",
        importedNodeId: "node-1",
      },
    };
    const previousScreen = {
      ...screen,
      widgets: [{
        ...importedWidget,
        overrides: { mobile: { x: 20 } },
      }],
    };
    const nextScreen = {
      ...screen,
      widgets: [{
        ...importedWidget,
        overrides: { mobile: { x: 130 } },
      }],
    };

    expect(getImportedHtmlGeometryUpdates(previousScreen, nextScreen, "import-1", "mobile"))
      .toEqual([{
        nodeId: "node-1",
        x: 130,
        y: widget.y,
        width: widget.width,
        height: widget.height,
      }]);
  });

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
