// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { importHtmlToWidgets } from "./htmlImport";

describe("importHtmlToWidgets", () => {
  beforeEach(() => {
    let id = 0;
    vi.stubGlobal("crypto", {
      randomUUID: () => `00000000-0000-4000-8000-${String(++id).padStart(12, "0")}`,
    });
  });

  afterEach(() => vi.unstubAllGlobals());

  it("maps supported HTML text and controls into editable canvas widgets", () => {
    const widgets = importHtmlToWidgets(
      `<main><h1>Dashboard</h1><p>Revenue overview</p><button>Open report</button><input placeholder="Search reports"></main>`,
      `h1 { color: #123456; font-size: 32px; } button { background-color: rgb(40, 50, 60); border-radius: 6px; }`,
      1200,
      4,
    );

    expect(widgets).toHaveLength(4);
    expect(widgets.map(({ type }) => type)).toEqual(["heading", "paragraph", "button", "input"]);
    expect(widgets.map(({ zIndex }) => zIndex)).toEqual([4, 5, 6, 7]);
    expect(widgets[0]).toMatchObject({
      name: "h1 Dashboard",
      props: { text: "Dashboard", fontSize: 32 },
      style: { fill: "#123456" },
    });
    expect(widgets[2]).toMatchObject({
      props: { label: "Open report" },
      style: { fill: "#28323c", cornerRadius: 6 },
    });
    expect(widgets[3].props).toMatchObject({ placeholder: "Search reports" });
  });

  it("ignores scripts and rejects code with no importable content", () => {
    const widgets = importHtmlToWidgets(
      `<script>window.parent.document.body.innerHTML = "bad"</script><h2>Safe heading</h2>`,
      "",
      800,
    );
    expect(widgets).toHaveLength(1);
    expect(widgets[0].props.text).toBe("Safe heading");
    expect(() => importHtmlToWidgets("<script>run()</script>", "", 800))
      .toThrow("No supported text or controls were found");
  });

  it("enforces source size limits before parsing", () => {
    expect(() => importHtmlToWidgets("x".repeat(200_001), "", 800))
      .toThrow("HTML import is limited to 200 KB");
    expect(() => importHtmlToWidgets("<p>Test</p>", "x".repeat(100_001), 800))
      .toThrow("CSS import is limited to 100 KB");
  });
});
