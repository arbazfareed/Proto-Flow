import { z } from "zod";

export const PROJECT_SCHEMA_VERSION = "1.0.0";
const HexColorSchema = z
  .string()
  .regex(/^#(?:[\da-f]{3}|[\da-f]{4}|[\da-f]{6}|[\da-f]{8})$/i, "Expected a hex color.");

const VariableDefinitionBase = z.object({
  id: z.string().uuid(),
  name: z.string().trim().min(1).max(120),
});

export const VariableDefinitionSchema = z.discriminatedUnion("type", [
  VariableDefinitionBase.extend({
    type: z.literal("string"),
    defaultValue: z.string().optional(),
  }).strict(),
  VariableDefinitionBase.extend({
    type: z.literal("number"),
    defaultValue: z.number().finite().optional(),
  }).strict(),
  VariableDefinitionBase.extend({
    type: z.literal("boolean"),
    defaultValue: z.boolean().optional(),
  }).strict(),
]);

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
  })
  .strict();

export const WidgetStyleSchema = z
  .object({
    fill: HexColorSchema.nullable().optional(),
    stroke: HexColorSchema.nullable().optional(),
    strokeWidth: z.number().finite().nonnegative().optional(),
    cornerRadius: z.number().finite().nonnegative().optional(),
    shadow: WidgetShadowSchema.optional(),
  })
  .strict();

export const ProtoWidgetSchema = z
  .object({
    id: z.string().uuid(),
    type: z.string().trim().min(1),
    x: z.number().finite(),
    y: z.number().finite(),
    width: z.number().finite().positive(),
    height: z.number().finite().positive(),
    rotation: z.number().finite(),
    opacity: z.number().finite().min(0).max(1),
    visible: z.boolean(),
    locked: z.boolean(),
    zIndex: z.number().int(),
    style: WidgetStyleSchema,
    props: z.record(z.string(), z.unknown()),
  })
  .strict();

export const ProtoScreenSchema = z
  .object({
    id: z.string().uuid(),
    name: z.string().trim().min(1).max(120),
    widgets: z.array(ProtoWidgetSchema),
    interactionRules: z.array(InteractionRuleSchema),
  })
  .strict();

export const ProtoFlowProjectSchema = z
  .object({
    schemaVersion: z.literal(PROJECT_SCHEMA_VERSION),
    id: z.string().uuid(),
    name: z.string().trim().min(1).max(120),
    createdAt: z.iso.datetime(),
    updatedAt: z.iso.datetime(),
    variables: z.array(VariableDefinitionSchema),
    screens: z.array(ProtoScreenSchema).min(1),
    startScreenId: z.string().uuid(),
  })
  .strict()
  .superRefine((project, context) => {
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
    screens: [
      {
        id: screenId,
        name: "Screen 1",
        widgets: [],
        interactionRules: [],
      },
    ],
    startScreenId: screenId,
  });
}

export const createProject = createEmptyProject;

export function serializeProject(project: Project): string {
  return `${JSON.stringify(parseProject(project), null, 2)}\n`;
}
