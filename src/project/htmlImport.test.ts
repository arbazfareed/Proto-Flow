// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { findRequiredIcons, importHtmlToWidgets, parseHtmlToAst } from "./htmlImport";
import { extractImportedCode } from "./importedCode";
import { createDefaultBreakpoints, resolveWidgetsForBreakpoint } from "./responsive";

describe("importHtmlToWidgets", () => {
  beforeEach(() => {
    let id = 0;
    vi.stubGlobal("crypto", {
      randomUUID: () => `00000000-0000-4000-8000-${String(++id).padStart(12, "0")}`,
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("extracts and imports documents when the parsed body is unavailable", () => {
    const parse = DOMParser.prototype.parseFromString;
    vi.spyOn(DOMParser.prototype, "parseFromString").mockImplementation((source, type) => {
      const parsed = parse.call(new DOMParser(), source, type);
      Object.defineProperty(parsed, "body", { configurable: true, value: null });
      return parsed;
    });

    const html = `<!doctype html><html><head><style>.hero { color: #123456; }</style></head>
      <body><main class="hero"><h1>Imported heading</h1><video></video></main>
      <script>document.body.dataset.ready = "yes";</script></body></html>`;
    const extracted = extractImportedCode(html);

    expect(extracted.html).toContain("Imported heading");
    expect(extracted.css).toContain(".hero { color: #123456; }");
    expect(extracted.javascript).toContain('document.body.dataset.ready = "yes"');
    expect(findRequiredIcons(html).requiredIcons).toContain("Video");

    const widgets = importHtmlToWidgets(html, "", 800);
    expect(widgets.some(({ props }) => props.text === "Imported heading")).toBe(true);
  });

  it("maps supported HTML text and controls into editable canvas widgets", () => {
    const widgets = importHtmlToWidgets(
      `<main><h1>Dashboard</h1><p>Revenue overview</p><button>Open report</button><input placeholder="Search reports"></main>`,
      `h1 { color: #123456; font-size: 32px; } button { color: red; background-color: rgb(40, 50, 60); border-radius: 6px; }`,
      1200,
      4,
    );

    expect(widgets).toHaveLength(5);
    expect(widgets.map(({ type }) => type)).toEqual([
      "rectangle", "heading", "paragraph", "button", "input",
    ]);
    expect(widgets.map(({ zIndex }) => zIndex)).toEqual([4, 5, 6, 7, 8]);
    expect(widgets[1]).toMatchObject({
      name: "h1 Dashboard",
      props: { text: "Dashboard", fontSize: 32 },
      style: { fill: "#123456" },
    });
    expect(widgets[3]).toMatchObject({
      props: { label: "Open report", textColor: "#ff0000" },
      style: { fill: "#28323c", cornerRadius: 6 },
    });
    expect(widgets[4].props).toMatchObject({ placeholder: "Search reports" });
    expect(widgets.slice(1).every(({ groupId }) => groupId === widgets[0].id)).toBe(true);
  });

  it("preserves nested positions and applies container-only layout styles", () => {
    const widgets = importHtmlToWidgets(
      `<main style="width: 400px; padding: 12px; background-color: #f0f0f0"><section style="padding-left: 8px; padding-top: 6px"><h1>Title</h1><p>Body</p></section></main>`,
      "",
      1200,
    );
    const [main, section, heading, paragraph] = widgets;

    expect(widgets).toHaveLength(4);
    expect(main).toMatchObject({ x: 24, y: 24, width: 400, style: { fill: "#f0f0f0" } });
    expect(section.groupId).toBe(main.id);
    expect(heading.groupId).toBe(section.id);
    expect(paragraph.groupId).toBe(section.id);
    expect(heading.x).toBeGreaterThan(section.x);
    expect(heading.y).toBeGreaterThan(section.y);
    expect(section.style.fill).toBeNull();
    expect(heading.y).toBeLessThan(paragraph.y);
  });

  it("extracts embedded document styles and applies shorthands, grid layout, and media rules", () => {
    const html = `<!doctype html><html><head><style>
      * { box-sizing: border-box; font-family: Arial, sans-serif; }
      .hero { display: flex; padding: 20px 10%; background: linear-gradient(90deg, #e4f8ee 45%, #fff); }
      .cards { display: grid; grid-template-columns: repeat(3, 1fr); gap: 12px; }
      .card { padding: 16px; border: 1px solid #dddddd; border-radius: 12px; box-shadow: 0 4px 15px #ddd; }
      .card img { width: 100%; height: 100px; }
      .mobile-only { display: none; }
      @media (max-width: 600px) {
        .cards { grid-template-columns: 1fr; }
        .mobile-only { display: block; }
      }
    </style></head><body>
      <main class="hero"><div><h1>Welcome</h1></div><img src="https://images.example.test/hero.png"></main>
      <section class="cards"><article class="card"><img src="https://images.example.test/one.png"><h2>One</h2></article><article class="card"><img src="https://images.example.test/two.png"><h2>Two</h2></article><article class="card"><img src="https://images.example.test/three.png"><h2>Three</h2></article></section>
      <div class="mobile-only">Mobile only</div>
      <script>document.body.dataset.ready = "true";</script>
    </body></html>`;
    const widgets = importHtmlToWidgets(html, "", 1200, 0, [
      { id: "desktop", width: 1200 },
      { id: "mobile", width: 390 },
    ]);
    const hero = widgets.find(({ name }) => name === "main hero");
    const heroHeading = widgets.find(({ name }) => name === "h1 Welcome");
    const heroImage = widgets.find(({ name }) => name?.includes("img"));
    const cards = widgets.filter(({ name }) => name === "article card");

    expect(hero?.style.fill).toBe("#e4f8ee");
    expect(heroHeading?.props.fontFamily).toBe("Arial");
    expect(heroImage?.props.src).toBe("https://images.example.test/hero.png");
    expect(cards).toHaveLength(3);
    expect(cards[0].x).toBeLessThan(cards[1].x);
    expect(cards[1].x).toBeLessThan(cards[2].x);
    const mobileCardLayouts = cards.map(({ x, y, overrides }) => ({
      x: overrides?.mobile?.x ?? x,
      y: overrides?.mobile?.y ?? y,
    }));
    expect(mobileCardLayouts[0].x).toBe(mobileCardLayouts[1].x);
    expect(mobileCardLayouts[1].x).toBe(mobileCardLayouts[2].x);
    expect(mobileCardLayouts[0].y).toBeLessThan(mobileCardLayouts[1].y);
    expect(mobileCardLayouts[1].y).toBeLessThan(mobileCardLayouts[2].y);
    const mobileOnly = widgets.find(({ name }) => name === "div mobile-only");
    const mobileOnlyText = widgets.find(({ name }) => name === "p Mobile only");
    expect(mobileOnly).toMatchObject({
      visible: false,
      overrides: { mobile: { visible: true }, desktop: { visible: false } },
    });
    expect(mobileOnlyText?.groupId).toBe(mobileOnly?.id);
    const resolvedMobile = resolveWidgetsForBreakpoint(
      widgets,
      createDefaultBreakpoints(1200)[0],
      1200,
    );
    const resolvedMobileCards = cards.map(({ id }) =>
      resolvedMobile.find((widget) => widget.id === id)!,
    );
    expect(resolvedMobileCards[0].x).toBe(resolvedMobileCards[1].x);
    expect(resolvedMobileCards[1].x).toBe(resolvedMobileCards[2].x);
    expect(resolvedMobileCards[0].y).toBeLessThan(resolvedMobileCards[1].y);
    expect(resolvedMobileCards[1].y).toBeLessThan(resolvedMobileCards[2].y);
    expect(resolvedMobile.find(({ id }) => id === mobileOnly?.id)?.visible).toBe(true);
    expect(cards[0].style).toMatchObject({
      stroke: "#dddddd",
      strokeWidth: 1,
      cornerRadius: 12,
    });

    expect(cards[0].style.shadow).toMatchObject({ offsetY: 4, blur: 15 });

    const mobileWidgets = importHtmlToWidgets(html, "", 390);
    const mobileCards = mobileWidgets.filter(({ name }) => name === "article card");
    expect(mobileCards[0].x).toBe(mobileCards[1].x);
    expect(mobileCards[0].y).toBeLessThan(mobileCards[1].y);
  });

  it("measures unitless CSS line heights and honors container minimum heights", () => {
    const [container, heading, paragraph] = importHtmlToWidgets(
      `<main class="hero"><h1>Responsive title</h1><p>Body copy</p></main>`,
      `.hero { min-height: 570px; padding: 20px; }
       h1 { font-size: 40px; line-height: 1.2; }
       p { font-size: 16px; line-height: 1.6; }`,
      1200,
    );

    expect(container.height).toBeGreaterThanOrEqual(570);
    expect(heading.height).toBeGreaterThanOrEqual(48);
    expect(paragraph.height).toBeGreaterThanOrEqual(25);
    expect(paragraph.props.lineHeight).toBe(1.6);
  });

  it("maps SVG paths and scales their viewBox onto the canvas", () => {
    const widgets = importHtmlToWidgets(
      `<main><svg viewBox="10 20 100 50"><path d="M10 20 L110 20 L110 70 Z"/></svg></main>`,
      `svg { width: 200px; height: 100px; } path { fill: #ff0000; stroke: #000000; stroke-width: 2px; }`,
      1200,
    );
    const path = widgets[1];

    expect(widgets).toHaveLength(2);
    expect(path.type).toBe("path");
    expect(path.props).toMatchObject({
      pathData: "M10 20 L110 20 L110 70 Z",
      pathViewBoxX: 10,
      pathViewBoxY: 20,
      pathViewBoxWidth: 100,
      pathViewBoxHeight: 50,
    });
    expect(path).toMatchObject({
      width: 200,
      height: 100,
      style: { fill: "#ff0000", stroke: "#000000", strokeWidth: 2 },
    });
    expect(parseHtmlToAst(
      `<svg viewBox="0 0 10 10"><path d="M0 0 L10 10"/></svg>`,
      "",
    ).nodes).toHaveLength(0);
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
