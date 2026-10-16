import { expect, it } from "vitest";
import { b2d1Fixture, b2d1Bound } from "../src/evaluation/b2d1-fixtures.js";
import { validateB2D1Fixture, preflightB2D1Budget, inspectB2D1Schema } from "../src/evaluation/b2d1-contract.js";
import { LlmPlanOutputJsonSchema } from "../src/nlu/providers/llm-schema.js";
const profile = { modelId: "openai/gpt-oss-20b", configurationId: "offline-groq-20b-v1", input: 100_000, output: 200_000 };
const caps = { calls: 2, tokens: 1000, microUsd: 1000 };
it("accepts hand-written projection but never grants real dispatch", () => {
  expect(validateB2D1Fixture(b2d1Fixture(), profile)).toMatchObject({ ok: true, realDispatchAllowed: false,
    usage: { input: 100, output: 40, reasoning: 10, total: 140 } });
});
it.each(["model", "config", "missing_usage", "missing_reasoning", "unknown_reasoning", "wrong_total", "double_reasoning", "negative", "overflow", "string", "tool_call", "refusal", "empty", "large", "multi_choice"])("rejects %s synthetic contract mutation", mode => {
  const f: any = b2d1Fixture();
  if (mode === "model") f.response.model = "unknown-model";
  if (mode === "config") f.configurationId = "wrong";
  if (mode === "missing_usage") delete f.response.usage;
  if (mode === "missing_reasoning") delete f.response.usage.completion_tokens_details;
  if (mode === "unknown_reasoning") f.reasoningAccounting = "unknown";
  if (mode === "wrong_total") f.response.usage.total_tokens = 139;
  if (mode === "double_reasoning") f.response.usage.total_tokens = 150;
  if (mode === "negative") f.response.usage.prompt_tokens = -1;
  if (mode === "overflow") f.response.usage.prompt_tokens = Number.MAX_SAFE_INTEGER + 1;
  if (mode === "string") f.response.usage.prompt_tokens = "100";
  if (mode === "tool_call") f.response.choices[0].message.tool_calls = [{ type: "function" }];
  if (mode === "refusal") f.response.choices[0].message.refusal = "refused";
  if (mode === "empty") f.response.choices[0].message.content = "";
  if (mode === "large") f.response.choices[0].message.content = "ü".repeat(32769);
  if (mode === "multi_choice") f.response.choices.push(f.response.choices[0]);
  expect(validateB2D1Fixture(f, profile).ok).toBe(false);
});
it.each(["length", "tool_calls", "content_filter", "unknown", ""])("finish reason %s never counts as complete", finish => {
  const f = b2d1Fixture(); f.response.choices[0]!.finish_reason = finish;
  expect(validateB2D1Fixture(f, profile)).toMatchObject({ ok: false, reason: "incomplete_or_unknown_finish" });
});
it("reasoning is a breakdown, not extra tokens; overflow and excessive breakdown fail", () => {
  const f = b2d1Fixture(); f.response.usage.completion_tokens_details.reasoning_tokens = 41;
  expect(validateB2D1Fixture(f, profile).ok).toBe(false);
  f.response.usage.prompt_tokens = Number.MAX_SAFE_INTEGER; expect(validateB2D1Fixture(f, profile).ok).toBe(false);
});
it("counts every initial/repair prompt component and output ceiling separately", () => {
  const result = preflightB2D1Budget([b2d1Bound(), b2d1Bound(10)], 100, profile, caps);
  expect(result).toMatchObject({ offlineEligible: true, realDispatchAllowed: false, totalTokens: 340,
    reservations: [{ input: 65, output: 100, microUsd: 27 }, { input: 75, output: 100, microUsd: 28 }] });
});
it.each(["estimated", "missing_schema", "missing_overhead", "model", "revision", "initial_repair", "unsafe_count", "excess_calls", "excess_tokens", "excess_usd"])("%s bound cannot pass offline preflight", mode => {
  const b: any = b2d1Bound(); let limits = { ...caps }, bounds = [b];
  if (mode === "estimated") b.evidence = "estimate";
  if (mode === "missing_schema") delete b.components.schema;
  if (mode === "missing_overhead") delete b.components.chatTemplateOverhead;
  if (mode === "model") b.modelId = "unknown";
  if (mode === "revision") b.tokenizerRevision = "";
  if (mode === "initial_repair") b.components.repair = 1;
  if (mode === "unsafe_count") b.components.user = Infinity;
  if (mode === "excess_calls") bounds = [b, b, b];
  if (mode === "excess_tokens") limits.tokens = 100;
  if (mode === "excess_usd") limits.microUsd = 1;
  expect(preflightB2D1Budget(bounds, 100, profile, limits)).toMatchObject({ offlineEligible: false, realDispatchAllowed: false });
});
const strict = () => ({ type: "object", properties: { value: { type: ["string", "null"] } }, required: ["value"], additionalProperties: false });
it("accepts conservative strict schema profile but does not claim provider acceptance", () => {
  expect(inspectB2D1Schema(strict())).toMatchObject({ staticProfilePassed: true, providerAcceptanceVerified: false });
});
it.each(["propertyNames", "patternProperties", "allOf", "default", "format"])("unverified keyword %s fails, never silently strips", keyword => {
  const schema = { ...strict(), [keyword]: {} }; const before = JSON.stringify(schema);
  const result = inspectB2D1Schema(schema); expect(result.staticProfilePassed).toBe(false);
  expect(result.findings.some(f => f.includes("unverified_keyword"))).toBe(true); expect(JSON.stringify(schema)).toBe(before);
});
it("requires closed objects, all fields required, resolved local references", () => {
  expect(inspectB2D1Schema({ ...strict(), additionalProperties: true }).staticProfilePassed).toBe(false);
  expect(inspectB2D1Schema({ ...strict(), required: [] }).staticProfilePassed).toBe(false);
  expect(inspectB2D1Schema({ ...strict(), properties: { value: { $ref: "https://invalid.example/schema" } } }).staticProfilePassed).toBe(false);
  expect(inspectB2D1Schema({ ...strict(), properties: { value: { $ref: "#/$defs/missing" } } }).staticProfilePassed).toBe(false);
  expect(inspectB2D1Schema({ ...strict(), properties: { value: { $ref: "#/$defs/name" } }, $defs: { name: { type: "string" } } }).staticProfilePassed).toBe(true);
});
it("current shared LLM schema fails conservative strict subset without modifying it", () => {
  const before = JSON.stringify(LlmPlanOutputJsonSchema), result = inspectB2D1Schema(LlmPlanOutputJsonSchema);
  expect(result.staticProfilePassed).toBe(false);
  expect(result.findings.some(f => f.includes("properties_not_all_required"))).toBe(true);
  expect(JSON.stringify(LlmPlanOutputJsonSchema)).toBe(before);
});
it("invalid root, unconstrained and cyclic schemas fail closed", () => {
  for (const schema of [null, true, {}, { type: "array", items: { type: "string" } }]) expect(inspectB2D1Schema(schema).staticProfilePassed).toBe(false);
  const schema: any = strict(); schema.properties.value = schema;
  expect(inspectB2D1Schema(schema).staticProfilePassed).toBe(false);
});
it("unknown profile cannot authorize an equally unknown model", () => {
  const f = b2d1Fixture(); f.response.model = "unknown";
  expect(validateB2D1Fixture(f, { ...profile, modelId: "unknown" }).ok).toBe(false);
  const bound = b2d1Bound(); bound.modelId = "unknown";
  expect(preflightB2D1Budget([bound], 100, { ...profile, modelId: "unknown" }, caps).offlineEligible).toBe(false);
});
it("known 120b identity can be checked without activating it", () => {
  const f = b2d1Fixture(); f.response.model = "openai/gpt-oss-120b"; f.configurationId = "offline-groq-120b-v1";
  expect(validateB2D1Fixture(f, { ...profile, modelId: f.response.model, configurationId: f.configurationId })).toMatchObject({ ok: true, realDispatchAllowed: false });
});
it("different tokenizer revisions across attempts cannot pass", () => {
  const repair = b2d1Bound(10); repair.tokenizerRevision = "different";
  expect(preflightB2D1Budget([b2d1Bound(), repair], 100, profile, caps).offlineEligible).toBe(false);
});
it("unsafe total counters and empty bounds fail closed", () => {
  const bound = b2d1Bound(); bound.components.user = Number.MAX_SAFE_INTEGER;
  expect(preflightB2D1Budget([bound], 100, profile, caps).offlineEligible).toBe(false);
  expect(preflightB2D1Budget([], 100, profile, caps).offlineEligible).toBe(false);
});
it("nonfinite enum is invalid even in an in-memory schema", () => {
  expect(inspectB2D1Schema({ ...strict(), properties: { value: { type: "number", enum: [Infinity] } } }).staticProfilePassed).toBe(false);
});
