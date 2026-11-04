import { describe, expect, it } from "vitest";
import { createStarterProject } from "./templates";
import { parseProject } from "../project/schema";

describe("onboarding starter projects", () => {
  it.each([
    "blank",
    "mobile-app",
    "dashboard",
    "landing-page",
    "form-flow",
    "data-table",
    "responsive-web",
  ] as const)("creates a valid %s project", (template) => {
    const project = createStarterProject(template);
    expect(parseProject(project)).toEqual(project);
    expect(project.screens).toHaveLength(1);
  });

  it("uses the iPhone 15 device preset for the mobile starter", () => {
    const project = createStarterProject("mobile-app");
    expect(project.screens[0].device?.presetId).toBe("iphone-15");
  });

  it("includes an interactive two-state panel in the form starter", () => {
    const project = createStarterProject("form-flow");
    const panel = project.screens[0].widgets.find((item) => item.type === "dynamic-panel");
    expect(panel?.props.states).toHaveLength(2);
  });

  it("includes sample data and a row template in the table starter", () => {
    const project = createStarterProject("data-table");
    const repeater = project.screens[0].widgets.find((item) => item.type === "repeater");
    expect(repeater?.props.dataset).toHaveLength(3);
    expect(repeater?.props.rowTemplate).toMatchObject({ widgets: expect.any(Array) });
  });

  it("includes mobile, tablet, and desktop breakpoints in the responsive starter", () => {
    const project = createStarterProject("responsive-web");
    expect(project.screens[0].breakpoints?.map((item) => item.id)).toEqual([
      "mobile",
      "tablet",
      "desktop",
    ]);
    expect(project.screens[0].widgets[0].overrides).toHaveProperty("mobile");
  });
});
