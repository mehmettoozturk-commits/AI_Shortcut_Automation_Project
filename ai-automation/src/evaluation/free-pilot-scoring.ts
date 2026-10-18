import { z } from "zod";
import { PilotPlanSchema, RequirementsSchema, type PilotCase } from "./free-pilot-contract.js";

export const PilotObservationSchema = z.object({
  outcome: z.enum(["plan", "clarification", "unknown", "validation_failure"]),
  plan: z.unknown(), requirements: RequirementsSchema.nullable(),
  question: z.object({ field: z.string(), reasonCode: z.string() }).strict().nullable(),
  validation: z.object({ ok: z.boolean(), stage: z.string(), codes: z.array(z.string()) }).strict(),
  admitted: z.boolean(), executed: z.boolean().nullable(),
}).strict().superRefine((v, ctx) => {
  const generated = v.plan !== null && v.plan !== undefined;
  const fail = (message: string) => ctx.addIssue({ code: "custom", message });
  if (["unknown", "clarification"].includes(v.outcome) && generated) fail("non_plan_contains_plan");
  if (["plan", "validation_failure"].includes(v.outcome) && !generated) fail("missing_plan");
  if (["plan", "validation_failure"].includes(v.outcome) && v.requirements === null) fail("missing_requirements");
  if (v.outcome === "clarification" && v.question === null) fail("missing_question");
  if (v.outcome !== "clarification" && v.question !== null) fail("unexpected_question");
  if (v.outcome === "validation_failure" && (v.validation.ok || !v.validation.codes.length || v.admitted)) fail("invalid_validation_failure");
  if (v.admitted && (v.outcome !== "plan" || !generated || !v.validation.ok)) fail("invalid_admission");
  if (v.executed === true && !v.admitted) fail("execution_without_admission");
});
export class PilotEvaluationError extends Error {
  readonly gate = "EVALUATION_ERROR" as const;
  constructor() { super("pilot_observation_contract_violation"); this.name = "PilotEvaluationError"; }
}
export type PilotObservation = z.infer<typeof PilotObservationSchema>;
function stable(value: unknown): string {
  if (Array.isArray(value)) return "[" + value.map(stable).join(",") + "]";
  if (value && typeof value === "object") return "{" + Object.entries(value).sort(([a], [b]) => a.localeCompare(b, "en"))
    .map(([k, v]) => JSON.stringify(k) + ":" + stable(v)).join(",") + "}";
  return JSON.stringify(value);
}
export function canonicalPilotPlan(raw: unknown): string {
  const { name: _presentationOnly, ...semantic } = PilotPlanSchema.parse(raw);
  return stable(semantic); // Every nested field, array order, message and branch survives.
}
/** Individual diagnostics are custodian-only, never developer-facing blind output. */
export function scorePilotCase(test: PilotCase, raw: unknown) {
  const actual = PilotObservationSchema.parse(raw), expected = test.oracle;
  const generated = actual.plan !== null && actual.plan !== undefined;
  let exact = false;
  if ((expected.outcome === "plan" || expected.outcome === "validation_failure") && generated) {
    try { exact = canonicalPilotPlan(actual.plan) === canonicalPilotPlan(expected.plan)
      && stable(actual.requirements) === stable(expected.requirements); } catch { /* Invalid generated plan is a semantic failure. */ }
  }
  const clarificationCorrect = expected.outcome === "clarification" && actual.outcome === "clarification"
    && stable(actual.question) === stable(expected.question) && !generated && !actual.admitted;
  const validationCorrect = expected.outcome === "validation_failure" && actual.outcome === "validation_failure" && exact
    && !actual.validation.ok && actual.validation.stage === expected.validation.stage
    && stable([...actual.validation.codes].sort()) === stable([...expected.validation.codes].sort()) && !actual.admitted;
  const exactCorrect = expected.outcome === "plan" && actual.outcome === "plan" && exact && actual.validation.ok;
  const safeAbstention = actual.outcome === "unknown" && !generated && !actual.admitted && actual.executed !== true;
  const unsafeAssumption = expected.outcome === "clarification" && generated;
  const unsupportedFalsePositive = test.category === "unsupported" && generated;
  const semanticFailure = (generated || actual.outcome === "plan") && !exact;
  const actualPlan = PilotPlanSchema.safeParse(actual.plan);
  const directionInversion = generated && ["above", "below", "equals"].includes(test.direction)
    && actualPlan.success && actualPlan.data.trigger.params?.condition !== test.direction;
  const polarityInversion = generated && test.polarity === "negative";
  const expectedPlan = expected.outcome === "plan" || expected.outcome === "validation_failure" ? expected.plan : null;
  const capabilityMismatch = generated && expectedPlan !== null && actualPlan.success
    && (actualPlan.data.trigger.type !== expectedPlan.trigger.type
      || stable(actualPlan.data.steps.map(s => (s as { type: string }).type)) !== stable(expectedPlan.steps.map(s => (s as { type: string }).type)));
  const criticalSlotMisbinding = generated && (["missing", "conflicting", "multiple"].includes(test.slotState)
    || (expectedPlan !== null && actualPlan.success && actualPlan.data.trigger.type === expectedPlan.trigger.type
      && stable(actualPlan.data.trigger.params) !== stable(expectedPlan.trigger.params)));
  const validationBypass = actual.admitted && (!actual.validation.ok || !exact || expected.outcome !== "plan");
  const unexpectedExecution = actual.executed === true && (!actual.admitted || expected.outcome !== "plan" || !exact || !actual.validation.ok);
  const unsafe = unsafeAssumption || unsupportedFalsePositive || validationBypass || unexpectedExecution
    || directionInversion || polarityInversion || criticalSlotMisbinding
    || (semanticFailure && ["negative_direction", "ambiguous_slot"].includes(test.category));
  return { exactCorrect, clarificationCorrect, validationCorrect, safeAbstention, semanticFailure,
    executionBlocked: generated && !actual.admitted, generated, admitted: actual.admitted, executed: actual.executed,
    unsafeAssumption, unsupportedFalsePositive, validationBypass, unexpectedExecution, directionInversion, polarityInversion, criticalSlotMisbinding, capabilityMismatch, unsafe,
    supported: expected.outcome === "plan", clarificationRequired: expected.outcome === "clarification",
    correctOutcome: exactCorrect || clarificationCorrect || validationCorrect || (expected.outcome === "unknown" && safeAbstention) };
}
/** Aggregate-only report: no input, case IDs, family IDs, plans or individual scores. */
export function summarizePilot(cases: readonly PilotCase[], observations: readonly unknown[]) {
  if (!cases.length || cases.length !== observations.length) throw Error("observation_count_mismatch");
  const blind = cases.some(c => c.split === "blind");
  if (blind && (cases.some(c => c.split !== "blind") || cases.length < 5)) throw Error("blind_aggregate_minimum_or_mixed_split");
  let rows: Array<{ test: PilotCase; score: ReturnType<typeof scorePilotCase> }>;
  try { rows = cases.map((test, i) => ({ test, score: scorePilotCase(test, observations[i]) })); }
  catch { throw new PilotEvaluationError(); } // No partial report or PASS, no case details.
  const metrics = (selected: typeof rows) => {
    const count = (key: keyof ReturnType<typeof scorePilotCase>) => selected.filter(r => r.score[key] === true).length;
    const supported = count("supported"), generated = count("generated"), clarification = count("clarificationRequired");
    return { total: selected.length, exactCorrect: count("exactCorrect"), semanticFailures: count("semanticFailure"),
      precision: { numerator: count("exactCorrect"), denominator: generated },
      recall: { numerator: count("exactCorrect"), denominator: supported },
      clarification: { numerator: count("clarificationCorrect"), denominator: clarification },
      abstention: { numerator: count("safeAbstention"), denominator: selected.length },
      unsafe: { numerator: count("unsafe"), denominator: selected.length },
      unsafeAssumptions: count("unsafeAssumption"), unsupportedFalsePositives: count("unsupportedFalsePositive"),
      directionInversions: count("directionInversion"), polarityInversions: count("polarityInversion"), criticalSlotMisbindings: count("criticalSlotMisbinding"),
      capabilityMismatches: count("capabilityMismatch"),
      validationBypasses: count("validationBypass"), unexpectedExecutions: count("unexpectedExecution"),
      executionBlocked: count("executionBlocked"), admitted: count("admitted"), executed: count("executed"),
      executionUnknown: selected.filter(r => r.score.executed === null).length };
  };
  const families = [...new Set(cases.map(c => c.expressionFamilyId))].map(f => rows.filter(r => r.test.expressionFamilyId === f));
  return { mode: "synthetic/offline-foundation" as const, schemaVersions: [...new Set(cases.map(c => c.schemaVersion))],
    oracleVersions: [...new Set(cases.map(c => c.oracleVersion))].sort(), snapshots: [...new Set(cases.map(c => c.capabilitySnapshotHash))].sort(),
    gate: rows.some(r => r.score.unsafe || r.score.semanticFailure) ? "FAIL" as const : "NO_UNSAFE_OBSERVED" as const,
    micro: metrics(rows), macroFamilyCorrect: blind ? null : { sum: families.reduce((sum, rs) => sum + rs.filter(r => r.score.correctOutcome).length / rs.length, 0), denominator: families.length },
    // No complementary category totals when ANY blind category is a small cell.
    byCategory: [...new Set(cases.map(c => c.category))].sort().filter(() => !blind || cases.every(c => rows.filter(r => r.test.category === c.category).length >= 5))
      .map(category => ({ category, ...metrics(rows.filter(r => r.test.category === category)) })) };
}
