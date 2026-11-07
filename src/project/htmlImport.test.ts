// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { importHtmlToWidgets, parseHtmlToAst } from "./htmlImport";

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

  it("builds a flat AST with parent links, computed styles, and required semantic icons", () => {
    const ast = parseHtmlToAst(
      `<main class="p-4 bg-blue-500"><section class="text-center fw-bold fs-2"><video aria-label="Intro"></video><table><tbody><tr><td>Report</td></tr></tbody></table><input type="date" aria-label="Start date"></section></main>`,
      `section { color: #123456; }`,
    );

    expect(ast.nodes.map(({ tagName }) => tagName)).toEqual([
      "main", "section", "video", "table", "tbody", "tr", "td", "input",
    ]);
    expect(ast.nodes[0]).toMatchObject({
      id: "node-1",
      parentId: null,
      computedStyles: { padding: "16px", "background-color": "rgb(59, 130, 246)" },
    });
    expect(ast.nodes[1]).toMatchObject({
      parentId: "node-1",
      computedStyles: { color: "rgb(18, 52, 86)", "font-size": "32px", "font-weight": "700", "text-align": "center" },
    });
    expect(ast.nodes[2]).toMatchObject({
      tagName: "video",
      parentId: "node-2",
      suggestedIcon: "Video",
    });
    expect(ast.nodes[7]).toMatchObject({
      tagName: "input",
      suggestedIcon: "Calendar",
    });
    expect(ast.requiredIcons).toEqual(["Layout", "Video", "Table", "Calendar"]);
  });

  it("maps common Tailwind and Bootstrap utility classes", () => {
    const ast = parseHtmlToAst(
      `<div class="text-red-600 bg-gray-100 rounded-lg"><p class="text-sm font-bold text-center">Tailwind</p><button class="btn btn-primary fw-bold">Bootstrap</button></div>`,
      "",
    );

    expect(ast.nodes[0].computedStyles).toMatchObject({
      color: "rgb(220, 38, 38)",
      "background-color": "rgb(243, 244, 246)",
      "border-radius": "8px",
    });
    expect(ast.nodes[1].computedStyles).toMatchObject({
      "font-size": "14px",
      "font-weight": "700",
      "text-align": "center",
    });
    expect(ast.nodes[2].computedStyles).toMatchObject({
      color: "rgb(255, 255, 255)",
      "background-color": "rgb(13, 110, 253)",
      "font-weight": "700",
    });
  });

  it("reports when AST analysis reaches its node limit", () => {
    const ast = parseHtmlToAst(`<main>${"<div></div>".repeat(2_000)}</main>`, "");

    expect(ast.nodes).toHaveLength(2_000);
    expect(ast.truncated).toBe(true);
  });
});
