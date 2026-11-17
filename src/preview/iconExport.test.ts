import { describe, expect, it } from "vitest";
import { createEmptyProject, type Widget } from "../project/schema";
import { ensureProjectIcons, iconDataScript, projectIconNames, projectIconSvgs } from "./iconExport";

const icon = (iconName: string): Widget => ({
  id: crypto.randomUUID(), type: "icon", x: 0, y: 0, width: 24, height: 24, rotation: 0, opacity: 1,
  visible: true, locked: false, zIndex: 0, style: { stroke: "#16a34a" }, props: { iconName },
});

describe("icons in exports (B76, B77)", () => {
  it("collects every icon a project uses and turns each into a real SVG", async () => {
    const project = createEmptyProject("Icons");
    // Camera and Lock were "•" before; Mic and Send were not in the app at all.
    project.screens[0].widgets.push(icon("Camera"), icon("Lock"), icon("Mic"), icon("Send"), icon("Camera"));
    expect(projectIconNames(project).sort()).toEqual(["Camera", "Lock", "Mic", "Send"]);
    await ensureProjectIcons(project);
    const svgs = projectIconSvgs(project);
    for (const name of ["Camera", "Lock", "Mic", "Send"]) {
      expect(svgs[name]).toMatch(/^<svg[^>]*stroke="currentColor"/);
      expect(svgs[name]).toContain("<path");
    }
  });

  it("embeds the SVGs as JSON that cannot break out of the script element", async () => {
    const project = createEmptyProject("Icons");
    project.screens[0].widgets.push(icon("User"));
    await ensureProjectIcons(project);
    const script = iconDataScript(project);
    expect(script.startsWith('<script id="icon-data" type="application/json">')).toBe(true);
    expect(script.slice(script.indexOf(">") + 1, -"</script>".length)).not.toMatch(/[<>]/);
    expect(JSON.parse(script.slice(script.indexOf(">") + 1, -"</script>".length).replace(/\\u003c/g, "<").replace(/\\u003e/g, ">").replace(/\\u0026/g, "&")).User).toContain("<svg");
  });
});
