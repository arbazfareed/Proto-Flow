import { describe, expect, it } from "vitest";
import { createEmptyProject } from "../project/schema";
import {
  generateSingleFileJsx,
  prepareExportProject,
  type CodeExportOptions,
} from "./codeExport";

function options(overrides: Partial<CodeExportOptions> = {}): CodeExportOptions {
  return {
    scope: "all",
    includeInteractions: true,
    includeVariables: true,
    includeAssets: true,
    tailwindVersion: "4",
    ...overrides,
  };
}

describe("React code export preparation", () => {
  it("keeps the selected screen, typed variables, and only compatible interactions", () => {
    const project = createEmptyProject("Export");
    const first = project.screens[0];
    project.variables.push({
      id: crypto.randomUUID(),
      name: "status",
      type: "string",
      initial: "ready",
      scope: "project",
    });
    const second = { ...first, id: crypto.randomUUID(), name: "Details", widgets: [], interactionRules: [] };
    project.screens.push(second);
    const single = prepareExportProject(project, options({ scope: "current", screenId: second.id }));

    expect(single.screens.map((screen) => screen.id)).toEqual([second.id]);
    expect(single.startScreenId).toBe(second.id);
    expect(single.variables.map((variable) => variable.name)).toEqual(["status"]);
  });

  it("honors the feature toggles while retaining non-embedded image URLs", () => {
    const project = createEmptyProject("Asset options");
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
      props: { src: "https://assets.example/image.png", url: "data:image/png;base64,AAAA" },
    });
    const result = prepareExportProject(project, options({
      includeInteractions: false,
      includeVariables: false,
      includeAssets: false,
    }));

    expect(result.variables).toEqual([]);
    expect(result.screens[0].interactionRules).toEqual([]);
    expect(result.screens[0].widgets[0].props).toMatchObject({ src: "https://assets.example/image.png", url: "" });
  });

  it("generates a safe single-file TSX fallback with screen navigation", () => {
    const project = createEmptyProject("</script><script>notMarkup()</script>");
    const source = generateSingleFileJsx(project);

    expect(source).toContain("export default function App()");
    expect(source).toContain("project.screens.map");
    expect(source).not.toContain("</script><script>notMarkup()");
    expect(source).toContain("\\u003c/script\\u003e");
  });
});
