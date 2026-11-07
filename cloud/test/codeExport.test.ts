import { describe, expect, it } from "vitest";
import JSZip from "jszip";
import ts from "typescript";
import { createEmptyProject } from "../../src/project/schema";
import { encodeProjectForCodeExport } from "../../src/preview/codeExport";
import { generateReactCodeArchive } from "../src/codeExport";

const options = {
  scope: "all",
  includeInteractions: true,
  includeVariables: true,
  includeAssets: true,
  responsive: false,
  tailwindVersion: "4",
};

describe("React/Tailwind archive generator", () => {
  it("creates a runnable Vite project with typed variables, routes, widgets, and Tailwind", async () => {
    const project = createEmptyProject("Sample prototype");
    project.variables.push({
      id: crypto.randomUUID(),
      name: "count",
      type: "number",
      initial: 2,
      scope: "project",
    });
    const secondScreen = {
      ...project.screens[0],
      id: crypto.randomUUID(),
      name: "Details",
      widgets: [],
      interactionRules: [],
    };
    project.screens.push(secondScreen);
    project.screens[0].interactionRules.push({
      id: crypto.randomUUID(),
      event: "onClick",
      conditions: [],
      actions: [{ type: "navigate", target: secondScreen.id }],
    });

    const archive = await generateReactCodeArchive(encodeProjectForCodeExport(project), options);
    const zip = await JSZip.loadAsync(archive.zipBase64, { base64: true });
    const packageJson = JSON.parse(await zip.file("package.json")!.async("text")) as {
      dependencies: Record<string, string>;
      devDependencies: Record<string, string>;
    };

    expect(archive.fileName).toBe("sample-prototype-react-export.zip");
    expect(archive.sizeBytes).toBeGreaterThan(0);
    expect(packageJson.dependencies).toMatchObject({ react: "^19.1.0", "react-router-dom": "^6.30.1" });
    expect(packageJson.devDependencies).toMatchObject({
      tailwindcss: "^4.1.0",
      "@tailwindcss/vite": "^4.1.0",
      "@types/react": "^19.1.8",
      "@types/react-dom": "^19.1.6",
    });
    expect(JSON.parse(await zip.file("tsconfig.json")!.async("text"))).toMatchObject({
      compilerOptions: { types: ["vite/client"] },
    });
    expect(zip.file("src/hooks/useVariables.ts")).not.toBeNull();
    expect(zip.file("src/hooks/useInteractions.ts")).not.toBeNull();
    expect(zip.file("src/screens/details-2.tsx")).not.toBeNull();
    expect(await zip.file("src/App.tsx")!.async("text")).toContain("BrowserRouter");
    expect(await zip.file("src/project.ts")!.async("text")).toContain('"initial":2');
    expect(await zip.file("README.md")!.async("text")).toContain("npm run dev");
  });

  it("supports Tailwind 3 and rejects invalid projects or settings", async () => {
    const project = createEmptyProject("Tailwind v3");
    const archive = await generateReactCodeArchive(encodeProjectForCodeExport(project), {
      ...options,
      tailwindVersion: "3",
    });
    const zip = await JSZip.loadAsync(archive.zipBase64, { base64: true });
    expect(zip.file("postcss.config.js")).not.toBeNull();
    expect(zip.file("tailwind.config.ts")).not.toBeNull();

    await expect(generateReactCodeArchive("not-base64", options)).rejects.toThrow("payload is invalid");
    await expect(generateReactCodeArchive(encodeProjectForCodeExport(project), {
      ...options,
      tailwindVersion: "5",
    })).rejects.toThrow("Export settings are invalid");
  });

  it("generates a responsive React export and emits type-safe responsive source", async () => {
    const project = createEmptyProject("Responsive React");
    const screen = project.screens[0];
    screen.device = {
      presetId: "desktop-1440-900",
      width: 1440,
      height: 900,
      dpr: 1,
      orientation: "landscape",
      insets: { top: 0, right: 0, bottom: 0, left: 0 },
    };
    screen.breakpoints = [
      { id: "mobile", name: "Mobile", minWidth: 0, maxWidth: 767, width: 390, height: 844 },
      { id: "tablet", name: "Tablet", minWidth: 768, maxWidth: 1023, width: 768, height: 1024 },
      { id: "desktop", name: "Desktop", minWidth: 1024, width: 1440, height: 900 },
    ];
    screen.widgets.push({
      id: crypto.randomUUID(),
      type: "text",
      x: 120,
      y: 80,
      width: 260,
      height: 48,
      rotation: 0,
      opacity: 1,
      visible: true,
      locked: false,
      zIndex: 1,
      style: {},
      props: { text: "Responsive label" },
      overrides: { mobile: { x: 12, width: 200 } },
      cascadeMode: "fluid",
    });
    const archive = await generateReactCodeArchive(encodeProjectForCodeExport(project), {
      ...options,
      responsive: true,
    });
    const zip = await JSZip.loadAsync(archive.zipBase64, { base64: true });
    const renderer = await zip.file("src/components/ScreenRenderer.tsx")!.async("text");
    const helper = await zip.file("src/project/responsive.ts")!.async("text");
    const types = await zip.file("src/types.ts")!.async("text");
    const compilerOptions = {
      jsx: ts.JsxEmit.ReactJSX,
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.ESNext,
    };

    expect(zip.file("src/project/responsive.ts")).not.toBeNull();
    expect(renderer).toContain("window.addEventListener(\"resize\", updateWidth)");
    expect(renderer).toContain("resolveWidgetsForBreakpoint");
    expect(types).toContain('inputMode?: "touch" | "mouse" | "both"');
    expect(types).toContain("flowPosition?: { x: number; y: number }");
    for (const source of [renderer, helper]) {
      const output = ts.transpileModule(source, {
        compilerOptions,
        reportDiagnostics: true,
      });
      expect(output.diagnostics?.filter((diagnostic) =>
        diagnostic.category === ts.DiagnosticCategory.Error,
      )).toEqual([]);
    }
    const helperOutput = ts.transpileModule(helper, {
      compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
      reportDiagnostics: true,
    });
    const responsiveHelper = await import(
      `data:text/javascript;base64,${Buffer.from(helperOutput.outputText).toString("base64")}`
    ) as typeof import("../../src/project/responsive");
    const mobile = responsiveHelper.getScreenBreakpoints(screen).find((breakpoint) => breakpoint.id === "mobile");
    if (!mobile) throw new Error("Responsive React export omitted the mobile breakpoint.");
    const resolved = responsiveHelper.resolveWidgetsForBreakpoint(screen.widgets, mobile, 1440, 900);
    expect(resolved[0]).toMatchObject({ x: 12, width: 200 });
  });
});
