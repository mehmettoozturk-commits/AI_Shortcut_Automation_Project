/**
 * Automation DSL — MASTER_SPEC.md §7 "AI Conversation Engine" + §11 "IR"
 *
 * This is the platform-independent intermediate representation (IR) that the
 * AI produces. It is NEVER executed directly (§15 "AI Güvenlik Katmanı" /
 * CLAUDE.md: "AI çıktısını doğrudan çalıştırma; schema + capability +
 * permission validation kullan"). It must pass through:
 *
 *   Schema Validator -> Capability Validator -> Permission Validator
 *   -> Safety Validator -> Human Confirmation -> Compiler
 *
 * This file only defines the shape. See src/validators for the pipeline.
 */

import { z } from "zod";

/**
 * A trigger describes *when* an automation should run. `type` is a
 * capability id from the Capability Registry (e.g. "ios.bluetooth.disconnected").
 * Extra context (e.g. which Bluetooth device) goes in `params`.
 */
export const TriggerSchema = z.object({
  type: z.string().min(1, "trigger.type boş olamaz"),
  device: z.string().optional(),
  params: z.record(z.unknown()).optional(),
});
export type Trigger = z.infer<typeof TriggerSchema>;

const RESERVED_STEP_TYPES = ["ask_confirmation", "conditional"] as const;

/**
 * Step that pauses the automation and asks the user a yes/no question.
 * This is how "kullanıcı onayı gerektiren işlemleri otomatik onaysız
 * çalıştırma" (CLAUDE.md) is expressed in the DSL itself.
 */
export const AskConfirmationStepSchema = z.object({
  type: z.literal("ask_confirmation"),
  message: z.string().min(1, "Kullanıcıya sorulacak mesaj boş olamaz"),
});
export type AskConfirmationStep = z.infer<typeof AskConfirmationStepSchema>;

/**
 * Step that branches on the result of a prior ask_confirmation (or other
 * boolean condition understood by the compiler, e.g. "answer == yes").
 */
export interface ConditionalStep {
  type: "conditional";
  condition: string;
  then: WorkflowStep[];
  else: WorkflowStep[];
}

export const ConditionalStepSchema: z.ZodType<ConditionalStep> = z.lazy(() =>
  z.object({
    type: z.literal("conditional"),
    condition: z.string().min(1, "condition boş olamaz"),
    then: z.array(WorkflowStepSchema),
    else: z.array(WorkflowStepSchema),
  })
);

/**
 * A concrete action step. `type` must match a capability's `action` id in
 * the Capability Registry (validated in a later pipeline stage, not here —
 * the schema layer only checks *shape*, not whether the capability exists).
 */
export const CapabilityActionStepSchema = z.object({
  type: z.string().min(1).refine((t) => !(RESERVED_STEP_TYPES as readonly string[]).includes(t), {
    message: "Bu tip ayrılmış bir kelime (ask_confirmation/conditional); capability action id kullanın",
  }),
  params: z.record(z.unknown()).optional(),
});
export type CapabilityActionStep = z.infer<typeof CapabilityActionStepSchema>;

export const WorkflowStepSchema: z.ZodType<WorkflowStep> = z.lazy(() =>
  z.union([AskConfirmationStepSchema, ConditionalStepSchema, CapabilityActionStepSchema])
);
export type WorkflowStep = AskConfirmationStep | ConditionalStep | CapabilityActionStep;

export const AutomationPlanSchema = z.object({
  name: z.string().min(1, "Otomasyon adı boş olamaz"),
  trigger: TriggerSchema,
  steps: z.array(WorkflowStepSchema).min(1, "En az bir adım gerekli"),
});
export type AutomationPlan = z.infer<typeof AutomationPlanSchema>;

/**
 * Type guard for ConditionalStep. Uses structural ("then"/"else" presence)
 * rather than `step.type === "conditional"` narrowing alone: because
 * CapabilityActionStep.type is a plain `string` (action ids are open-ended,
 * defined by the Capability Registry, not known statically), TypeScript
 * cannot treat `type` as a true discriminant across the whole union.
 */
export function isConditionalStep(step: WorkflowStep): step is ConditionalStep {
  return step.type === "conditional" && "then" in step && "else" in step;
}

export function isAskConfirmationStep(step: WorkflowStep): step is AskConfirmationStep {
  return step.type === "ask_confirmation" && "message" in step && !("then" in step);
}

/** Recursively collect every step in a plan, including nested then/else branches. */
export function flattenSteps(steps: WorkflowStep[]): WorkflowStep[] {
  const out: WorkflowStep[] = [];
  for (const step of steps) {
    out.push(step);
    if (isConditionalStep(step)) {
      out.push(...flattenSteps(step.then), ...flattenSteps(step.else));
    }
  }
  return out;
}
