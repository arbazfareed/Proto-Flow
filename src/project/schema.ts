import { z } from "zod";
import { DEFAULT_DEVICE_PRESET, toScreenDevice } from "../devices/catalog";
import { ScreenDeviceSchema } from "../devices/schema";
import type { ScreenDevice } from "../devices/types";
import { inferScreenInputMode, type ScreenInputMode } from "./inputModes";
import {
  InteractionRuleSchema,
} from "./interactionSchema";
export {
  InteractionActionSchema,
  InteractionConditionSchema,
  InteractionRuleSchema,
} from "./interactionSchema";
export type {
  InteractionAction,
  InteractionCondition,
  InteractionLocalVariable,
  InteractionRule,
} from "./interactionSchema";

export const PROJECT_SCHEMA_VERSION = "1.9.0";
const LEGACY_PROJECT_SCHEMA_VERSIONS = new Set(["1.0.0", "1.1.0", "1.2.0", "1.3.0", "1.4.0", "1.5.0", "1.6.0", "1.7.0", "1.8.0"]);
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

export const WidgetNotesSchema = z.object({
  description: z.string().max(20_000).default(""),
  requirementId: z.string().trim().max(120).default(""),
  priority: z.enum(["low", "medium", "high", "critical"]).default("low"),
  status: z.enum(["draft", "in review", "approved", "blocked"]).default("draft"),
  tags: z.array(z.string().trim().min(1).max(60)).max(50).default([]),
  custom: z.record(z.string().trim().min(1).max(80), z.string().max(1_000)).default({}),
}).strict();

export const RichTextMarksSchema = z.object({
  bold: z.boolean().optional(),
  italic: z.boolean().optional(),
  underline: z.boolean().optional(),
  strike: z.boolean().optional(),
  code: z.boolean().optional(),
  link: z.string().max(2_000).optional(),
  highlight: HexColorSchema.optional(),
  color: HexColorSchema.optional(),
  fontSize: z.number().finite().min(1).max(500).optional(),
  list: z.enum(["bullet", "number"]).optional(),
}).strict();

export const RichTextRunSchema = z.object({
  text: z.string().max(20_000),
  marks: RichTextMarksSchema.default({}),
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
    notes: WidgetNotesSchema.optional(),
  })
  .strict()
  .superRefine((widget, context) => {
    const runs = widget.props.richTextRuns;
    if (widget.props.richText !== undefined && typeof widget.props.richText !== "boolean") {
      context.addIssue({
        code: "custom",
        path: ["props", "richText"],
        message: "Rich text mode must be a boolean.",
      });
    }
    if (runs === undefined) return;
    if (!Array.isArray(runs) || runs.length > 1_000) {
      context.addIssue({
        code: "custom",
        path: ["props", "richTextRuns"],
        message: "Rich text content must contain at most 1,000 runs.",
      });
      return;
    }
    let totalLength = 0;
    runs.forEach((run, index) => {
      const parsed = RichTextRunSchema.safeParse(run);
      if (!parsed.success) {
        context.addIssue({
          code: "custom",
          path: ["props", "richTextRuns", index],
          message: "Rich text run is invalid.",
        });
        return;
      }
      totalLength += parsed.data.text.length;
    });
    if (totalLength > 20_000) {
      context.addIssue({
        code: "custom",
        path: ["props", "richTextRuns"],
        message: "Rich text cannot exceed 20,000 characters.",
      });
    }
  });

const DynamicPanelStateSchema = z.object({
  id: z.string().uuid(),
  name: z.string().trim().min(1).max(120),
  widgets: z.array(ProtoWidgetSchema),
}).strict();

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
    flowPosition: z.object({
      x: z.number().finite().min(-COORDINATE_LIMIT).max(COORDINATE_LIMIT),
      y: z.number().finite().min(-COORDINATE_LIMIT).max(COORDINATE_LIMIT),
    }).strict().optional(),
    device: ScreenDeviceSchema.optional(),
    inputMode: z.enum(["touch", "mouse", "both"]).default("both"),
    compactLayout: z.boolean().optional(),
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
      const widgetIds = new Set<string>();
      const validateWidgets = (widgets: Widget[], basePath: (string | number)[], panelDepth: number) => {
        for (const [widgetIndex, widget] of widgets.entries()) {
          const widgetPath = [...basePath, widgetIndex];
          if (widgetIds.has(widget.id)) {
            context.addIssue({
              code: "custom",
              path: [...widgetPath, "id"],
              message: `Duplicate widget ID: ${widget.id}.`,
            });
          }
          widgetIds.add(widget.id);
        if (widget.type === "symbol-instance" && !symbolIds.has(widget.symbolId ?? "")) {
          context.addIssue({
            code: "custom",
            path: [...widgetPath, "symbolId"],
            message: "Symbol instance must reference an existing symbol.",
          });
        }
          if (widget.type === "repeater") {
            const dataset = widget.props.dataset;
            if (!Array.isArray(dataset) || dataset.length > 1_000 ||
              dataset.some((row) => typeof row !== "object" || row === null || Array.isArray(row))) {
              context.addIssue({
                code: "custom",
                path: [...widgetPath, "props", "dataset"],
                message: "Repeater dataset must contain at most 1,000 record objects.",
              });
            }
            if (Array.isArray(dataset)) {
              for (const [rowIndex, row] of dataset.entries()) {
                if (typeof row !== "object" || row === null || Array.isArray(row)) continue;
                for (const [field, fieldValue] of Object.entries(row)) {
                  if (fieldValue !== null &&
                    typeof fieldValue !== "string" &&
                    typeof fieldValue !== "number" &&
                    typeof fieldValue !== "boolean") {
                    context.addIssue({
                      code: "custom",
                      path: [...widgetPath, "props", "dataset", rowIndex, field],
                      message: "Repeater fields must be text, numbers, booleans, or null.",
                    });
                  }
                }
              }
            }
            const layout = widget.props.layout;
            if (layout !== undefined && layout !== "vertical" && layout !== "horizontal" && layout !== "grid") {
              context.addIssue({
                code: "custom",
                path: [...widgetPath, "props", "layout"],
                message: "Repeater layout must be vertical, horizontal, or grid.",
              });
            }
            if (widget.props.gap !== undefined &&
              (typeof widget.props.gap !== "number" || !Number.isFinite(widget.props.gap) || widget.props.gap < 0)) {
              context.addIssue({
                code: "custom",
                path: [...widgetPath, "props", "gap"],
                message: "Repeater gap must be a non-negative finite number.",
              });
            }
            const template = widget.props.rowTemplate;
            if (typeof template !== "object" || template === null || Array.isArray(template) ||
              !Array.isArray((template as Record<string, unknown>).widgets)) {
              context.addIssue({
                code: "custom",
                path: [...widgetPath, "props", "rowTemplate"],
                message: "Repeater row template must contain a widgets array.",
              });
            } else {
              const templateWidgets = (template as { widgets: Widget[] }).widgets;
              validateWidgets(
                templateWidgets,
                [...widgetPath, "props", "rowTemplate", "widgets"],
                panelDepth,
              );
              const bindings = widget.props.itemBinding;
              if (bindings !== undefined &&
                (typeof bindings !== "object" || bindings === null || Array.isArray(bindings) ||
                  Object.entries(bindings).some(([field, id]) =>
                    !field.trim() || typeof id !== "string" ||
                    !templateWidgets.some((child) => child.id === id),
                  ))) {
                context.addIssue({
                  code: "custom",
                  path: [...widgetPath, "props", "itemBinding"],
                  message: "Repeater bindings must map field names to widgets in its row template.",
                });
              }
            }
          }
          if (widget.type !== "dynamic-panel") continue;
          if (panelDepth >= 5) {
            context.addIssue({
              code: "custom",
              path: widgetPath,
              message: "Dynamic panels may be nested at most five levels deep.",
            });
          }
          if (!("states" in widget.props)) continue;
          const parsedStates = z.array(DynamicPanelStateSchema).safeParse(widget.props.states);
          if (!parsedStates.success) {
            for (const issue of parsedStates.error.issues) {
              context.addIssue({
                ...issue,
                path: [...widgetPath, "props", "states", ...issue.path],
              });
            }
            continue;
          }
          const states = parsedStates.data;
          if (states.length === 0) {
            context.addIssue({
              code: "custom",
              path: [...widgetPath, "props", "states"],
              message: "A dynamic panel must have at least one state.",
            });
          }
          const stateIds = new Set<string>();
          for (const [stateIndex, state] of states.entries()) {
            if (stateIds.has(state.id)) {
              context.addIssue({
                code: "custom",
                path: [...widgetPath, "props", "states", stateIndex, "id"],
                message: `Duplicate dynamic-panel state ID: ${state.id}.`,
              });
            }
            stateIds.add(state.id);
            const childDepth = panelDepth + 1;
            validateWidgets(
              state.widgets,
              [...widgetPath, "props", "states", stateIndex, "widgets"],
              childDepth,
            );
          }
          const activeStateId = widget.props.activeStateId;
          if (activeStateId !== undefined &&
            (typeof activeStateId !== "string" || !stateIds.has(activeStateId))) {
            context.addIssue({
              code: "custom",
              path: [...widgetPath, "props", "activeStateId"],
              message: "Active state must reference a state belonging to this panel.",
            });
          }
        }
      };
      validateWidgets(screen.widgets, ["screens", screenIndex, "widgets"], 0);
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
export type WidgetShadow = z.infer<typeof WidgetShadowSchema>;
export type WidgetStyle = z.infer<typeof WidgetStyleSchema>;
export type Widget = z.infer<typeof ProtoWidgetSchema>;
export type WidgetNotes = z.infer<typeof WidgetNotesSchema>;
export type RichTextMarks = z.infer<typeof RichTextMarksSchema>;
export type RichTextRun = z.infer<typeof RichTextRunSchema>;
export type SymbolDefinition = z.infer<typeof SymbolDefinitionSchema>;
export type WidgetOverride = z.infer<typeof WidgetOverrideSchema>;
export type Breakpoint = z.infer<typeof BreakpointSchema>;
export type WidgetCascadeMode = z.infer<typeof WidgetCascadeModeSchema>;
export type ResponsiveConstraints = z.infer<typeof ResponsiveConstraintsSchema>;
export type { ScreenDevice };
export type { ScreenInputMode };
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

function migrateDynamicPanelWidgets(widgets: unknown[]): unknown[] {
  return widgets.map((value) => {
    if (typeof value !== "object" || value === null || Array.isArray(value)) return value;
    const widget = value as Record<string, unknown>;
    if (typeof widget.props !== "object" ||
      widget.props === null ||
      Array.isArray(widget.props)) {
      return value;
    }
    const props = widget.props as Record<string, unknown>;
    if (widget.type === "repeater") {
      const rowTemplate = typeof props.rowTemplate === "object" && props.rowTemplate !== null &&
        !Array.isArray(props.rowTemplate)
        ? props.rowTemplate as Record<string, unknown>
        : {};
      return {
        ...widget,
        props: {
          ...props,
          rowTemplate: {
            ...rowTemplate,
            widgets: Array.isArray(rowTemplate.widgets)
              ? migrateDynamicPanelWidgets(rowTemplate.widgets)
              : [],
          },
          dataset: Array.isArray(props.dataset) ? props.dataset.slice(0, 1_000) : [],
          layout: props.layout === "horizontal" || props.layout === "grid" ? props.layout : "vertical",
          gap: typeof props.gap === "number" && Number.isFinite(props.gap) && props.gap >= 0
            ? props.gap
            : 8,
          itemBinding: typeof props.itemBinding === "object" && props.itemBinding !== null &&
            !Array.isArray(props.itemBinding) ? props.itemBinding : {},
        },
      };
    }
    if (widget.type !== "dynamic-panel") {
      return {
        ...widget,
        props: Object.fromEntries(Object.entries(props).map(([key, child]) =>
          key === "rowTemplate" && typeof child === "object" && child !== null &&
          !Array.isArray(child) && "widgets" in child && Array.isArray(child.widgets)
            ? [key, { ...child, widgets: migrateDynamicPanelWidgets(child.widgets) }]
            : [key, child],
        )),
      };
    }
    if (!Array.isArray(props.states)) return value;
    if (props.states.every((state) => typeof state === "string")) {
      const legacyNames = props.states.length > 0 ? props.states : ["State 1"];
      const states = legacyNames.map((name, index) => ({
        id: crypto.randomUUID(),
        name: typeof name === "string" && name.trim() ? name.trim() : `State ${index + 1}`,
        widgets: [],
      }));
      const priorActive = props.activeStateId;
      const selected = states.find((state) => state.name === priorActive) ?? states[0];
      return {
        ...widget,
        props: {
          ...props,
          states,
          activeStateId: selected?.id,
        },
      };
    }
    const states = props.states.map((state, index) => {
      if (typeof state !== "object" || state === null || Array.isArray(state)) return state;
      const prior = state as Record<string, unknown>;
      return {
        ...prior,
        id: typeof prior.id === "string" && z.string().uuid().safeParse(prior.id).success
          ? prior.id
          : crypto.randomUUID(),
        name: typeof prior.name === "string" && prior.name.trim()
          ? prior.name
          : `State ${index + 1}`,
        widgets: Array.isArray(prior.widgets)
          ? migrateDynamicPanelWidgets(prior.widgets)
          : [],
      };
    });
    const activeId = typeof props.activeStateId === "string"
      ? states.find((state) =>
          typeof state === "object" && state !== null && "id" in state &&
          state.id === props.activeStateId,
        )
      : undefined;
    const activeStateId = typeof activeId === "object" && activeId !== null && "id" in activeId
      ? activeId.id
      : (states[0] && typeof states[0] === "object" && states[0] !== null && "id" in states[0]
          ? states[0].id
          : undefined);
    return {
      ...widget,
      props: { ...props, states, activeStateId },
    };
  });
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
          const migratedVariable = { ...rest };
          if (!("scope" in migratedVariable)) migratedVariable.scope = "project";
          if (!("initial" in migratedVariable)) {
            migratedVariable.initial = defaultValue ?? (
              oldVariable.type === "string" ? "" :
                oldVariable.type === "number" ? 0 : false
            );
          }
          return migratedVariable;
        })
      : [];
    const screens = "screens" in value && Array.isArray(value.screens)
      ? value.screens.map((screen: unknown) => {
          if (typeof screen !== "object" || screen === null || Array.isArray(screen)) {
            return screen;
          }
          const oldScreen = screen as Record<string, unknown>;
          return {
            ...oldScreen,
            widgets: Array.isArray(oldScreen.widgets)
              ? migrateDynamicPanelWidgets(oldScreen.widgets)
              : oldScreen.widgets,
            interactionRules: Array.isArray(oldScreen.interactionRules)
              ? oldScreen.interactionRules.map((rule: unknown) => {
                  if (typeof rule !== "object" || rule === null || Array.isArray(rule)) {
                    return rule;
                  }
                  const oldRule = rule as Record<string, unknown>;
                  return {
                    ...oldRule,
                    conditionMode: oldRule.conditionMode ?? "all",
                  };
                })
              : oldScreen.interactionRules,
          };
        })
      : [];
    value = {
      ...value,
      schemaVersion: PROJECT_SCHEMA_VERSION,
      symbols: "symbols" in value && Array.isArray(value.symbols) ? value.symbols : [],
      variables,
      screens,
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

  if (typeof value === "object" && value !== null && "screens" in value && Array.isArray(value.screens)) {
    value = {
      ...value,
      screens: value.screens.map((screen: unknown) => {
        if (typeof screen !== "object" || screen === null || Array.isArray(screen)) return screen;
        const candidate = screen as Record<string, unknown>;
        return candidate.inputMode === undefined
          ? { ...candidate, inputMode: inferScreenInputMode(
              candidate.device as ScreenDevice | undefined,
            ) }
          : candidate;
      }),
    };
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
        inputMode: inferScreenInputMode(toScreenDevice(DEFAULT_DEVICE_PRESET)),
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
