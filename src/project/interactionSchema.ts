import { z } from "zod";

const RESERVED_LOCAL_NAMES = new Set([
  "await", "break", "case", "catch", "class", "const", "continue", "debugger",
  "default", "delete", "do", "else", "enum", "export", "extends", "false",
  "finally", "for", "function", "if", "import", "in", "instanceof", "new",
  "null", "return", "super", "switch", "this", "throw", "true", "try",
  "typeof", "var", "void", "while", "with", "yield", "__proto__", "prototype",
  "constructor",
]);

const LocalVariableNameSchema = z.string().trim()
  .regex(/^[A-Za-z_$][\w$]{0,119}$/)
  .refine((name) => !RESERVED_LOCAL_NAMES.has(name), "Use a non-reserved local variable name.");

export function isValidInteractionLocalVariableName(name: string): boolean {
  return LocalVariableNameSchema.safeParse(name).success && name === name.trim();
}

const InteractionLocalVariableSchema = z.discriminatedUnion("type", [
  z.object({
    name: LocalVariableNameSchema,
    type: z.literal("string"),
    initial: z.string(),
  }).strict(),
  z.object({
    name: LocalVariableNameSchema,
    type: z.literal("number"),
    initial: z.number().finite(),
  }).strict(),
  z.object({
    name: LocalVariableNameSchema,
    type: z.literal("boolean"),
    initial: z.boolean(),
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
    stateId: z.string().uuid().optional(),
    transition: z.enum([
      "none",
      "fade",
      "slide-left",
      "slide-right",
      "slide-up",
      "slide-down",
    ]).optional(),
    duration: z.number().finite().min(0).max(10_000).optional(),
  })
  .strict();

export const InteractionRuleSchema = z
  .object({
    id: z.string().uuid(),
    widgetId: z.string().uuid().optional(),
    event: z.enum([
      "onClick",
      "onDoubleClick",
      "onRightClick",
      "onHover",
      "onMouseDown",
      "onMouseUp",
      "onChange",
      "onLoad",
      "onTap",
      "onDoubleTap",
      "onLongPress",
      "onSwipeLeft",
      "onSwipeRight",
      "onSwipeUp",
      "onSwipeDown",
      "onPinchIn",
      "onPinchOut",
      "onPan",
      "onTouchStart",
      "onTouchEnd",
      "onFocus",
      "onBlur",
      "onKeyDown",
    ]),
    conditionMode: z.enum(["all", "any"]).optional(),
    conditions: z.array(InteractionConditionSchema),
    actions: z.array(InteractionActionSchema).min(1),
    localVariables: z.array(InteractionLocalVariableSchema).optional(),
  })
  .strict()
  .superRefine((rule, context) => {
    const names = new Set<string>();
    for (const [index, variable] of rule.localVariables?.entries() ?? []) {
      if (names.has(variable.name)) {
        context.addIssue({
          code: "custom",
          path: ["localVariables", index, "name"],
          message: `Local variable "${variable.name}" is declared more than once.`,
        });
      }
      names.add(variable.name);
    }
  });

export type InteractionCondition = z.infer<typeof InteractionConditionSchema>;
export type InteractionAction = z.infer<typeof InteractionActionSchema>;
export type InteractionRule = z.infer<typeof InteractionRuleSchema>;
export type InteractionLocalVariable = NonNullable<InteractionRule["localVariables"]>[number];
