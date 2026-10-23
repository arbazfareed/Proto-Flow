import { describe, expect, it } from "vitest";
import {
  createEmptyProject,
  parseProject,
  formatProjectValidationError,
  SchemaValidationError,
  serializeProject,
  type Project,
  type Widget,
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
        initial: 0,
        scope: "project",
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

    expect(project.schemaVersion).toBe("1.9.0");
    expect(project.name).toBe("Checkout flow");
    expect(project.screens).toHaveLength(1);
    expect(project.screens[0].id).toBe(project.startScreenId);
    expect(project.screens[0].widgets).toEqual([]);
    expect(project.screens[0].interactionRules).toEqual([]);
    expect(project.screens[0].inputMode).toBe("mouse");
    expect(project.variables).toEqual([]);
    expect(() => crypto.randomUUID()).not.toThrow();
  });

  it("infers input modes for screens migrated from schema 1.8", () => {
    const project = createEmptyProject("Input mode migration");
    const [screen] = project.screens;
    const { inputMode: _inputMode, ...legacyScreen } = screen;
    const migrated = parseProject({
      ...project,
      schemaVersion: "1.8.0",
      screens: [{
        ...legacyScreen,
        device: {
          ...screen.device!,
          presetId: "iphone-15-pro",
          width: 393,
        },
      }],
    });

    expect(migrated.screens[0].inputMode).toBe("touch");
    expect(migrated.schemaVersion).toBe("1.9.0");
  });

  it("validates and round-trips variables, widgets, styles and interactions", () => {
    const project = createCompleteProject();

    expect(parseProject(project)).toEqual(project);
    expect(parseProject(serializeProject(project))).toEqual(project);
  });

  it("accepts the touch, mouse, gesture, and keyboard interaction events", () => {
    const project = createCompleteProject();
    const screen = project.screens[0];
    const events = [
      "onTap", "onDoubleTap", "onLongPress", "onSwipeLeft", "onSwipeRight",
      "onSwipeUp", "onSwipeDown", "onPinchIn", "onPinchOut", "onPan",
      "onClick", "onDoubleClick", "onRightClick", "onHover", "onMouseDown",
      "onMouseUp", "onFocus", "onBlur", "onKeyDown",
    ] as const;
    const validated = parseProject({
      ...project,
      screens: [{
        ...screen,
        interactionRules: events.map((event) => ({
          id: crypto.randomUUID(),
          widgetId: screen.widgets[0].id,
          event,
          conditions: [],
          actions: [{ type: "setVariable", target: "attempts", value: 1 }],
        })),
      }],
    });

    expect(validated.screens[0].interactionRules.map((rule) => rule.event)).toEqual(events);
  });

  it("validates nested dynamic-panel states, active state references, and the nesting limit", () => {
    const project = createCompleteProject();
    const button = project.screens[0].widgets[0];
    const panelId = crypto.randomUUID();
    const firstState = {
      id: crypto.randomUUID(),
      name: "Default",
      widgets: [{ ...button, id: crypto.randomUUID(), groupId: panelId }],
    };
    const panel = {
      ...button,
      id: panelId,
      type: "dynamic-panel",
      props: { states: [firstState], activeStateId: firstState.id },
    };
    const nested = {
      ...project,
      screens: [{
        ...project.screens[0],
        widgets: [panel],
      }],
    };
    expect(parseProject(nested).screens[0].widgets[0].props.activeStateId).toBe(firstState.id);
    expect(() => parseProject({
      ...nested,
      screens: [{
        ...nested.screens[0],
        widgets: [{ ...panel, props: { ...panel.props, activeStateId: crypto.randomUUID() } }],
      }],
    })).toThrow(/active state must reference/i);

    const makeNestedPanel = (remaining: number): Widget => {
      const state = {
        id: crypto.randomUUID(),
        name: "State 1",
        widgets: remaining > 1 ? [makeNestedPanel(remaining - 1)] : [],
      };
      return {
        ...panel,
        id: crypto.randomUUID(),
        props: { states: [state], activeStateId: state.id },
      };
    };
    expect(() => parseProject({
      ...nested,
      screens: [{
        ...nested.screens[0],
        widgets: [makeNestedPanel(6)],
      }],
    })).toThrow(/nested at most five levels/i);
  });

  it("migrates version 1.0 projects to the current schema", () => {
    const project = createCompleteProject();
    const { symbols: _symbols, ...legacy } = project;
    const migrated = parseProject({ ...legacy, schemaVersion: "1.0.0" });
    expect(migrated.schemaVersion).toBe("1.9.0");
    expect(migrated.symbols).toEqual([]);
  });

  it("migrates version 1.1 variables to typed project-scoped initial values", () => {
    const project = createCompleteProject();
    const legacy = {
      ...project,
      schemaVersion: "1.1.0",
      variables: [{
        id: crypto.randomUUID(),
        name: "attempts",
        type: "number",
        defaultValue: 2,
      }],
    };
    const migrated = parseProject(legacy);
    expect(migrated.variables).toEqual([{
      id: legacy.variables[0].id,
      name: "attempts",
      type: "number",
      initial: 2,
      scope: "project",
    }]);
  });

  it("migrates version 1.2 interaction rules to the current format", () => {
    const project = createCompleteProject();
    const migrated = parseProject({ ...project, schemaVersion: "1.2.0" });
    expect(migrated.schemaVersion).toBe("1.9.0");
    expect(migrated.screens[0].interactionRules[0].conditionMode).toBe("all");
    expect(migrated.screens[0].interactionRules[0].widgetId).toBeUndefined();
  });

  it("migrates version 1.5 projects with interaction-local variables", () => {
    const project = createCompleteProject();
    const migrated = parseProject({ ...project, schemaVersion: "1.5.0" });
    expect(migrated.schemaVersion).toBe("1.9.0");
    expect(migrated.screens[0].interactionRules[0].localVariables).toBeUndefined();
  });

  it("migrates version 1.6 projects and round-trips persisted flow positions", () => {
    const project = createCompleteProject();
    const legacy = { ...project, schemaVersion: "1.6.0" };
    expect(parseProject(legacy).schemaVersion).toBe("1.9.0");

    project.screens[0].flowPosition = { x: 320, y: 180 };
    expect(parseProject(serializeProject(project)).screens[0].flowPosition)
      .toEqual({ x: 320, y: 180 });
    expect(() => parseProject({
      ...project,
      screens: [{ ...project.screens[0], flowPosition: { x: Number.NaN, y: 0 } }],
    })).toThrow(/expected number/i);
  });

  it("validates and round-trips typed local variables on interaction rules", () => {
    const project = createCompleteProject();
    const rule = project.screens[0].interactionRules[0];
    rule.localVariables = [
      { name: "step", type: "number", initial: 1 },
      { name: "message", type: "string", initial: "ready" },
      { name: "enabled", type: "boolean", initial: true },
    ];
    const roundTrip = parseProject(serializeProject(project));
    expect(roundTrip.screens[0].interactionRules[0].localVariables).toEqual(rule.localVariables);
    expect(() => parseProject({
      ...project,
      screens: [{
        ...project.screens[0],
        interactionRules: [{
          ...rule,
          localVariables: [
            { name: "step", type: "number", initial: 1 },
            { name: "step", type: "string", initial: "two" },
          ],
        }],
      }],
    })).toThrow(/declared more than once/i);
    expect(() => parseProject({
      ...project,
      screens: [{
        ...project.screens[0],
        interactionRules: [{
          ...rule,
          localVariables: [{ name: "constructor", type: "string", initial: "blocked" }],
        }],
      }],
    })).toThrow(/non-reserved/i);
  });

  it("migrates 1.7 projects and round-trips widget annotations", () => {
    const project = createCompleteProject();
    const widget = project.screens[0].widgets[0];
    const legacy = { ...project, schemaVersion: "1.7.0" };
    expect(parseProject(legacy).schemaVersion).toBe("1.9.0");

    widget.notes = {
      description: "Supports **accessible** checkout.",
      requirementId: "REQ-104",
      priority: "high",
      status: "in review",
      tags: ["checkout", "accessibility"],
      custom: { owner: "Design systems" },
    };
    expect(parseProject(serializeProject(project))).toEqual(project);
    expect(() => parseProject({
      ...project,
      screens: [{
        ...project.screens[0],
        widgets: [{ ...widget, notes: { ...widget.notes, priority: "urgent" } }],
      }],
    })).toThrow(/priority/i);
  });

  it("migrates legacy named dynamic-panel states to stable IDs", () => {
    const project = createCompleteProject();
    const button = project.screens[0].widgets[0];
    const panel: Widget = {
      ...button,
      id: crypto.randomUUID(),
      type: "dynamic-panel",
      props: { states: ["Closed", "Open"], activeStateId: "Open" },
    };
    const legacy = {
      ...project,
      schemaVersion: "1.3.0",
      screens: [{
        ...project.screens[0],
        widgets: [panel],
      }],
    };

    const migrated = parseProject(legacy).screens[0].widgets[0];
    expect(migrated.props.states).toEqual([
      expect.objectContaining({ name: "Closed", widgets: [] }),
      expect.objectContaining({ name: "Open", widgets: [] }),
    ]);
    expect(migrated.props.activeStateId).toBe(
      (migrated.props.states as Array<{ id: string; name: string }>)[1].id,
    );
  });

  it("requires valid names, unique scope names, and a screen for local variables", () => {
    const project = createCompleteProject();
    const screenId = project.screens[0].id;
    expect(() => parseProject({
      ...project,
      variables: [
        { id: crypto.randomUUID(), name: "bad-name", type: "string", initial: "", scope: "project" },
      ],
    })).toThrow(/valid variable identifier/i);
    expect(() => parseProject({
      ...project,
      variables: [
        ...project.variables,
        { ...project.variables[0], id: crypto.randomUUID() },
      ],
    })).toThrow(/already exists in this scope/i);
    expect(() => parseProject({
      ...project,
      variables: [
        { id: crypto.randomUUID(), name: "local", type: "boolean", initial: false, scope: "screen" },
      ],
    })).toThrow(/must reference a screen/i);
    expect(parseProject({
      ...project,
      variables: [
        ...project.variables,
        { id: crypto.randomUUID(), name: "attempts", type: "number", initial: 1, scope: "screen", screenId },
      ],
    }).variables).toHaveLength(2);
  });

  it("validates symbol-instance references", () => {
    const project = createCompleteProject();
    const [screen] = project.screens;
    const instance = {
      ...screen.widgets[0],
      type: "symbol-instance",
      symbolId: crypto.randomUUID(),
    };
    expect(() =>
      parseProject({
        ...project,
        screens: [{ ...screen, widgets: [instance] }],
      }),
    ).toThrow(/Symbol instance must reference an existing symbol/);
  });

  it("round-trips symbol masters and instance references", () => {
    const project = createCompleteProject();
    const source = project.screens[0].widgets[0];
    const master = { ...source, id: crypto.randomUUID() };
    const symbol = {
      id: crypto.randomUUID(),
      name: "Checkout button",
      width: source.width,
      height: source.height,
      widgets: [master],
    };
    const instance = {
      ...source,
      id: crypto.randomUUID(),
      type: "symbol-instance",
      name: symbol.name,
      symbolId: symbol.id,
    };
    const withSymbol: Project = {
      ...project,
      symbols: [symbol],
      screens: [
        {
          ...project.screens[0],
          widgets: [instance],
        },
      ],
    };

    expect(parseProject(serializeProject(withSymbol))).toEqual(withSymbol);
  });

  it("omits the transient image preview when the widget references a saved asset", () => {
    const project = createCompleteProject();
    const screen = project.screens[0];
    const image = {
      ...screen.widgets[0],
      type: "image",
      props: {
        src: "data:image/png;base64,embedded-preview",
        mime: "image/png",
        assetPath: "assets/image.png",
      },
    };
    const saved = parseProject(
      serializeProject({
        ...project,
        screens: [{ ...screen, widgets: [image] }],
      }),
    );

    expect(saved.screens[0].widgets[0].props).toEqual({
      mime: "image/png",
      assetPath: "assets/image.png",
    });
  });

  it("accepts four independent rectangle corner radii", () => {
    const project = createCompleteProject();
    const screen = project.screens[0];
    const widget = screen.widgets[0];
    const rounded = {
      ...project,
      screens: [
        {
          ...screen,
          widgets: [
            { ...widget, style: { ...widget.style, cornerRadius: [2, 4, 6, 8] } },
          ],
        },
      ],
    };

    expect(parseProject(rounded).screens[0].widgets[0].style.cornerRadius).toEqual([
      2, 4, 6, 8,
    ]);
    expect(() =>
      parseProject({
        ...rounded,
        screens: [
          {
            ...screen,
            widgets: [
              { ...widget, style: { ...widget.style, cornerRadius: [2, 4, 6] } },
            ],
          },
        ],
      }),
    ).toThrow(SchemaValidationError);
  });

  it("persists supported appearance controls and text styling", () => {
    const project = createCompleteProject();
    const screen = project.screens[0];
    const widget = screen.widgets[0];
    const styled: Project = {
      ...project,
      screens: [
        {
          ...screen,
          widgets: [{
            ...widget,
            style: {
              ...widget.style,
              fillOpacity: 0.45,
              strokeOpacity: 0.8,
              dash: [8, 4],
              lineCap: "square",
              lineJoin: "bevel",
              blendMode: "multiply",
              shadow: { ...widget.style.shadow, opacity: 0.3 },
            },
            props: {
              ...widget.props,
              fontFamily: "Georgia",
              fontSize: 18,
              fontWeight: "bold",
              fontStyle: "italic",
              underline: true,
              verticalAlign: "middle",
              letterSpacing: 1.5,
            },
          }],
        },
      ],
    };

    expect(parseProject(serializeProject(styled))).toEqual(styled);
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
            interactionRules: [{ ...rule, event: "onDefinitelyNotAnEvent" }],
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

  it("keeps variable initial values aligned with their declared types", () => {
    const project = createEmptyProject();

    expect(() =>
      parseProject({
        ...project,
        variables: [
          {
            id: crypto.randomUUID(),
            name: "enabled",
            type: "boolean",
            initial: "true",
            scope: "project",
          },
        ],
      }),
    ).toThrow(SchemaValidationError);
  });

  it("rejects reserved JavaScript keywords as variable names", () => {
    const project = createEmptyProject();
    expect(() => parseProject({
      ...project,
      variables: [{
        id: crypto.randomUUID(),
        name: "const",
        type: "string",
        initial: "",
        scope: "project",
      }],
    })).toThrow(/valid variable identifier/i);
  });
});
