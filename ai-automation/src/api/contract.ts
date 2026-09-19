/**
 * Phase 4A — `POST /plan` API sözleşmesi.
 *
 * Bu dosya sunucuyu İMPLEMENTE ETMEZ (bkz. server.ts); yalnızca isteğin/
 * yanıtın ŞEKLİNİ tanımlar — `dsl/schema.ts`'in compiler için yaptığının
 * aynısını HTTP sınırı için yapar. Şekiller, `src/nlu/types.ts`'teki
 * gerçek `PlanningOutcome`/`ConversationContext`/`IntentResult`
 * tiplerinin BİREBİR Zod karşılığıdır — API'ye özel, ayrı/basitleştirilmiş
 * bir gölge şema İCAT EDİLMEDİ (aksi hâlde iki şekil birbirinden
 * kayabilir).
 *
 * Sözleşme kasıtlı olarak STATELESS: sunucu hiçbir konuşma durumu
 * SAKLAMAZ. İstemci `conversation` alanını bir önceki yanıttan aynen
 * geri gönderir; sunucu onu geçici olarak hydrate eder, işler, ve
 * GÜNCELLENMİŞ hâlini yanıtta geri verir. Bu, yatay ölçeklenebilirlik
 * ve test edilebilirlik için bilinçli bir tasarım kararı.
 */

import { z } from "zod";
import { WorkflowStepSchema } from "../dsl/schema.js";
import { MISSING_INFO_PRIORITY } from "../builder/types.js";

/* ---------------- src/nlu/types.ts'in Zod karşılığı ---------------- */

function normalizedSchema<T extends z.ZodTypeAny>(inner: T) {
  return z.object({
    value: inner,
    raw: z.string(),
    ambiguous: z.boolean().optional(),
  });
}

const RecurrenceSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("daily") }),
  z.object({ kind: z.literal("weekly"), weekdays: z.array(z.number()) }),
  z.object({ kind: z.literal("weekday") }),
  z.object({ kind: z.literal("times_per_week"), count: z.number() }),
  z.object({ kind: z.literal("once") }),
]);

const EntitiesSchema = z.object({
  time: normalizedSchema(z.string()).optional(),
  date: normalizedSchema(z.string()).optional(),
  recurrence: normalizedSchema(RecurrenceSchema).optional(),
  location: normalizedSchema(
    z.object({ semantic: z.enum(["home", "work"]).optional(), name: z.string().optional() })
  ).optional(),
  device: normalizedSchema(z.string()).optional(),
  vehicle: normalizedSchema(z.string()).optional(),
  person: normalizedSchema(z.string()).optional(),
  application: normalizedSchema(z.string()).optional(),
  message: normalizedSchema(z.string()).optional(),
  batteryLevel: normalizedSchema(z.number()).optional(),
  condition: normalizedSchema(z.enum(["below", "above", "equals"])).optional(),
  wifiNetwork: normalizedSchema(z.string()).optional(),
  duration: normalizedSchema(z.number()).optional(),
  subject: normalizedSchema(z.string()).optional(),
});

const IntentTypeSchema = z.enum([
  "create_automation",
  "modify_automation",
  "explain_automation",
  "disable_automation",
  "enable_automation",
  "delete_automation",
  "not_understood",
]);

const SemanticTriggerSchema = z.object({
  type: z.string(),
  details: z.record(z.unknown()).optional(),
});

const SemanticStepSchema = z.object({
  type: z.string(),
  message: z.string().nullable().optional(),
  details: z.record(z.unknown()).optional(),
});

const IntentResultSchema = z.object({
  intent: IntentTypeSchema,
  confidence: z.number(),
  trigger: SemanticTriggerSchema.optional(),
  steps: z.array(SemanticStepSchema),
  entities: EntitiesSchema,
  missing: z.array(z.object({ field: z.string(), reason: z.string() })),
  sourceText: z.string(),
});

/* ---------------- src/builder/types.ts'in Zod karşılığı ---------------- */

const MissingInfoFieldSchema = z.object({
  id: z.string(),
  kind: z.enum(MISSING_INFO_PRIORITY),
  question: z.string(),
  options: z.array(z.string()),
  optional: z.boolean().optional(),
});

const DraftAutomationPlanSchema = z.object({
  name: z.string(),
  trigger: z.object({
    type: z.string(),
    device: z.string().nullable().optional(),
    params: z.record(z.unknown()).optional(),
  }),
  steps: z.array(WorkflowStepSchema),
  missing: z.array(MissingInfoFieldSchema),
  answers: z.record(z.string()),
});

/* ---------------- ConversationContext ---------------- */

export const ConversationContextSchema = z.object({
  originalInput: z.string(),
  currentPlan: DraftAutomationPlanSchema.nullable(),
  conversationTurns: z.array(z.object({ role: z.enum(["user", "system"]), text: z.string() })),
  lastQuestion: z.string().nullable(),
  lastMissingField: z.string().nullable(),
  selectedEntities: EntitiesSchema,
  lastIntent: IntentResultSchema.optional(),
});

/* ---------------- İstek ---------------- */

export const PlanRequestSchema = z.object({
  text: z.string().min(1, "text boş olamaz"),
  /**
   * Bir önceki yanıttaki `conversation` aynen geri gönderilir.
   * Yoksa (ilk tur) sunucu boş bir bağlamla başlar.
   */
  conversation: ConversationContextSchema.optional(),
  platform: z.enum(["ios", "android"]).default("ios"),
  /** Permission Validator için — istemcinin o an verdiği izinler. */
  grantedPermissions: z.array(z.string()).default([]),
});
export type PlanRequest = z.infer<typeof PlanRequestSchema>;

/* ---------------- Yanıt ---------------- */

/**
 * `src/validators/pipeline.ts`'in `PipelineOutcome`'unun Zod karşılığı.
 * Yalnızca `status: "plan"` olduğunda dolu gelir — eksik bilgi varken
 * veya desteklenmeyen bir istekte doğrulanacak tam bir plan yoktur.
 */
const ValidationOutcomeSchema = z.object({
  stage: z.enum(["schema", "capability", "permission", "safety", "complete"]),
  ok: z.boolean(),
  issues: z.array(
    z.object({
      code: z.string(),
      message: z.string(),
      path: z.string().optional(),
      severity: z.enum(["error", "warning"]),
    })
  ),
});

export const PlanResponseSchema = z.discriminatedUnion("status", [
  z.object({
    status: z.literal("plan"),
    plan: DraftAutomationPlanSchema,
    intent: IntentResultSchema,
    band: z.enum(["high", "medium", "low"]),
    /** Schema→Capability→Permission→Safety zincirinin sonucu. */
    validation: ValidationOutcomeSchema,
    conversation: ConversationContextSchema,
  }),
  z.object({
    status: z.literal("needs_clarification"),
    question: MissingInfoFieldSchema,
    intent: IntentResultSchema,
    conversation: ConversationContextSchema,
  }),
  z.object({
    status: z.literal("unsupported"),
    capability: z.string().nullable(),
    alternatives: z.array(z.object({ id: z.string(), description: z.string() })),
    intent: IntentResultSchema,
    reason: z.string(),
    /** Phase 4C — bkz. src/nlu/types.ts PlanningOutcome "unsupported" yorumu. */
    trigger: z.string().nullable(),
    conversation: ConversationContextSchema,
  }),
  z.object({
    status: z.literal("not_understood"),
    intent: IntentResultSchema,
    conversation: ConversationContextSchema,
  }),
  z.object({
    /**
     * Phase 4B — LLM/JSON hatası (ağ, geçersiz şema). `not_understood`
     * ile KARIŞTIRILMAZ: o geçerli bir semantik sonuçtur, bu ise
     * sağlayıcının HİÇ çalışamadığını gösterir (bkz. src/nlu/types.ts).
     */
    status: z.literal("provider_error"),
    message: z.string(),
    conversation: ConversationContextSchema,
  }),
]);
export type PlanResponse = z.infer<typeof PlanResponseSchema>;

export const ErrorResponseSchema = z.object({
  error: z.string(),
  issues: z.array(z.object({ path: z.array(z.union([z.string(), z.number()])), message: z.string() })).optional(),
});
export type ErrorResponse = z.infer<typeof ErrorResponseSchema>;
