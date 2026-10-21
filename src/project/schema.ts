import { z } from "zod";
import { DEFAULT_DEVICE_PRESET, toScreenDevice } from "../devices/catalog";
import { ScreenDeviceSchema } from "../devices/schema";
import type { ScreenDevice } from "../devices/types";

export const PROJECT_SCHEMA_VERSION = "1.2.0";
const LEGACY_PROJECT_SCHEMA_VERSIONS = new Set(["1.0.0", "1.1.0"]);
const COORDINATE_LIMIT = 100_000;
const HexColorSchema = z
  .string()
  .regex(/^#(?:[\da-f]{3}|[\da-f]{4}|[\da-f]{6}|[\da-f]{8})$/i, "Expected a hex color.");
const RESERVED_VARIABLE_NAMES = new Set([
  "await", "break", "case", "catch", "class", "const", "continue", "debugger",
  "default", "delete", "do", "else", "enum", "export", "extends", "false",
  "finally", "for", "function", "if", "import", "in", "instanceof", "new",
  "null", "return", "super", "switch", "this", "throw", "true", "try",
  "typeof", "var", "void", "while", "with", "yield",
]);

export function isValidVariableName(name: string): boolean {
  return /^[A-Za-z_$][\w$]{0,119}$/.test(name) &&
    !RESERVED_VARIABLE_NAMES.has(name);
}

const VariableDefinitionBase = z.object({
  id: z.string().uuid(),
  name: z.string().trim().refine(isValidVariableName, "Use a valid variable identifier."),
  scope: z.enum(["project", "screen"]),
  screenId: z.string().uuid().optional(),
});

export const VariableDefinitionSchema = z.discriminatedUnion("type", [
  VariableDefinitionBase.extend({
    type: z.literal("string"),
    initial: z.string(),
  }).strict(),
  VariableDefinitionBase.extend({
    type: z.literal("number"),
    initial: z.number().finite(),
  }).strict(),
  VariableDefinitionBase.extend({
    type: z.literal("boolean"),
    initial: z.boolean(),
  }).strict(),
]).superRefine((variable, context) => {
  if (variable.scope === "screen" && !variable.screenId) {
    context.addIssue({
      code: "custom",
      path: ["screenId"],
      message: "Screen-scoped variables must reference a screen.",
    });
  }
  if (variable.scope === "project" && variable.screenId) {
    context.addIssue({
      code: "custom",
      path: ["screenId"],
      message: "Project-scoped variables cannot reference a screen.",
    });
  }
});

export const InteractionConditionSchema = z
  .object({
    variable: z.string().trim().min(1),
    operator: z.enum([
      "equals",
      "notEquals",
      "greaterThan",
      "greaterThanOrEqual",
      "lessThan",
      "lessThanOrEqual",
      "contains",
    ]),
    value: z.unknown(),
  })
  .strict();

export const InteractionActionSchema = z
  .object({
    type: z.string().trim().min(1),
    target: z.string().trim().min(1),
    value: z.unknown().optional(),
  })
  .strict();

export const InteractionRuleSchema = z
  .object({
    id: z.string().uuid(),
    event: z.enum(["onClick", "onHover", "onChange", "onLoad"]),
    conditions: z.array(InteractionConditionSchema),
    actions: z.array(InteractionActionSchema).min(1),
  })
  .strict();

export const WidgetShadowSchema = z
  .object({
    color: HexColorSchema.optional(),
    blur: z.number().finite().nonnegative().optional(),
    offsetX: z.number().finite().optional(),
    offsetY: z.number().finite().optional(),
    opacity: z.number().finite().min(0).max(1).optional(),
  })
  .strict();

export const WidgetStyleSchema = z
  .object({
    fill: HexColorSchema.nullable().optional(),
    fillOpacity: z.number().finite().min(0).max(1).optional(),
    stroke: HexColorSchema.nullable().optional(),
    strokeOpacity: z.number().finite().min(0).max(1).optional(),
    strokeWidth: z.number().finite().nonnegative().optional(),
    dash: z.array(z.number().finite().nonnegative()).optional(),
    lineCap: z.enum(["butt", "round", "square"]).optional(),
    lineJoin: z.enum(["miter", "round", "bevel"]).optional(),
    cornerRadius: z
      .union([
        z.number().finite().nonnegative(),
        z.array(z.number().finite().nonnegative()).length(4),
      ])
      .optional(),
    shadow: WidgetShadowSchema.optional(),
    blendMode: z.enum([
      "source-over",
      "multiply",
      "screen",
      "overlay",
      "darken",
      "lighten",
      "color-dodge",
      "color-burn",
      "hard-light",
      "soft-light",
      "difference",
      "exclusion",
    ]).optional(),
  })
  .strict();

export const BreakpointSchema = z.object({
  id: z.string().trim().min(1).max(120),
  name: z.string().trim().min(1).max(80),
  minWidth: z.number().int().min(0).max(16_384),
  maxWidth: z.number().int().min(1).max(16_384).optional(),
  width: z.number().int().min(1).max(16_384),
  height: z.number().int().min(1).max(16_384),
}).strict().superRefine((breakpoint, context) => {
  if (breakpoint.maxWidth !== undefined && breakpoint.maxWidth < breakpoint.minWidth) {
    context.addIssue({
      code: "custom",
      path: ["maxWidth"],
      message: "Maximum width must be greater than or equal to minimum width.",
    });
  }
  if (
    breakpoint.width < breakpoint.minWidth ||
    (breakpoint.maxWidth !== undefined && breakpoint.width > breakpoint.maxWidth)
  ) {
    context.addIssue({
      code: "custom",
      path: ["width"],
      message: "Canvas width must be within the breakpoint range.",
    });
  }
});

export const WidgetOverrideSchema = z.object({
  x: z.number().finite().min(-COORDINATE_LIMIT).max(COORDINATE_LIMIT).optional(),
  y: z.number().finite().min(-COORDINATE_LIMIT).max(COORDINATE_LIMIT).optional(),
  width: z.number().finite().min(1).optional(),
  height: z.number().finite().min(1).optional(),
  rotation: z.number().finite().optional(),
  visible: z.boolean().optional(),
  style: WidgetStyleSchema.partial().optional(),
  props: z.record(z.string(), z.unknown()).optional(),
}).strict();

export const WidgetCascadeModeSchema = z.enum(["absolute", "stack", "fluid", "hide"]);
export const ResponsiveConstraintsSchema = z.object({
  horizontal: z.enum(["left", "right", "center", "scale", "stretch"]),
  vertical: z.enum(["top", "bottom", "center", "scale", "stretch"]),
}).strict();

export const ProtoWidgetSchema = z
  .object({
    id: z.string().uuid(),
    type: z.string().trim().min(1),
    name: z.string().trim().min(1).max(120).optional(),
    groupId: z.string().uuid().optional(),
    layerCategory: z.enum(["shapes", "widgets", "advanced", "symbols", "containers", "other"]).optional(),
    x: z.number().finite().min(-COORDINATE_LIMIT).max(COORDINATE_LIMIT),
    y: z.number().finite().min(-COORDINATE_LIMIT).max(COORDINATE_LIMIT),
    width: z.number().finite().min(1),
    height: z.number().finite().min(1),
    rotation: z.number().finite(),
    opacity: z.number().finite().min(0).max(1),
    visible: z.boolean(),
    locked: z.boolean(),
    zIndex: z.number().int(),
    symbolId: z.string().uuid().optional(),
    style: WidgetStyleSchema,
    props: z.record(z.string(), z.unknown()),
    cascadeMode: WidgetCascadeModeSchema.optional(),
    constraints: ResponsiveConstraintsSchema.optional(),
    important: z.boolean().optional(),
    overrides: z.record(z.string(), WidgetOverrideSchema).optional(),
  })
  .strict();

export const SymbolDefinitionSchema = z.object({
  id: z.string().uuid(),
  name: z.string().trim().min(1).max(120),
  width: z.number().finite().min(1),
  height: z.number().finite().min(1),
  widgets: z.array(ProtoWidgetSchema).min(1),
}).strict();

export const ProtoScreenSchema = z
  .object({
    id: z.string().uuid(),
    name: z.string().trim().min(1).max(120),
    device: ScreenDeviceSchema.optional(),
    breakpoints: z.array(BreakpointSchema).optional(),
    widgets: z.array(ProtoWidgetSchema),
    interactionRules: z.array(InteractionRuleSchema),
  }).strict().superRefine((screen, context) => {
    const ids = new Set<string>();
    for (const [index, breakpoint] of (screen.breakpoints ?? []).entries()) {
      if (ids.has(breakpoint.id)) {
        context.addIssue({
          code: "custom",
          path: ["breakpoints", index, "id"],
          message: `Duplicate breakpoint ID: ${breakpoint.id}.`,
        });
      }
      ids.add(breakpoint.id);
      for (const [otherIndex, other] of (screen.breakpoints ?? []).entries()) {
        if (
          otherIndex <= index ||
          (breakpoint.maxWidth !== undefined && breakpoint.maxWidth < other.minWidth) ||
          (other.maxWidth !== undefined && other.maxWidth < breakpoint.minWidth)
        ) {
          continue;
        }
        context.addIssue({
          code: "custom",
          path: ["breakpoints", index, "minWidth"],
          message: `Breakpoint range overlaps "${other.name}".`,
        });
      }
    }
    const breakpointIds = new Set((screen.breakpoints ?? []).map((item) => item.id));
    for (const [widgetIndex, widget] of screen.widgets.entries()) {
      for (const breakpointId of Object.keys(widget.overrides ?? {})) {
        if (!breakpointIds.has(breakpointId)) {
          context.addIssue({
            code: "custom",
            path: ["widgets", widgetIndex, "overrides", breakpointId],
            message: "Widget override references an unknown breakpoint.",
          });
        }
      }
    }
  });

export const ProtoFlowProjectSchema = z
  .object({
    schemaVersion: z.literal(PROJECT_SCHEMA_VERSION),
    id: z.string().uuid(),
    name: z.string().trim().min(1).max(120),
    createdAt: z.iso.datetime(),
    updatedAt: z.iso.datetime(),
    variables: z.array(VariableDefinitionSchema),
    screens: z.array(ProtoScreenSchema).min(1),
    symbols: z.array(SymbolDefinitionSchema),
    startScreenId: z.string().uuid(),
  })
  .strict()
  .superRefine((project, context) => {
    const variableNames = new Set<string>();
    const screenIds = new Set(project.screens.map((screen) => screen.id));
    for (const [index, variable] of project.variables.entries()) {
      const scopeKey = `${variable.scope}:${variable.screenId ?? ""}:${variable.name}`;
      if (variableNames.has(scopeKey)) {
        context.addIssue({
          code: "custom",
          path: ["variables", index, "name"],
          message: `Variable "${variable.name}" already exists in this scope.`,
        });
      }
      variableNames.add(scopeKey);
      if (variable.scope === "screen" && variable.screenId && !screenIds.has(variable.screenId)) {
        context.addIssue({
          code: "custom",
          path: ["variables", index, "screenId"],
          message: "Screen-scoped variable must reference an existing screen.",
        });
      }
    }

    const symbolIds = new Set<string>();
    for (const [index, symbol] of project.symbols.entries()) {
      if (symbolIds.has(symbol.id)) {
        context.addIssue({
          code: "custom",
          path: ["symbols", index, "id"],
          message: `Duplicate symbol ID: ${symbol.id}.`,
        });
      }
      symbolIds.add(symbol.id);
    }
    for (const [screenIndex, screen] of project.screens.entries()) {
      for (const [widgetIndex, widget] of screen.widgets.entries()) {
        if (widget.type === "symbol-instance" && !symbolIds.has(widget.symbolId ?? "")) {
          context.addIssue({
            code: "custom",
            path: ["screens", screenIndex, "widgets", widgetIndex, "symbolId"],
            message: "Symbol instance must reference an existing symbol.",
          });
        }
      }
    }
    if (!project.screens.some((screen) => screen.id === project.startScreenId)) {
      context.addIssue({
        code: "custom",
        path: ["startScreenId"],
        message: "Start screen must reference an existing screen.",
      });
    }
  });

export const ProjectSchema = ProtoFlowProjectSchema;

export type VariableDefinition = z.infer<typeof VariableDefinitionSchema>;
export type InteractionCondition = z.infer<typeof InteractionConditionSchema>;
export type InteractionAction = z.infer<typeof InteractionActionSchema>;
export type InteractionRule = z.infer<typeof InteractionRuleSchema>;
export type WidgetShadow = z.infer<typeof WidgetShadowSchema>;
export type WidgetStyle = z.infer<typeof WidgetStyleSchema>;
export type Widget = z.infer<typeof ProtoWidgetSchema>;
export type SymbolDefinition = z.infer<typeof SymbolDefinitionSchema>;
export type WidgetOverride = z.infer<typeof WidgetOverrideSchema>;
export type Breakpoint = z.infer<typeof BreakpointSchema>;
export type WidgetCascadeMode = z.infer<typeof WidgetCascadeModeSchema>;
export type ResponsiveConstraints = z.infer<typeof ResponsiveConstraintsSchema>;
export type { ScreenDevice };
export type Screen = z.infer<typeof ProtoScreenSchema>;
export type ProtoWidget = Widget;
export type ProtoScreen = Screen;
export type ProtoFlowProject = z.infer<typeof ProtoFlowProjectSchema>;
export type Project = ProtoFlowProject;

export class SchemaValidationError extends Error {
  readonly issues: z.ZodIssue[];

  constructor(issues: z.ZodIssue[]) {
    const detail = issues
      .map((issue) => {
        const path = issue.path.length ? issue.path.join(".") : "project";
        return `${path}: ${issue.message}`;
      })
      .join("; ");
    super(`Project validation failed: ${detail}`);
    this.name = "SchemaValidationError";
    this.issues = issues;
  }
}

export function formatProjectValidationError(error: SchemaValidationError): string {
  const versionIssue = error.issues.find(
    (issue) => issue.path.length === 1 && issue.path[0] === "schemaVersion",
  );
  if (versionIssue) {
    return versionIssue.message;
  }
  return error.message;
}

export function parseProject(raw: unknown): Project {
  let value = raw;
  if (typeof raw === "string") {
    try {
      value = JSON.parse(raw) as unknown;
    } catch (error) {
      const message = error instanceof Error ? error.message : "Invalid JSON.";
      throw new SchemaValidationError([
        { code: "custom", message: `Invalid JSON: ${message}`, path: [], input: raw },
      ]);
    }
  }

  if (typeof value === "object" && value !== null && "schemaVersion" in value &&
    typeof value.schemaVersion === "string" &&
    LEGACY_PROJECT_SCHEMA_VERSIONS.has(value.schemaVersion)) {
    const variables = "variables" in value && Array.isArray(value.variables)
      ? value.variables.map((variable: unknown) => {
          if (typeof variable !== "object" || variable === null || Array.isArray(variable)) {
            return variable;
          }
          const oldVariable = variable as Record<string, unknown>;
          const { defaultValue, ...rest } = oldVariable;
          return {
            ...rest,
            scope: oldVariable.scope ?? "project",
            initial: oldVariable.initial ?? defaultValue ?? (
              oldVariable.type === "string" ? "" :
                oldVariable.type === "number" ? 0 : false
            ),
          };
        })
      : [];
    value = {
      ...value,
      schemaVersion: PROJECT_SCHEMA_VERSION,
      symbols: "symbols" in value && Array.isArray(value.symbols) ? value.symbols : [],
      variables,
    };
  }

  if (
    typeof value === "object" &&
    value !== null &&
    "schemaVersion" in value &&
    typeof value.schemaVersion === "string" &&
    value.schemaVersion !== PROJECT_SCHEMA_VERSION &&
    !LEGACY_PROJECT_SCHEMA_VERSIONS.has(value.schemaVersion)
  ) {
    throw new SchemaValidationError([
      {
        code: "custom",
        path: ["schemaVersion"],
        message: `Incompatible schema version (${value.schemaVersion}). Please update Proto Flow.`,
        input: value.schemaVersion,
      },
    ]);
  }

  const result = ProtoFlowProjectSchema.safeParse(value);
  if (!result.success) {
    throw new SchemaValidationError(result.error.issues);
  }
  return result.data;
}

export function createEmptyProject(name = "Untitled project"): Project {
  const now = new Date().toISOString();
  const screenId = crypto.randomUUID();
  return parseProject({
    schemaVersion: PROJECT_SCHEMA_VERSION,
    id: crypto.randomUUID(),
    name,
    createdAt: now,
    updatedAt: now,
    variables: [],
    symbols: [],
    screens: [
      {
        id: screenId,
        name: "Screen 1",
        device: toScreenDevice(DEFAULT_DEVICE_PRESET),
        breakpoints: [
          { id: "mobile", name: "Mobile", minWidth: 0, maxWidth: 767, width: 390, height: 844 },
          { id: "tablet", name: "Tablet", minWidth: 768, maxWidth: 1023, width: 768, height: 1024 },
          { id: "desktop", name: "Desktop", minWidth: 1024, width: 1440, height: 900 },
        ],
        widgets: [],
        interactionRules: [],
      },
    ],
    startScreenId: screenId,
  });
}

export const createProject = createEmptyProject;

export function serializeProject(project: Project): string {
  const serializableProject = {
    ...project,
    screens: project.screens.map((screen) => ({
      ...screen,
      widgets: screen.widgets.map((widget) => {
        if (typeof widget.props.assetPath !== "string") return widget;
        const props = { ...widget.props };
        delete props.src;
        return { ...widget, props };
      }),
    })),
  };
  return `${JSON.stringify(parseProject(serializableProject), null, 2)}\n`;
}
