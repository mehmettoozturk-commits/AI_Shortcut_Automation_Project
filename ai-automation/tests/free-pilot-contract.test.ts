import { describe, expect, it } from "vitest";
import { currentPilotSnapshotHash, parsePilotCases, type PilotCase } from "../src/evaluation/free-pilot-contract.js";
import { auditPilotLeakage, maskPilotNumbers } from "../src/evaluation/free-pilot-leakage.js";
import { canonicalPilotPlan, PilotEvaluationError, scorePilotCase, summarizePilot, type PilotObservation } from "../src/evaluation/free-pilot-scoring.js";

// SYNTHETIC DEVELOPMENT FIXTURES ONLY: not a corpus, blind bank or quality benchmark.
const requirements = { approval: "not_required" as const, permissions: [], safety: [] };
const plan = () => ({ name: "Synthetic", trigger: { type: "ios.battery.falls_below", params: { level: 20, condition: "below" } },
  steps: [{ type: "ios.notification.show", params: { message: "Synthetic content" } }] });
function fixture(n = 1): PilotCase {
  return parsePilotCases([{
    schemaVersion: 1, oracleVersion: "synthetic-v1", capabilitySnapshotHash: currentPilotSnapshotHash(),
    caseId: `synthetic-${n}`, input: "Pil %20 altına düşünce bildir", sourceId: `session-${n}`, authorId: "synthetic-author",
    generatorVersion: "synthetic-fixture-v1", promptFamilyId: `prompt-${n}`, expressionFamilyId: `expression-${n}`, numericFamilyId: `numeric-${n}`,
    split: "development", reviewStatus: "reviewed", category: "positive", capabilityId: "ios.battery.falls_below",
    polarity: "positive", direction: "below", slotState: "complete", slotAnnotations: [],
    oracle: { outcome: "plan", plan: plan(), requirements },
  }])[0]!;
}
function observed(): PilotObservation {
  return { outcome: "plan", plan: plan(), requirements, question: null,
    validation: { ok: true, stage: "complete", codes: [] }, admitted: false, executed: null };
}
describe("free pilot contract (synthetic development fixtures)", () => {
  it("accepts reviewed, versioned fixture and rejects duplicate IDs/snapshot", () => {
    expect(parsePilotCases([fixture()])).toHaveLength(1);
    expect(() => parsePilotCases([fixture(), fixture()])).toThrow("duplicate_case_id");
    expect(() => parsePilotCases([fixture()], "a".repeat(64))).toThrow("snapshot_mismatch");
  });
  it.each(["sourceId", "authorId", "generatorVersion", "promptFamilyId", "expressionFamilyId", "numericFamilyId", "oracleVersion"])("rejects missing provenance %s", key => {
    const value = { ...fixture(), [key]: "" }; expect(() => parsePilotCases([value])).toThrow();
  });
  it.each(["polarity", "direction", "slotState", "split", "reviewStatus"])("rejects invalid enum %s", key => {
    expect(() => parsePilotCases([{ ...fixture(), [key]: "invented" }])).toThrow();
  });
  it("rejects invented capability and unsupported records without null target/concept/unknown oracle", () => {
    expect(() => parsePilotCases([{ ...fixture(), capabilityId: "invented.capability" }])).toThrow();
    const unsupported = { ...fixture(), category: "unsupported", capabilityId: null, requestedConcept: "synthetic unsupported", oracle: { outcome: "unknown", plan: null } };
    expect(parsePilotCases([unsupported])).toHaveLength(1);
    for (const changed of [{ requestedConcept: undefined }, { capabilityId: "ios.notification.show" }, { oracle: fixture().oracle }]) {
      expect(() => parsePilotCases([{ ...unsupported, ...changed }])).toThrow();
    }
  });
  it.each(["missing", "multiple", "conflicting"])("rejects a plan oracle with unsafe slot state %s", slotState => {
    expect(() => parsePilotCases([{ ...fixture(), slotState }])).toThrow();
  });
  it("rejects negative plan, direction conflict, malformed oracle, unknown action and bad span", () => {
    for (const changed of [{ polarity: "negative" }, { direction: "above" }, { oracle: { outcome: "unknown", plan: plan() } },
      { oracle: { outcome: "plan", plan: { ...plan(), steps: [{ type: "invented.action" }] }, requirements } },
      { slotAnnotations: [{ type: "percentage", start: 10, end: 2, value: 20, ambiguityReason: null }] }]) {
      expect(() => parsePilotCases([{ ...fixture(), ...changed }])).toThrow();
    }
  });
  it("requires frozen blind and preserves snapshot/oracle/schema versions", () => {
    expect(() => parsePilotCases([{ ...fixture(), split: "blind" }])).toThrow();
    const value = parsePilotCases([{ ...fixture(), split: "blind", reviewStatus: "frozen" }])[0]!;
    expect(value.oracleVersion).toBe("synthetic-v1"); expect(value.schemaVersion).toBe(1); expect(value.capabilitySnapshotHash).toBe(currentPilotSnapshotHash());
  });
});
describe("leakage auditor (custodian-side only)", () => {
  it.each(["sourceId", "promptFamilyId", "expressionFamilyId", "numericFamilyId"] as const)("detects cross-split relationship %s", key => {
    const a = fixture(), b = { ...fixture(2), split: "regression" as const, [key]: a[key] };
    expect(auditPilotLeakage([a, b]).status).toBe("LEAKAGE");
  });
  it("does not silently pass changed family IDs for numeric/clock variants", () => {
    const a = { ...fixture(), input: "Saat 08:20 bildir" }, b = { ...fixture(2), input: "Saat 09:40 bildir", split: "regression" as const };
    expect(auditPilotLeakage([a, b]).findings).toContainEqual(expect.objectContaining({ reason: "numeric_variant", severity: "REVIEW_REQUIRED" }));
  });
  it("preserves negation, correction and direction while flagging lexical suspicion", () => {
    expect(maskPilotNumbers("Pil %20 altına düşünce bildirme")).toContain("bildirme");
    expect(maskPilotNumbers("%20 değil %35 üstüne")).toContain("değil");
    expect(maskPilotNumbers("%20 altına")).not.toBe(maskPilotNumbers("%20 üstüne"));
    const a = fixture(), b = { ...fixture(2), input: "Pil %21 altına düşünce bildirme", split: "regression" as const };
    expect(auditPilotLeakage([a, b]).status).toBe("REVIEW_REQUIRED");
  });
  it("detects exact duplicates and transitive components deterministically", () => {
    const a = fixture(), b = { ...fixture(2), sourceId: a.sourceId }, c = { ...fixture(3), promptFamilyId: b.promptFamilyId, split: "regression" as const };
    const report = auditPilotLeakage([a, b, c]); expect(report.components).toEqual([[a.caseId, b.caseId, c.caseId]]);
    expect(report.findings.some(f => f.reason === "transitive_component")).toBe(true);
    expect(auditPilotLeakage([c, a, b])).toEqual(report);
    expect(auditPilotLeakage([a, { ...fixture(2), input: a.input, split: "regression" }]).status).toBe("LEAKAGE");
  });
  it("allows truly disjoint fixtures and ignores shared generator version alone", () => {
    const a = fixture(), b = { ...fixture(2), input: "Tamamen ayrı sentetik zaman isteği" };
    expect(auditPilotLeakage([a, b]).status).toBe("PASS");
  });
});
describe("deterministic scoring, not model quality", () => {
  it("ignores root display name but preserves every meaningful field", () => {
    expect(canonicalPilotPlan({ ...plan(), name: "Other presentation" })).toBe(canonicalPilotPlan(plan()));
    for (const changed of [{ ...plan(), trigger: { ...plan().trigger, params: { level: 20, condition: "above" } } },
      { ...plan(), steps: [{ type: "ios.notification.show", params: { message: "Different requested content" } }] }]) {
      expect(canonicalPilotPlan(changed)).not.toBe(canonicalPilotPlan(plan()));
    }
    const branched = { ...plan(), steps: [{ type: "ask_confirmation", message: "Confirm?" },
      { type: "conditional", condition: "answer == yes", then: plan().steps, else: [] }] };
    expect(canonicalPilotPlan({ ...branched, steps: [...branched.steps].reverse() })).not.toBe(canonicalPilotPlan(branched));
  });
  it("distinguishes correct plan, wrong blocked plan and safe abstention", () => {
    expect(scorePilotCase(fixture(), observed()).exactCorrect).toBe(true);
    const wrong = { ...observed(), plan: { ...plan(), trigger: { ...plan().trigger, params: { level: 21, condition: "below" } } },
      validation: { ok: false, stage: "capability", codes: ["synthetic_rejection"] } };
    const score = scorePilotCase(fixture(), wrong); expect(score.semanticFailure).toBe(true); expect(score.executionBlocked).toBe(true); expect(score.safeAbstention).toBe(false);
    expect(score.criticalSlotMisbinding).toBe(true);
    expect(() => scorePilotCase(fixture(), { ...observed(), plan: null })).toThrow();
    const abstain = scorePilotCase(fixture(), { ...observed(), outcome: "unknown", plan: null });
    expect(abstain.safeAbstention).toBe(true); expect(abstain.exactCorrect).toBe(false);
  });
  it.each([
    { outcome: "unknown", plan: null, admitted: true },
    { outcome: "unknown" },
    { outcome: "clarification", plan: null, admitted: true, question: { field: "battery_level", reasonCode: "missing" } },
    { outcome: "clarification", question: { field: "battery_level", reasonCode: "missing" } },
    { outcome: "plan", plan: null },
    { outcome: "validation_failure" },
    { executed: true, admitted: false },
  ])("rejects inconsistent observation and never produces a passing aggregate: %j", changes => {
    const invalid = { ...observed(), ...changes };
    expect(() => scorePilotCase(fixture(), invalid)).toThrow();
    try { summarizePilot([fixture()], [invalid]); throw Error("Unexpected report"); }
    catch (error) { expect(error).toBeInstanceOf(PilotEvaluationError); expect((error as PilotEvaluationError).gate).toBe("EVALUATION_ERROR"); }
  });
  it("suppresses complementary blind categories and all family scores", () => {
    const cases = Array.from({ length: 6 }, (_, i) => ({ ...fixture(i + 1), split: "blind" as const, reviewStatus: "frozen" as const }));
    cases[5] = { ...cases[5]!, category: "unsupported", capabilityId: null, requestedConcept: "Synthetic", oracle: { outcome: "unknown", plan: null } };
    const actual = cases.map(() => observed()); actual[5] = { ...observed(), outcome: "unknown", plan: null };
    const report = summarizePilot(cases, actual);
    expect(report.byCategory).toEqual([]); expect(report.macroFamilyCorrect).toBeNull();
    expect(JSON.stringify(report)).not.toContain("expression-"); expect(report.micro.total).toBe(6);
    const allLarge = cases.slice(0, 5); expect(summarizePilot(allLarge, actual.slice(0, 5)).byCategory).toHaveLength(1);
    expect(summarizePilot(allLarge, actual.slice(0, 5)).macroFamilyCorrect).toBeNull();
  });
  it("scores exact clarification and rejects unsafe assumptions", () => {
    const test = { ...fixture(), slotState: "missing" as const, oracle: { outcome: "clarification" as const, plan: null, question: { field: "battery_level", reasonCode: "missing" } } };
    expect(scorePilotCase(test, { ...observed(), outcome: "clarification", plan: null, question: test.oracle.question }).clarificationCorrect).toBe(true);
    expect(scorePilotCase(test, observed()).unsafeAssumption).toBe(true);
    expect(scorePilotCase(test, observed()).criticalSlotMisbinding).toBe(true);
  });
  it("scores unsupported false positives, polarity, direction, requirements and execution independently", () => {
    const unsupported = { ...fixture(), category: "unsupported" as const, capabilityId: null, requestedConcept: "synthetic", oracle: { outcome: "unknown" as const, plan: null } };
    expect(scorePilotCase(unsupported, observed()).unsupportedFalsePositive).toBe(true);
    expect(scorePilotCase({ ...unsupported, polarity: "negative" }, observed()).polarityInversion).toBe(true);
    const wrong = { ...observed(), plan: { ...plan(), trigger: { ...plan().trigger, params: { level: 20, condition: "above" } } }, admitted: true, executed: true };
    const score = scorePilotCase(fixture(), wrong); expect(score.directionInversion).toBe(true); expect(score.validationBypass).toBe(true); expect(score.unexpectedExecution).toBe(true);
    expect(scorePilotCase(fixture(), { ...observed(), requirements: { ...requirements, permissions: ["bluetooth"] } }).exactCorrect).toBe(false);
    expect(scorePilotCase(fixture(), { ...observed(), plan: { ...plan(), trigger: { type: "ios.time_of_day.daily", params: { time: "09:30" } } } }).capabilityMismatch).toBe(true);
  });
  it("requires matching plan, issue code and stage for validation rejection", () => {
    const test = { ...fixture(), oracle: { outcome: "validation_failure" as const, plan: plan(), requirements, validation: { stage: "permission" as const, codes: ["missing_permission"] } } };
    const actual = { ...observed(), outcome: "validation_failure", validation: { ok: false, stage: "permission", codes: ["missing_permission"] } };
    expect(scorePilotCase(test, actual).validationCorrect).toBe(true);
    expect(scorePilotCase(test, { ...actual, validation: { ...actual.validation, stage: "safety" } }).validationCorrect).toBe(false);
  });
  it("exposes denominators and macro-family score without case-level blind data", () => {
    const tests = [fixture(), fixture(2)], obs = [observed(), { ...observed(), outcome: "unknown", plan: null }];
    const result = summarizePilot(tests, obs); expect(result.micro.precision).toEqual({ numerator: 1, denominator: 1 });
    expect(result.micro.recall).toEqual({ numerator: 1, denominator: 2 }); expect(result.micro.executionUnknown).toBe(2);
    expect(result.macroFamilyCorrect).toEqual({ sum: 1, denominator: 2 });
    expect(JSON.stringify(result)).not.toContain("synthetic-1"); expect(JSON.stringify(result)).not.toContain(tests[0]!.input);
    expect(summarizePilot(tests, obs)).toEqual(result);
    expect(() => summarizePilot(tests, [])).toThrow();
    expect(() => summarizePilot([{ ...fixture(), split: "blind", reviewStatus: "frozen" }], [observed()])).toThrow("blind_aggregate");
  });
});
