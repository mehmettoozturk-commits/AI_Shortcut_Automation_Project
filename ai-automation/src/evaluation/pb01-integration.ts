import { findBySemantic } from "../capability-registry/registry.js";
import { buildPlan } from "../nlu/plan-builder.js";
import { checkSemanticCompleteness, hardenTemporalAmbiguity, toIntentResult } from "../nlu/providers/llm-schema.js";
import { runValidationPipeline } from "../validators/pipeline.js";
import { decodePB01Wire } from "./pb01-wire.js";
import { parsePB01Json } from "./pb01-json.js";

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.keys(value).sort().map(k => `${JSON.stringify(k)}:${canonical((value as Record<string, unknown>)[k])}`).join(",")}}`;
  return JSON.stringify(value);
}

/** Conservative offline adapter. Decode is lossless; DSL conversion is a strict
 * subset and explicitly rejects fields the legacy builder would discard/default.
 * It never installs/runs a plan and never accepts provider permission claims. */
export function validatePB01Plan(wireText: string, sourceText: string) {
  const decoded = decodePB01Wire(wireText), out = decoded.semantic;
  const reject = (reason: string) => ({ mode: "mock/simulated" as const, status: "unsupported_by_offline_bridge" as const,
    reason, decoded, realDispatchAllowed: false as const, installationVerified: false as const });
  parsePB01Json(JSON.stringify(sourceText));
  if (typeof sourceText !== "string") return reject("source_text_required");
  if (out.confidence === undefined) return reject("missing_explicit_confidence");
  if (out.intent !== "create_automation") return reject("intent_not_in_offline_dsl_subset");
  if (out.entities.length) return reject("entities_not_losslessly_mapped_to_dsl");
  if (out.trigger === null || out.trigger.details === undefined) return reject("explicit_trigger_details_required");
  if (!out.steps.length) return reject("action_required");
  for (const step of out.steps) {
    const candidates = findBySemantic(step.semantic, "action");
    const cap = candidates.find(c => c.availableInShortcuts === true) ?? candidates[0];
    if (!cap) return reject("capability_unresolved");
    if (cap.riskLevel !== "low" || step.semantic === "ask_confirmation") return reject("approval_branch_not_representable_no_auto_approval");
    if (step.message !== null) return reject("message_not_losslessly_mapped_to_dsl");
    if (step.details !== undefined) {
      const keys = Object.keys(step.details), parameters = cap.parameters ?? [];
      if (!parameters.length || keys.some(k => !parameters.some(p => p.name === k))) return reject("details_not_losslessly_mapped_to_dsl");
    }
    if (cap.parameters?.some(p => p.required && (step.details === undefined || !Object.hasOwn(step.details, p.name)))) return reject("explicit_parameter_required_no_default");
  }
  let intent = toIntentResult(out, sourceText);
  intent = hardenTemporalAmbiguity(intent);
  const violation = checkSemanticCompleteness(intent);
  if (violation) return reject("semantic_completeness_failed");
  if (intent.missing.length) return { mode: "mock/simulated" as const, status: "needs_clarification" as const,
    decoded, missing: intent.missing, realDispatchAllowed: false as const, installationVerified: false as const };
  const outcome = buildPlan(intent);
  if (outcome.status !== "plan") return reject("builder_did_not_produce_plan");
  // Check actual mapped values as well as admitted names. No coercion or builder
  // fallback may be mistaken for a lossless provider result.
  const same = (a: unknown, b: unknown) => canonical(a) === canonical(b);
  if (!findBySemantic(out.trigger.semantic, "trigger").some(c => c.id === outcome.plan.trigger.type)) return reject("builder_changed_trigger");
  if (!same(outcome.plan.trigger.params, out.trigger.details) || outcome.plan.steps.length !== out.steps.length) return reject("builder_changed_semantics");
  for (let i = 0; i < out.steps.length; i++) {
    const step = outcome.plan.steps[i]!;
    if (!findBySemantic(out.steps[i]!.semantic, "action").some(c => c.id === step.type)) return reject("builder_changed_action");
    if (!same("params" in step ? step.params : undefined, out.steps[i]!.details)) return reject("builder_changed_details");
  }
  // Same documented Draft→DSL null-device representation as the existing builder/API.
  const plan = { name: outcome.plan.name, trigger: { type: outcome.plan.trigger.type,
    ...(outcome.plan.trigger.device == null ? {} : { device: outcome.plan.trigger.device }), params: outcome.plan.trigger.params }, steps: outcome.plan.steps };
  const validation = runValidationPipeline(plan, { platform: "ios", grantedPermissions: [] });
  if (!validation.ok) return { ...reject("validation_failed"), validation };
  return { mode: "mock/simulated" as const, status: "validated_offline" as const, decoded,
    intent, plan: validation.plan!, validation, realDispatchAllowed: false as const, installationVerified: false as const };
}

export interface PB01Scheduled { caseId: string; wireText: string; sourceText: string }
/** Every scheduled entry gets a result, including decode rejection/unsupported.
 * These are fixture coverage counters, not model quality or SDK usage metrics. */
export function evaluatePB01Schedule(schedule: readonly PB01Scheduled[]) {
  if (new Set(schedule.map(s => s.caseId)).size !== schedule.length) throw new Error("duplicate_case_id");
  const results = schedule.map(s => {
    try { decodePB01Wire(s.wireText); } catch {
      return { caseId: s.caseId, wireDecodeStatus: "REJECT" as const, downstreamStatus: "NOT_EVALUATED" as const, reason: "wire_decode_rejected" };
    }
    try {
      const result = validatePB01Plan(s.wireText, s.sourceText);
      return { caseId: s.caseId, wireDecodeStatus: "PASS" as const, downstreamStatus: result.status === "validated_offline" ? "PASS" as const
        : result.status === "needs_clarification" ? "CLARIFICATION" as const : "UNSUPPORTED" as const,
      reason: "reason" in result ? result.reason : result.status };
    } catch { return { caseId: s.caseId, wireDecodeStatus: "PASS" as const, downstreamStatus: "REJECT" as const, reason: "downstream_rejected" }; }
  });
  const wirePassed = results.filter(r => r.wireDecodeStatus === "PASS").length;
  const downstreamPassed = results.filter(r => r.downstreamStatus === "PASS").length;
  return { mode: "mock/simulated", realModelQualityMeasured: false, realDispatchAllowed: false, scheduled: results.length,
    wirePassed, wireRejected: results.length - wirePassed, downstreamPassed,
    downstreamUnsupported: results.filter(r => r.downstreamStatus === "UNSUPPORTED").length,
    downstreamNotEvaluated: results.filter(r => r.downstreamStatus === "NOT_EVALUATED").length,
    downstreamRejected: results.filter(r => r.downstreamStatus === "REJECT").length,
    downstreamClarification: results.filter(r => r.downstreamStatus === "CLARIFICATION").length,
    wireCoverage: results.length ? wirePassed / results.length : null,
    downstreamCoverage: results.length ? downstreamPassed / results.length : null, results };
}
