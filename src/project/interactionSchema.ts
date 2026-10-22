import { z } from "zod";

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
      "onHover",
      "onChange",
      "onLoad",
      "onTap",
      "onTouchStart",
      "onTouchEnd",
    ]),
    conditionMode: z.enum(["all", "any"]).optional(),
    conditions: z.array(InteractionConditionSchema),
    actions: z.array(InteractionActionSchema).min(1),
  })
  .strict();

export type InteractionCondition = z.infer<typeof InteractionConditionSchema>;
export type InteractionAction = z.infer<typeof InteractionActionSchema>;
export type InteractionRule = z.infer<typeof InteractionRuleSchema>;
