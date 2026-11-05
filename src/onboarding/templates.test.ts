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
    "login",
    "storefront",
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
    expect(panel).toMatchObject({
      x: 670,
      y: 106,
      style: { fill: "#20222b", cornerRadius: 12 },
    });
    expect(panel?.props.states).toEqual(expect.arrayContaining([
      expect.objectContaining({
        widgets: expect.arrayContaining([
          expect.objectContaining({
            name: "Create your account",
            x: 698,
            y: 130,
          }),
        ]),
      }),
    ]));
  });

  it("includes sample data and a row template in the table starter", () => {
    const project = createStarterProject("data-table");
    const repeater = project.screens[0].widgets.find((item) => item.type === "repeater");
    expect(repeater?.props.dataset).toHaveLength(3);
    expect(repeater?.props).toMatchObject({
      rowHeight: 72,
      rowTemplate: { widgets: expect.arrayContaining([
        expect.objectContaining({
          props: expect.objectContaining({
            label: "Member name",
            text: "{{item.name}}",
            fontFamily: "Arial",
            fontSize: 16,
            fontWeight: "bold",
            align: "left",
            lineHeight: 1.2,
          }),
        }),
        expect.objectContaining({
          props: expect.objectContaining({ label: "{{item.status}}" }),
          style: expect.objectContaining({ fill: "#33445f" }),
        }),
      ]) },
    });
    expect(repeater?.height).toBe(216);
  });

  it("includes email, password, and account-recovery affordances in the login starter", () => {
    const project = createStarterProject("login");
    const widgets = project.screens[0].widgets;
    expect(widgets.find((item) => item.type === "input" && item.props.type === "email")).toBeDefined();
    expect(widgets.find((item) => item.type === "input" && item.props.type === "password")).toBeDefined();
    expect(widgets.find((item) => item.props.text === "Forgot password?")).toBeDefined();
  });

  it("uses a product-focused layout in the storefront starter", () => {
    const project = createStarterProject("storefront");
    const widgets = project.screens[0].widgets;
    expect(widgets).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: "ellipse", name: "Lamp shade", props: expect.objectContaining({ label: "" }) }),
      expect.objectContaining({ type: "rectangle", name: "Lamp stem", props: expect.objectContaining({ label: "" }) }),
      expect.objectContaining({ type: "ellipse", name: "Lamp base", props: expect.objectContaining({ label: "" }) }),
    ]));
    expect(widgets.find((item) => item.type === "button" && item.props.label === "Add to bag")).toBeDefined();
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
