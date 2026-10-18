import { z } from "zod";
import { createHash } from "node:crypto";
import { CAPABILITIES, findCapability } from "../capability-registry/registry.js";

const id = z.string().trim().min(1).max(160);
const json: z.ZodType<unknown> = z.lazy(() => z.union([z.null(), z.boolean(), z.string(), z.number().finite(), z.array(json), z.record(json)]));
const params = z.record(json);
const action = z.object({ type: id, params: params.optional() }).strict().superRefine((v, ctx) => {
  if (findCapability(v.type)?.kind !== "action") ctx.addIssue({ code: "custom", message: "unknown_action" });
});
const step: z.ZodType<unknown> = z.lazy(() => z.union([
  z.object({ type: z.literal("ask_confirmation"), message: z.string().min(1) }).strict(),
  z.object({ type: z.literal("conditional"), condition: z.string().min(1), then: z.array(step), else: z.array(step) }).strict(), action,
]));
export const PilotPlanSchema = z.object({
  name: z.string().min(1),
  trigger: z.object({ type: id, device: z.string().optional(), params: params.optional() }).strict().superRefine((v, ctx) => {
    if (findCapability(v.type)?.kind !== "trigger") ctx.addIssue({ code: "custom", message: "unknown_trigger" });
  }),
  steps: z.array(step).min(1),
}).strict();
export const RequirementsSchema = z.object({
  approval: z.enum(["not_required", "required", "reject_unconfirmed"]),
  permissions: z.array(id), safety: z.array(id),
}).strict();
const question = z.object({ field: id, reasonCode: id }).strict();
const validation = z.object({ stage: z.enum(["schema", "capability", "permission", "setup", "safety"]), codes: z.array(id).min(1) }).strict();
const oracle = z.discriminatedUnion("outcome", [
  z.object({ outcome: z.literal("plan"), plan: PilotPlanSchema, requirements: RequirementsSchema }).strict(),
  z.object({ outcome: z.literal("clarification"), plan: z.null(), question }).strict(),
  z.object({ outcome: z.literal("unknown"), plan: z.null() }).strict(),
  z.object({ outcome: z.literal("validation_failure"), plan: PilotPlanSchema, requirements: RequirementsSchema, validation }).strict(),
]);
export const PilotCaseSchema = z.object({
  schemaVersion: z.literal(1), oracleVersion: id, capabilitySnapshotHash: z.string().regex(/^[a-f0-9]{64}$/),
  caseId: id, input: z.string().min(1).max(4096).refine(v => v === v.normalize("NFC"), "NFC required"),
  sourceId: id, authorId: id, generatorVersion: id, promptFamilyId: id, expressionFamilyId: id, numericFamilyId: id,
  split: z.enum(["development", "regression", "blind"]), reviewStatus: z.enum(["draft", "reviewed", "frozen", "retired"]),
  category: z.enum(["positive", "negative_direction", "ambiguous_slot", "unsupported"]),
  capabilityId: id.nullable(), requestedConcept: id.optional(),
  polarity: z.enum(["positive", "negative", "mixed", "unspecified"]),
  direction: z.enum(["below", "above", "equals", "connected", "disconnected", "on", "off", "unspecified", "conflicting", "not_applicable"]),
  slotState: z.enum(["complete", "missing", "conflicting", "multiple", "not_applicable"]),
  slotAnnotations: z.array(z.object({ type: id, start: z.number().int().nonnegative(), end: z.number().int().positive(),
    value: json, ambiguityReason: id.nullable() }).strict()),
  oracle,
}).strict().superRefine((v, ctx) => {
  const fail = (message: string) => ctx.addIssue({ code: "custom", message });
  if (v.category === "unsupported") {
    if (v.capabilityId !== null || !v.requestedConcept || v.oracle.outcome !== "unknown") fail("unsupported_oracle");
  } else if (!v.capabilityId || !findCapability(v.capabilityId)) fail("unknown_capability");
  if (v.oracle.outcome === "plan") {
    if (v.polarity === "negative" || ["missing", "conflicting", "multiple"].includes(v.slotState)) fail("unsafe_plan_oracle");
    const plan = v.oracle.plan;
    const types = new Set<string>([plan.trigger.type]);
    const visit = (nodes: unknown[]) => { for (const node of nodes) {
      const item = node as { type: string; then?: unknown[]; else?: unknown[] }; types.add(item.type);
      if (item.then) visit(item.then); if (item.else) visit(item.else);
    } }; visit(plan.steps);
    if (v.capabilityId && !types.has(v.capabilityId)) fail("target_absent_from_plan");
    const condition = plan.trigger.params?.condition;
    if (["above", "below", "equals"].includes(v.direction) && condition !== v.direction) fail("direction_conflict");
  }
  if (v.split === "blind" && !["frozen", "retired"].includes(v.reviewStatus)) fail("blind_not_frozen");
  for (const slot of v.slotAnnotations) if (slot.end <= slot.start || slot.end > v.input.length) fail("invalid_span");
});
export type PilotCase = z.infer<typeof PilotCaseSchema>;
export type PilotPlan = z.infer<typeof PilotPlanSchema>;
export const currentPilotSnapshotHash = () => createHash("sha256").update(JSON.stringify(CAPABILITIES)).digest("hex");
/** Caller supplies the trusted frozen snapshot; metadata alone is not authority. */
export function parsePilotCases(raw: unknown, expectedSnapshotHash = currentPilotSnapshotHash()): PilotCase[] {
  const cases = z.array(PilotCaseSchema).min(1).max(10000).parse(raw);
  if (new Set(cases.map(c => c.caseId)).size !== cases.length) throw Error("duplicate_case_id");
  if (cases.some(c => c.capabilitySnapshotHash !== expectedSnapshotHash)) throw Error("snapshot_mismatch");
  return cases;
}
