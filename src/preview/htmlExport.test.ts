import { describe, expect, it } from "vitest";
import JSZip from "jszip";
import { createEmptyProject, type Widget } from "../project/schema";
import {
  generateLocalHtmlArchive,
  localHtmlExportFileName,
} from "./htmlExport";

describe("local HTML bundle export", () => {
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
    expect(await archive.file(imagePath)!.async("uint8array")).toEqual(
      Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10]),
    );
    expect(html).toContain('<script src="./runtime.js" defer></script>');
    expect(html).toContain('<link rel="stylesheet" href="./style.css">');
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
});
