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

/**
 * Actions that need no target widget or screen (B49): Go back has nothing to point at, Wait is only a
 * time, and Open link carries its address in `value` (so it can use {{variables}} and [[expressions]]).
 */
export const NO_TARGET_ACTION_TYPES: ReadonlySet<string> = new Set(["goBack", "wait", "openLink"]);

/** The longest a Wait can be, in milliseconds. */
export const MAX_WAIT_MS = 10_000;

/**
 * The address to open for an Open link action, or null if it is not one we allow. Only complete
 * web, email and phone addresses are opened (https:, http:, mailto:, tel:); anything else, such as
 * javascript: or file:, never is, whatever a project file says.
 */
export function normalizeLinkUrl(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const text = value.trim();
  if (!text || /[\u0000-\u001f\u007f]/.test(text)) return null;
  try {
    const url = new URL(text);
    return ["https:", "http:", "mailto:", "tel:"].includes(url.protocol) ? url.href : null;
  } catch {
    return null;
  }
}

/** An address that is filled in when the prototype runs ({{variable}} or [[expression]]), so it cannot be checked yet. */
export function isDynamicLinkUrl(value: string): boolean {
  return /\{\{|\[\[/.test(value);
}

const InteractionActionObjectSchema = z
  .object({
    type: z.string().trim().min(1),
    target: z.string().trim(),
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
    duration: z.number().finite().min(0).max(MAX_WAIT_MS).optional(),
  })
  .strict();

export const InteractionActionSchema = InteractionActionObjectSchema.superRefine((action, context) => {
  if (!NO_TARGET_ACTION_TYPES.has(action.type) && action.target.length === 0) {
    context.addIssue({ code: "custom", path: ["target"], message: "Choose a target for this action." });
  }
  if (action.type === "openLink") {
    if (typeof action.value !== "string" || !action.value.trim()) {
      context.addIssue({ code: "custom", path: ["value"], message: "Open link needs a web address." });
    } else if (!isDynamicLinkUrl(action.value) && !normalizeLinkUrl(action.value)) {
      context.addIssue({
        code: "custom",
        path: ["value"],
        message: "Open link only opens addresses that start with https://, http://, mailto: or tel:.",
      });
    }
  }
  if (action.type === "wait" && action.duration === undefined) {
    context.addIssue({ code: "custom", path: ["duration"], message: "Wait needs a time in milliseconds." });
  }
});

export const InteractionRuleSchema = z
  .object({
    id: z.string().uuid(),
    widgetId: z.string().uuid().optional(),
    importedNodeId: z.string().trim().min(1).max(120).optional(),
    importedCodeId: z.string().uuid().optional(),
    event: z.enum([
      "onClick",
      "onDoubleClick",
      "onRightClick",
      "onHover",
      "onMouseLeave",
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
    // Only for "Key down": run this rule for this key only (an event.key value). Empty means any key.
    key: z.string().max(40).optional(),
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
