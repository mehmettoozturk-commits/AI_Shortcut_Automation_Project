import { expect, it } from "vitest";
import { freeDevelopmentPilot } from "../src/evaluation/free-development-pilot.js";
import { NluPipeline } from "../src/nlu/pipeline.js";
import { FreeTemplateProvider } from "../src/nlu/free-template-provider.js";
import { emptyContext } from "../src/nlu/types.js";
import { runValidationPipeline } from "../src/validators/pipeline.js";
import { scorePilotCase, summarizePilot, type PilotObservation } from "../src/evaluation/free-pilot-scoring.js";
import { auditPilotLeakage } from "../src/evaluation/free-pilot-leakage.js";
import { findCapability } from "../src/capability-registry/registry.js";
import { flattenSteps } from "../src/dsl/schema.js";
import type { AutomationPlan } from "../src/dsl/schema.js";

// This pilot has no exposed requirements output; derive only for its verified
// low-risk capability set, never silently substitute requirements for unknown IDs.
function pilotRequirements(plan: AutomationPlan) {
  const allowed = new Set(["ios.battery.falls_below", "ios.time_of_day.daily", "ios.notification.show"]);
  const nodes = flattenSteps(plan.steps);
  for (const node of nodes) if (node.type === "ask_confirmation" || node.type === "conditional") {
    throw Error("Pilot approval/control flow requires separate review");
  }
  for (const id of [plan.trigger.type, ...nodes.map(node => node.type)]) {
    const capability = findCapability(id);
    if (!capability || !allowed.has(id)) throw Error("Unreviewed pilot capability");
    if (capability.riskLevel !== "low" || (capability.runtimePermissions !== undefined && capability.runtimePermissions.length !== 0)) {
      throw Error("Pilot requirements changed; re-review required");
    }
  }
  return { approval: "not_required" as const, permissions: [], safety: [] };
}

it("measures 60 visible development cases without tuning grammar or claiming blind quality", async () => {
  const cases = freeDevelopmentPilot(); expect(cases).toHaveLength(60);
  expect(cases.every(c => c.split === "development" && c.reviewStatus === "draft")).toBe(true);
  expect(cases.filter(c => c.category === "positive")).toHaveLength(40);
  expect(cases.filter(c => c.category === "negative_direction")).toHaveLength(10);
  expect(cases.filter(c => c.category === "ambiguous_slot")).toHaveLength(5);
  expect(cases.filter(c => c.category === "unsupported")).toHaveLength(5);
  const observations: PilotObservation[] = [];
  for (const test of cases) {
    const pipeline = new NluPipeline(undefined, undefined, undefined, new FreeTemplateProvider(), undefined, undefined, { freeTemplateOnly: true });
    const result = await pipeline.planAsync(test.input, emptyContext());
    let actual: PilotObservation = { outcome: "unknown", plan: null, requirements: null, question: null,
      validation: { ok: true, stage: "complete", codes: [] }, admitted: false, executed: null };
    if (result.status === "plan") {
      const draft = result.plan;
      const plan = { name: draft.name, trigger: { type: draft.trigger.type,
        ...(draft.trigger.device == null ? {} : { device: draft.trigger.device }), params: draft.trigger.params }, steps: draft.steps };
      const checked = runValidationPipeline(plan, { platform: "ios", grantedPermissions: [] });
      actual = { outcome: checked.ok ? "plan" : "validation_failure", plan, question: null,
        requirements: pilotRequirements(plan),
        validation: { ok: checked.ok, stage: checked.stage, codes: checked.issues.map(i => i.code) },
        admitted: false, executed: null };
    } else if (result.status === "needs_clarification") {
      const field = result.question.id;
      actual = { ...actual, outcome: "clarification", question: { field,
        reasonCode: result.intent.missing.find(m => m.field === field)?.reason ?? "unmapped_reason" } };
    } else if (result.status !== "not_understood") throw Error(`unexpected outcome ${result.status}`);
    observations.push(actual);
  }
  const report = summarizePilot(cases, observations);
  expect(observations.every(o => !o.admitted && o.executed === null)).toBe(true);
  const unreviewed = { name: "Synthetic", trigger: { type: "invented.trigger" }, steps: [{ type: "ios.notification.show" }] };
  expect(() => pilotRequirements(unreviewed)).toThrow("Unreviewed");
  expect(() => pilotRequirements({ ...unreviewed, trigger: { type: "ios.time_of_day.daily" }, steps: [{ type: "ask_confirmation", message: "Confirm?" }] })).toThrow("control flow");
  const diagnostic = cases.map((test, i) => ({ caseId: test.caseId, family: test.expressionFamilyId,
    expected: test.oracle.outcome, actual: observations[i]!.outcome, ...scorePilotCase(test, observations[i]) }));
  const families = [...new Set(cases.map(c => c.expressionFamilyId))].sort().map(family => ({ family,
    total: diagnostic.filter(d => d.family === family).length, correct: diagnostic.filter(d => d.family === family && d.correctOutcome).length }));
  console.log("VISIBLE DEVELOPMENT BASELINE (not independent):", JSON.stringify({ report, families,
    admissionNote: "Offline only: admitted=false. executionBlocked means no admission, NOT validator rejection.",
    wrongPlans: diagnostic.filter(d => d.semanticFailure).map(d => d.caseId),
    leakageStatus: auditPilotLeakage(cases).status }));
  expect(report.gate).toBe("NO_UNSAFE_OBSERVED");
  expect(report.micro.semanticFailures).toBe(0); expect(report.micro.unsafe.numerator).toBe(0);
  expect(summarizePilot(cases, observations)).toEqual(report);
});
