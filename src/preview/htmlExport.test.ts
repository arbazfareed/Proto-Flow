import { describe, expect, it, vi } from "vitest";
import JSZip from "jszip";
import { createEmptyProject, type Widget } from "../project/schema";
import {
  generateDeviceImageArchive,
  generateLocalHtmlArchive,
  localHtmlExportFileName,
  responsiveLayoutStyles,
} from "./htmlExport";

describe("local HTML bundle export", () => {
  it("serializes rich runs and renders their semantic tags in the standalone runtime", async () => {
    const project = createEmptyProject("Rich text export");
    project.screens[0].widgets.push({
      id: crypto.randomUUID(),
      type: "text",
      x: 12,
      y: 18,
      width: 220,
      height: 60,
      rotation: 0,
      opacity: 1,
      visible: true,
      locked: false,
      zIndex: 1,
      style: {},
      props: { richText: true, text: "**Hello {{name}}**" },
    });
    const archive = await JSZip.loadAsync(await generateLocalHtmlArchive(project, {
      includeInteractions: true,
      includeAssets: true,
    }));
    const html = await archive.file("index.html")!.async("text");
    const runtime = await archive.file("runtime.js")!.async("text");
    const exportedProject = JSON.parse(
      html.match(/<script id="project-data" type="application\/json">([\s\S]*?)<\/script>/)![1],
    );

    expect(exportedProject.screens[0].widgets[0].props.richTextRuns[0].marks.bold).toBe(true);
    expect(runtime).toContain("function renderRichText(element");
    expect(runtime).toContain('make("strong", node)');
    expect(runtime).toContain('widget.props.richText === true');
  });

  it("creates a standalone offline ZIP with the preview runtime and extracted images", async () => {
    const project = createEmptyProject("Offline prototype");
    project.screens[0].widgets.push({
      id: crypto.randomUUID(),
      type: "image",
      x: 10,
      y: 20,
      width: 120,
      height: 90,
      rotation: 0,
      opacity: 1,
      visible: true,
      locked: false,
      zIndex: 1,
      style: {},
      props: { src: "data:image/png;base64,iVBORw0KGgo=" },
    } satisfies Widget);
    project.screens[0].interactionRules.push({
      id: crypto.randomUUID(),
      event: "onLoad",
      conditions: [],
      actions: [{ type: "setVariable", target: "ready", value: true }],
    });
    project.variables.push({
      id: crypto.randomUUID(),
      name: "ready",
      type: "boolean",
      initial: false,
      scope: "project",
    });

    const archive = await JSZip.loadAsync(await generateLocalHtmlArchive(project, {
      includeInteractions: true,
      includeAssets: true,
    }));
    const html = await archive.file("index.html")!.async("text");
    const runtime = await archive.file("runtime.js")!.async("text");
    const exportedProject = JSON.parse(
      html.match(/<script id="project-data" type="application\/json">([\s\S]*?)<\/script>/)![1],
    );
    const imagePath = exportedProject.screens[0].widgets[0].props.src;

    expect(Object.keys(archive.files).sort()).toEqual([
      "assets/",
      "assets/image-1.png",
      "index.html",
      "runtime.js",
      "style.css",
    ]);
    expect(imagePath).toBe("assets/image-1.png");
    expect(exportedProject.screens[0].widgets[0].props.srcset).toContain(`${imagePath} 1x`);
    expect(await archive.file(imagePath)!.async("uint8array")).toEqual(
      Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10]),
    );
    expect(html).toContain('<script src="./runtime.js" defer></script>');
    expect(html).toContain('<link rel="stylesheet" href="./style.css">');
    expect(runtime).toContain("image.srcset =");
    expect(await archive.file("runtime.js")!.async("text")).toContain("setVariable");
    expect(html).not.toMatch(/https?:\/\//i);
    expect(await archive.file("runtime.js")!.async("text")).not.toMatch(
      /\b(?:fetch|XMLHttpRequest|localStorage|sessionStorage)\b/,
    );
    expect(exportedProject.screens[0].interactionRules[0].actions[0].value).toBe(true);
  });

  it("can omit interactions and assets while retaining the static project", async () => {
    const project = createEmptyProject("Static export");
    project.screens[0].interactionRules.push({
      id: crypto.randomUUID(),
      event: "onClick",
      conditions: [],
      actions: [{ type: "navigate", target: project.startScreenId }],
    });
    project.screens[0].widgets.push({
      id: crypto.randomUUID(),
      type: "image",
      x: 0,
      y: 0,
      width: 100,
      height: 80,
      rotation: 0,
      opacity: 1,
      visible: true,
      locked: false,
      zIndex: 0,
      style: {},
      props: { src: "data:image/png;base64,iVBORw0KGgo=" },
    } satisfies Widget);

    const archive = await JSZip.loadAsync(await generateLocalHtmlArchive(project, {
      includeInteractions: false,
      includeAssets: false,
    }));
    const html = await archive.file("index.html")!.async("text");
    const exportedProject = JSON.parse(
      html.match(/<script id="project-data" type="application\/json">([\s\S]*?)<\/script>/)![1],
    );

    expect(exportedProject.screens[0].interactionRules).toEqual([]);
    expect(exportedProject.screens[0].widgets[0].props.src).toBe("");
    expect(archive.file("assets/image-1.png")).toBeNull();
  });

  it("includes escaped annotation comments in the HTML bundle", async () => {
    const project = createEmptyProject("Annotated prototype");
    project.screens[0].widgets.push({
      id: crypto.randomUUID(),
      type: "button",
      name: "Continue",
      x: 10,
      y: 10,
      width: 100,
      height: 40,
      rotation: 0,
      opacity: 1,
      visible: true,
      locked: false,
      zIndex: 0,
      style: {},
      props: {},
      notes: {
        description: "Review --> approve",
        requirementId: "REQ-15",
        priority: "critical",
        status: "in review",
        tags: ["checkout"],
        custom: {},
      },
    } satisfies Widget);
    const archive = await JSZip.loadAsync(await generateLocalHtmlArchive(project, {
      includeInteractions: true,
      includeAssets: true,
    }));
    const html = await archive.file("index.html")!.async("text");

    expect(html).toContain("Widget note for Screen 1 / Continue");
    expect(html).toContain("critical, in review | requirement REQ-15");
    expect(html).toContain("Review —› approve");
    expect(html.match(/-->/g)).toHaveLength(1);
    expect(html).toContain("Review --\\u003e approve");
  });

  it("rejects remote image URLs instead of silently producing a non-offline bundle", async () => {
    const project = createEmptyProject("Remote image");
    project.screens[0].widgets.push({
      id: crypto.randomUUID(),
      type: "image",
      x: 0,
      y: 0,
      width: 100,
      height: 80,
      rotation: 0,
      opacity: 1,
      visible: true,
      locked: false,
      zIndex: 0,
      style: {},
      props: { src: "https://example.com/image.png" },
    } satisfies Widget);

    await expect(generateLocalHtmlArchive(project, {
      includeInteractions: true,
      includeAssets: true,
    })).rejects.toThrow("Offline HTML export cannot fetch remote images");
    await expect(generateLocalHtmlArchive(project, {
      includeInteractions: true,
      includeAssets: false,
    })).resolves.toBeInstanceOf(Uint8Array);
  });

  it("escapes project markup and derives safe ZIP filenames", async () => {
    const project = createEmptyProject("</title><script>alert(1)</script>");
    const archive = await JSZip.loadAsync(await generateLocalHtmlArchive(project, {
      includeInteractions: true,
      includeAssets: true,
    }));
    const html = await archive.file("index.html")!.async("text");

    expect(html).not.toContain("</title><script>alert(1)</script>");
    expect(localHtmlExportFileName("../../My Project")).toBe("my-project-html-export.zip");
    expect(localHtmlExportFileName("")).toBe("prototype-html-export.zip");
  });

  it("exports responsive breakpoint rules and per-device HTML variants for free local use", async () => {
    const project = createEmptyProject("Responsive layout");
    const widget: Widget = {
      id: crypto.randomUUID(),
      type: "button",
      x: 120,
      y: 80,
      width: 260,
      height: 48,
      rotation: 0,
      opacity: 1,
      visible: true,
      locked: false,
      zIndex: 1,
      cascadeMode: "fluid",
      style: {},
      props: {},
      overrides: { mobile: { x: 12, width: 200 } },
    };
    project.screens[0].widgets.push(widget);

    const styles = responsiveLayoutStyles(project);
    const archive = await JSZip.loadAsync(await generateLocalHtmlArchive(project, {
      includeInteractions: true,
      includeAssets: true,
      mode: "device-variants",
    }));
    const responsivePage = await archive.file("index.html")!.async("text");
    const mobilePage = await archive.file("index-mobile.html")!.async("text");
    const css = await archive.file("style.css")!.async("text");

    expect(styles).toContain("@media (max-width:767px)");
    expect(styles).toContain(`[data-widget-id="${widget.id}"]`);
    expect(responsivePage).toContain("Multi-device export");
    expect(css).toContain("width:200px!important");
    expect(mobilePage).toContain(project.screens[0].id);
    expect(archive.file("index-desktop.html")).not.toBeNull();
    expect(archive.file("index-tablet.html")).not.toBeNull();
    expect(archive.file("runtime.js")).not.toBeNull();
  });

  it("renders 2× desktop, tablet, and mobile image screenshots in a ZIP", async () => {
    const project = createEmptyProject("Device images");
    const htmlToImage = await import("html-to-image");
    vi.spyOn(htmlToImage, "toPng").mockResolvedValue("data:image/png;base64,aGVsbG8=");
    const originalRequestAnimationFrame = globalThis.requestAnimationFrame;
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
      callback(0);
      return 1;
    });
    const originalDocument = globalThis.document;
    const appended: HTMLIFrameElement[] = [];
    const fakeStage = {} as HTMLElement;
    const fakeDocument = {
      images: [],
      querySelector: () => fakeStage,
    } as unknown as Document;
    const fakeFrame = {
      title: "",
      style: {},
      contentDocument: fakeDocument,
      setAttribute: () => undefined,
      remove: vi.fn(),
      onload: null as (() => void) | null,
      onerror: null as (() => void) | null,
    } as unknown as HTMLIFrameElement;
    Object.defineProperty(fakeFrame, "srcdoc", {
      set: () => queueMicrotask(() => fakeFrame.onload?.(
        new Event("load") as ProgressEvent<EventTarget>,
      )),
    });
    vi.stubGlobal("document", {
      createElement: (tagName: string) => tagName === "iframe" ? fakeFrame : document.createElement(tagName),
      body: { append: (element: HTMLIFrameElement) => appended.push(element) },
    });

    try {
      const output = await generateDeviceImageArchive(project, {
        includeInteractions: true,
        includeAssets: true,
      });
      const archive = await JSZip.loadAsync(output);
      expect(Object.keys(archive.files).filter((path) => path.endsWith(".png")).sort()).toEqual([
        "images/desktop-2x.png",
        "images/mobile-2x.png",
        "images/tablet-2x.png",
      ]);
      expect(appended).toHaveLength(3);
      expect(fakeFrame.remove).toHaveBeenCalledTimes(3);
    } finally {
      vi.restoreAllMocks();
      vi.stubGlobal("requestAnimationFrame", originalRequestAnimationFrame);
      vi.stubGlobal("document", originalDocument);
    }
  });
});
