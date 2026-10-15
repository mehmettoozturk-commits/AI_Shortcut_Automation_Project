import { afterEach, describe, expect, it, vi } from "vitest";
import { evaluateCase, runMockEvaluation, summarize } from "../src/evaluation/runner.js";
import { turkishEvaluationCases } from "../src/evaluation/turkish-cases.js";
import { CATEGORIES, type EvaluationCase } from "../src/evaluation/types.js";
import { estimateCost, estimateTokens, SIMULATED_PRICES } from "../src/evaluation/cost.js";
import { validateSchema } from "../src/validators/schema-validator.js";
import { validatePermissions } from "../src/validators/permission-validator.js";
import { findCapability } from "../src/capability-registry/registry.js";

const cases = turkishEvaluationCases();
const damaged = cases.find(c => c.category === "bozuk_cikti")!;
const basic = cases[0]!;
afterEach(() => vi.unstubAllGlobals());

describe("P2-B2A offline regression corpus", () => {
  it("has 104 unique Turkish inputs, IDs, eight balanced categories and explicit oracles", () => {
    expect(cases).toHaveLength(104);
    expect(new Set(cases.map(c => c.id)).size).toBe(104);
    expect(new Set(cases.map(c => c.input)).size).toBe(104);
    for (const category of CATEGORIES) expect(cases.filter(c => c.category === category)).toHaveLength(13);
    expect(cases.every(c => c.input && c.expected.status && Number.isInteger(c.expected.calls))).toBe(true);
  });
  it.each(cases)("$id: $input", async test => {
    const result = await evaluateCase(test);
    expect(result.failures).toEqual([]);
    expect(result.passed).toBe(true);
  });
  it("reports mock-only metrics without touching fetch or keys", async () => {
    const fetch = vi.fn(() => { throw new Error("Network forbidden"); });
    vi.stubGlobal("fetch", fetch);
    const { summary, results } = await runMockEvaluation(cases);
    expect(fetch).not.toHaveBeenCalled();
    expect(summary).toMatchObject({ mode: "mock/simulated", realApiCalls: 0, realKeysUsed: 0, total: 104, passed: 104,
      layers: { nlu: 78, validatorOnly: 26 }, schemaValidity: { valid: 117, total: 130, rate: 0.9 },
      capabilityCorrectness: { correct: 78, total: 78, rate: 1 }, repairSuccess: { successful: 13, attempted: 13, rate: 1 },
      safetyViolationCount: 0, mockProviderInvocationCount: 65 });
    expect(results.filter(r => r.provenance?.resolutionSource === "local_template")).toHaveLength(26);
    expect(results.every(r => r.provenance === null || r.provenance.providerCallCount === r.calls)).toBe(true);
    expect(summary.cost.inputTokens).toBeGreaterThan(0);
    expect(summary.cost.estimates[1]!.estimatedUsd).toBeCloseTo(summary.cost.estimates[0]!.estimatedUsd * 2);
  });
  it("detects schema-valid but wrong direction, threshold and steps", async () => {
    const result = await evaluateCase({ ...damaged, expected: { ...damaged.expected,
      params: { level: 70, condition: "above" }, stepTypes: ["tesla.doors.lock"] } });
    expect(result.passed).toBe(false);
    expect(result.capabilityCorrect).toBe(false);
    expect(result.failures).toEqual(["param:level", "param:condition", "steps"]);
  });
  it("detects incorrect clarification question independently of status", async () => {
    const test = cases.find(c => c.category === "eksik_bilgi")!;
    const result = await evaluateCase({ ...test, expected: { ...test.expected, question: "vehicle" } });
    expect(result.status).toBe("needs_clarification");
    expect(result.passed).toBe(false);
    expect(result.clarificationCorrect).toBe(false);
  });
  it("failed second output is not successful repair", async () => {
    const result = await evaluateCase({ ...damaged, replies: [damaged.replies[0]!, damaged.replies[0]!],
      expected: { status: "provider_error", calls: 2 } });
    expect(result.passed).toBe(true);
    expect(result.repairSucceeded).toBe(false);
    expect(result.schemaValid).toBe(0);
  });
  it.each(["timeout", "error", "abort"] as const)("%s is safe, one mock call, no repair", async kind => {
    const result = await evaluateCase({ ...damaged, replies: [{ kind }], expected: { status: "provider_error", calls: 1 } });
    expect(result.passed).toBe(true);
    expect(result.repairAttempted).toBe(false);
    expect(result.provenance?.providerInvocations).toHaveLength(1);
    if (kind === "abort") expect(result.provenance?.cancelled).toBe(true);
  });
  it("script exhaustion cannot silently synthesize success", async () => {
    expect((await evaluateCase({ ...damaged, replies: [], expected: { status: "provider_error", calls: 1 } })).passed).toBe(true);
  });
  it("parallel evaluations keep invocations, provenance IDs and oracles separate", async () => {
    const results = await Promise.all([damaged, basic, damaged, basic].map(c => evaluateCase(c)));
    expect(results.map(r => r.calls)).toEqual([2, 0, 2, 0]);
    expect(results.every(r => r.passed)).toBe(true);
    expect(new Set(results.map(r => r.provenance?.requestId)).size).toBe(4);
  });
});

describe("P2-B2A validator guards and metric calculations", () => {
  const fixture = (rawPlan: unknown, expected: EvaluationCase["expected"]): EvaluationCase => ({
    id: "validator", input: "Bozuk veya yetkisiz planı kabul etme", category: "bozuk_cikti", layer: "dsl", replies: [], rawPlan, expected,
  });
  const valid = { name: "Bildirim", trigger: { type: "ios.battery.falls_below", params: { level: 20, condition: "below" } }, steps: [{ type: "ios.notification.show" }] };
  it.each([null, {}, { ...valid, steps: [] }, { ...valid, trigger: null }])("rejects malformed DSL %#", async raw => {
    const result = await evaluateCase(fixture(raw, { status: "schema_error", calls: 0 }));
    expect(result.status).toBe("schema_error");
    expect(result.passed).toBe(true);
  });
  it("rejects invented capabilities without treating schema validity as success", async () => {
    const r = await evaluateCase(fixture({ ...valid, trigger: { type: "ios.magic" } }, { status: "validation_error", calls: 0, issue: "unknown_capability" }));
    expect(r.passed).toBe(true);
    expect(r.schemaValid).toBe(1);
    expect(r.capabilityCorrect).toBe(false);
  });
  it("checks a denied future app-owned permission using the existing validator seam", () => {
    const parsed = validateSchema(valid).plan!;
    const lookupCapability = (id: string) => {
      const cap = findCapability(id);
      return cap && id === "ios.notification.show" ? { ...cap, runtimePermissions: ["app_notifications"] } : cap;
    };
    expect(validatePermissions(parsed, { grantedPermissions: [], lookupCapability }).issues.map(i => i.code)).toContain("missing_permission");
    expect(validatePermissions(parsed, { grantedPermissions: ["app_notifications"], lookupCapability }).ok).toBe(true);
  });
  it("latency uses mean and nearest-rank P95; absent metrics stay null", async () => {
    const result = await evaluateCase(basic, (() => { let time = 0; return () => { time += 5; return time; }; })());
    expect(result.durationMs).toBe(5);
    const summary = summarize(Array.from({ length: 20 }, (_, i) => ({ ...result, id: String(i), durationMs: i + 1 })));
    expect(summary.latency.averageMs).toBe(10.5);
    expect(summary.latency.p95Ms).toBe(19);
    expect(summary.repairSuccess.rate).toBeNull();
    expect(() => summarize([])).toThrow();
    expect(() => summarize([result, result])).toThrow();
  });
  it("cost is configurable, dated, sourced and excludes hidden usage", () => {
    expect(estimateCost(4000, 300, SIMULATED_PRICES[0]!)).toBeCloseTo(0.00039);
    expect(estimateCost(4000, 300, { ...SIMULATED_PRICES[0]!, inputUsdPerMillion: 1, outputUsdPerMillion: 2 })).toBeCloseTo(0.0046);
    expect(estimateTokens("abcd")).toBe(1);
    expect(estimateTokens("")).toBe(0);
    for (const n of [-1, NaN, Infinity, 0.5]) expect(() => estimateCost(n, 0, SIMULATED_PRICES[0]!)).toThrow();
    expect(() => estimateCost(1, 1, { ...SIMULATED_PRICES[0]!, source: "" })).toThrow();
  });
});
