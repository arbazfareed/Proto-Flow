import { describe, expect, it } from "vitest";
import {
  createEmptyProject,
  parseProject,
  formatProjectValidationError,
  SchemaValidationError,
  serializeProject,
  type Project,
} from "./schema";

function createCompleteProject(): Project {
  const project = createEmptyProject("Checkout flow");
  const screen = project.screens[0];

  return {
    ...project,
    variables: [
      {
        id: crypto.randomUUID(),
        name: "attempts",
        type: "number",
        defaultValue: 0,
      },
    ],
    screens: [
      {
        ...screen,
        widgets: [
          {
            id: crypto.randomUUID(),
            type: "button",
            x: 12,
            y: 24,
            width: 180,
            height: 48,
            rotation: 0,
            opacity: 1,
            visible: true,
            locked: false,
            zIndex: 0,
            style: {
              fill: "#faf",
              stroke: "#112233",
              strokeWidth: 1,
              cornerRadius: 8,
              shadow: {
                color: "#11223380",
                blur: 4,
                offsetX: 0,
                offsetY: 2,
              },
            },
            props: { label: "Continue", metadata: { trackingId: 42 } },
          },
        ],
        interactionRules: [
          {
            id: crypto.randomUUID(),
            event: "onClick",
            conditions: [
              { variable: "attempts", operator: "lessThan", value: 3 },
            ],
            actions: [
              { type: "navigateTo", target: project.startScreenId },
              { type: "setVariable", target: "attempts", value: 1 },
            ],
          },
        ],
      },
    ],
  };
}

describe("ProtoFlow project schema", () => {
  it("creates a valid starter project with a UUID start screen", () => {
    const project = createEmptyProject("Checkout flow");

    expect(project.schemaVersion).toBe("1.0.0");
    expect(project.name).toBe("Checkout flow");
    expect(project.screens).toHaveLength(1);
    expect(project.screens[0].id).toBe(project.startScreenId);
    expect(project.screens[0].widgets).toEqual([]);
    expect(project.screens[0].interactionRules).toEqual([]);
    expect(project.variables).toEqual([]);
    expect(() => crypto.randomUUID()).not.toThrow();
  });

  it("validates and round-trips variables, widgets, styles and interactions", () => {
    const project = createCompleteProject();

    expect(parseProject(project)).toEqual(project);
    expect(parseProject(serializeProject(project))).toEqual(project);
  });

  it("throws SchemaValidationError with the Zod issues for unsupported versions", () => {
    const project = createEmptyProject();
    const unsupported = { ...project, schemaVersion: "2.0.0" };

    try {
      parseProject(unsupported);
      expect.fail("Expected schema validation to fail.");
    } catch (error) {
      expect(error).toBeInstanceOf(SchemaValidationError);
      expect((error as SchemaValidationError).issues.length).toBeGreaterThan(0);
      expect((error as SchemaValidationError).issues[0].path).toContain("schemaVersion");
      expect(formatProjectValidationError(error as SchemaValidationError)).toBe(
        "Incompatible schema version (2.0.0). Please update Proto Flow.",
      );
    }
  });

  it("reports missing required fields with their paths", () => {
    try {
      parseProject({ schemaVersion: "1.0.0" });
      expect.fail("Expected missing fields to fail validation.");
    } catch (error) {
      expect(error).toBeInstanceOf(SchemaValidationError);
      const paths = (error as SchemaValidationError).issues.map((issue) =>
        issue.path.join("."),
      );
      expect(paths).toContain("id");
      expect(paths).toContain("screens");
      expect(paths).toContain("startScreenId");
    }
  });

  it("wraps malformed JSON in SchemaValidationError", () => {
    expect(() => parseProject("{")).toThrow(SchemaValidationError);
    expect(() => parseProject("{")).toThrow("Invalid JSON");
    expect(() => parseProject('{"name":"bad\u0000json"}')).toThrow(SchemaValidationError);
  });

  it("rejects a start screen id that does not reference an existing screen", () => {
    const project = createEmptyProject();

    expect(() =>
      parseProject({ ...project, startScreenId: crypto.randomUUID() }),
    ).toThrow(/startScreenId: Start screen must reference an existing screen/);
  });

  it("enforces UUIDs and hex colors in nested widget data", () => {
    const project = createCompleteProject();
    const [screen] = project.screens;
    const [widget] = screen.widgets;

    expect(() =>
      parseProject({
        ...project,
        screens: [
          {
            ...screen,
            widgets: [{ ...widget, id: "not-a-uuid" }],
          },
        ],
      }),
    ).toThrow(SchemaValidationError);

    expect(() =>
      parseProject({
        ...project,
        screens: [
          {
            ...screen,
            widgets: [{ ...widget, style: { ...widget.style, fill: "red" } }],
          },
        ],
      }),
    ).toThrow(/Expected a hex color/);

    for (const fill of ["#ZZFFFF", "#12", "<script>alert(1)</script>"]) {
      expect(() =>
        parseProject({
          ...project,
          screens: [
            {
              ...screen,
              widgets: [{ ...widget, style: { ...widget.style, fill } }],
            },
          ],
        }),
      ).toThrow(/Expected a hex color/);
    }
  });

  it("rejects invalid widget geometry and interaction events", () => {
    const project = createCompleteProject();
    const [screen] = project.screens;
    const [widget] = screen.widgets;
    const [rule] = screen.interactionRules;

    expect(() =>
      parseProject({
        ...project,
        screens: [
          {
            ...screen,
            widgets: [{ ...widget, opacity: 1.2 }],
          },
        ],
      }),
    ).toThrow(SchemaValidationError);

    expect(() =>
      parseProject({
        ...project,
        screens: [
          {
            ...screen,
            interactionRules: [{ ...rule, event: "onDoubleClick" }],
          },
        ],
      }),
    ).toThrow(SchemaValidationError);
  });

  it("bounds widget coordinates and enforces dimensions of at least one unit", () => {
    const project = createCompleteProject();
    const [screen] = project.screens;
    const [widget] = screen.widgets;

    for (const geometry of [
      { x: Infinity },
      { x: 100_001 },
      { y: -100_001 },
      { width: -99_999 },
      { width: 0.5 },
      { height: 0 },
      { opacity: 450 },
    ]) {
      expect(() =>
        parseProject({
          ...project,
          screens: [
            {
              ...screen,
              widgets: [{ ...widget, ...geometry }],
            },
          ],
        }),
      ).toThrow(SchemaValidationError);
    }
  });

  it("rejects unsupported recursive widget hierarchies instead of traversing them", () => {
    const project = createCompleteProject();
    const [screen] = project.screens;
    const [widget] = screen.widgets;
    const recursiveWidget: Record<string, unknown> = { ...widget };
    recursiveWidget.children = [recursiveWidget];

    expect(() =>
      parseProject({
        ...project,
        screens: [
          {
            ...screen,
            widgets: [recursiveWidget],
          },
        ],
      }),
    ).toThrow(SchemaValidationError);
  });

  it("keeps variable default values aligned with their declared types", () => {
    const project = createEmptyProject();

    expect(() =>
      parseProject({
        ...project,
        variables: [
          {
            id: crypto.randomUUID(),
            name: "enabled",
            type: "boolean",
            defaultValue: "true",
          },
        ],
      }),
    ).toThrow(SchemaValidationError);
  });
});
