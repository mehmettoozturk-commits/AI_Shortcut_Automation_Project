import { afterEach, expect, it, vi } from "vitest";
import { decodePB01Wire, encodePB01Semantic, PB01_VERSION, pb01WireSchema } from "../src/evaluation/pb01-wire.js";
import { validatePB01Plan, evaluatePB01Schedule } from "../src/evaluation/pb01-integration.js";
import { inspectB2D1Schema } from "../src/evaluation/b2d1-contract.js";
import * as registry from "../src/capability-registry/registry.js";
import * as llm from "../src/nlu/providers/llm-schema.js";
import * as builder from "../src/nlu/plan-builder.js";
import { PB01_LIMITS } from "../src/evaluation/pb01-json.js";

const numeric = (value: number) => ({ kind: "number", value });
const text = (value: string) => ({ kind: "string", value });
function wire() {
  return { version: PB01_VERSION, intent: "create_automation", confidence: 0.95,
    trigger: { semantic: "battery_below", details: [{ key: "level", value: numeric(20) }, { key: "condition", value: text("below") }] },
    steps: [{ semantic: "notify", message: null as string | null, details: null as any }], entities: [] as any[], missing: [] as any[] };
}
const source = "Pil yüzde 20'nin altına düşünce bana haber ver";
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });
it("strict schema passes conservative static profile, without provider acceptance claims", () => {
  expect(inspectB2D1Schema(pb01WireSchema())).toMatchObject({ staticProfilePassed: true, providerAcceptanceVerified: false });
  const first: any = pb01WireSchema(); first.properties.intent.enum.push("bad");
  expect((pb01WireSchema() as any).properties.intent.enum).not.toContain("bad");
});
it("wire schema semantic enums contain catalog names, not device capability ids", () => {
  const schema = pb01WireSchema() as any;
  expect(schema.properties.trigger.anyOf[0].properties.semantic.enum).toContain("battery_below");
  expect(schema.properties.steps.items.properties.semantic.enum.some((s: string) => s.includes("."))).toBe(false);
});
it("valid wire decodes and round trips without silently dropping fields", () => {
  const w = wire(), result = decodePB01Wire(JSON.stringify(w));
  expect(result.semantic).toEqual({ intent: "create_automation", confidence: 0.95,
    trigger: { semantic: "battery_below", details: { level: 20, condition: "below" } },
    steps: [{ semantic: "notify", message: null }], entities: [], missing: [] });
  expect(JSON.parse(encodePB01Semantic(JSON.stringify(result.semantic)))).toEqual(w);
});
it("nested null, empty string, empty object and array stay distinct in details", () => {
  const w = wire(); w.steps[0]!.details = [{ key: "nested", value: { kind: "object", value: [
    { key: "n", value: { kind: "null", value: null } }, { key: "s", value: text("") },
    { key: "o", value: { kind: "object", value: [] } }, { key: "a", value: { kind: "array", value: [] } },
    { key: "b", value: { kind: "boolean", value: false } }, { key: "list", value: { kind: "array", value: [numeric(0), text("x")] } },
  ] } }];
  const decoded = decodePB01Wire(JSON.stringify(w));
  expect(decoded.semantic.steps[0]!.details).toEqual({ nested: { n: null, s: "", o: {}, a: [], b: false, list: [0, "x"] } });
  expect(JSON.parse(encodePB01Semantic(JSON.stringify(decoded.semantic)))).toEqual(w);
});
it("absence/null/empty details and confidence have explicit reversible representations", () => {
  const w: any = wire(); w.confidence = null; w.steps[0].details = [];
  const decoded = decodePB01Wire(JSON.stringify(w));
  expect(Object.hasOwn(decoded.semantic, "confidence")).toBe(false); expect(decoded.semantic.steps[0]!.details).toEqual({});
  expect(JSON.parse(encodePB01Semantic(JSON.stringify(decoded.semantic)))).toEqual(w);
  w.trigger = null; expect(decodePB01Wire(JSON.stringify(w)).semantic.trigger).toBeNull();
});
it.each(["extra_root", "extra_step", "extra_trigger", "extra_tag", "missing_version", "missing_message", "missing_confidence", "wrong_kind", "unknown_trigger", "unknown_action", "device_id", "unknown_entity", "duplicate_entity", "bad_condition", "bad_battery", "duplicate_missing"])("rejects %s without stripping/filling", mode => {
  const w: any = wire();
  if (mode === "extra_root") w.permissionGranted = true;
  if (mode === "extra_step") w.steps[0].approval = true;
  if (mode === "extra_trigger") w.trigger.device = "Tesla";
  if (mode === "extra_tag") w.trigger.details[0].value.extra = 1;
  if (mode === "missing_version") delete w.version;
  if (mode === "missing_message") delete w.steps[0].message;
  if (mode === "missing_confidence") delete w.confidence;
  if (mode === "wrong_kind") w.trigger.semantic = "notify";
  if (mode === "unknown_trigger") w.trigger.semantic = "imaginary";
  if (mode === "unknown_action") w.steps[0].semantic = "imaginary";
  if (mode === "device_id") w.steps[0].semantic = "ios.notification.show";
  if (mode === "unknown_entity") w.entities = [{ name: "premium", value: "true" }];
  if (mode === "duplicate_entity") w.entities = [{ name: "vehicle", value: "A" }, { name: "vehicle", value: "B" }];
  if (mode === "bad_condition") w.entities = [{ name: "condition", value: "over" }];
  if (mode === "bad_battery") w.entities = [{ name: "batteryLevel", value: "not-a-number" }];
  if (mode === "duplicate_missing") w.missing = [{ field: "time", reason: "one" }, { field: "time", reason: "two" }];
  expect(() => decodePB01Wire(JSON.stringify(w))).toThrow();
});
it.each([-1, 1.001, "0.9"])("confidence %s is rejected", confidence => {
  expect(() => decodePB01Wire(JSON.stringify({ ...wire(), confidence }))).toThrow();
});
it.each(["__proto__", "constructor", "prototype"])("forbidden details entry %s is rejected", key => {
  const w: any = wire(); w.steps[0].details = [{ key, value: text("bad") }];
  expect(() => decodePB01Wire(JSON.stringify(w))).toThrow("details_duplicate_or_forbidden_key");
});
it("duplicate details entry keys including escaped spelling are rejected", () => {
  const w: any = wire(); w.steps[0].details = [{ key: "same", value: text("A") }, { key: "same", value: text("B") }];
  expect(() => decodePB01Wire(JSON.stringify(w))).toThrow("details_duplicate_or_forbidden_key");
  const raw = JSON.stringify(w).replace('"key":"same"', '"key":"\\u0073ame"');
  expect(() => decodePB01Wire(raw)).toThrow("details_duplicate_or_forbidden_key");
});
it("duplicate raw wire fields cannot be hidden by JSON.parse", () => {
  const raw = JSON.stringify(wire()).replace('"confidence":0.95', '"confidence":0.95,"confidence":0.1');
  expect(() => decodePB01Wire(raw)).toThrow("json_duplicate_key");
});
it("detail node count has exact acceptance and rejection boundaries", () => {
  const w: any = wire(); w.trigger.details = [];
  // One trigger object + one steps object + 510 scalar values = 512 detail nodes.
  w.steps[0].details = Array.from({ length: PB01_LIMITS.detailNodes - 2 }, (_, i) => ({ key: `k${i}`, value: numeric(i) }));
  expect(decodePB01Wire(JSON.stringify(w))).toBeDefined();
  w.steps[0].details.push({ key: "one_more", value: numeric(1) });
  expect(() => decodePB01Wire(JSON.stringify(w))).toThrow("details_structure_limit");
});
it("nested details beyond semantic depth bound are rejected", () => {
  const w: any = wire(); let value: any = text("bottom");
  for (let i = 0; i < PB01_LIMITS.detailDepth; i++) value = { kind: "array", value: [value] };
  w.steps[0].details = [{ key: "nested", value }];
  expect(() => decodePB01Wire(JSON.stringify(w))).toThrow("details_structure_limit");
});
it("semantic encoder rejects extras and unrepresentable absence rather than dropping them", () => {
  const semantic: any = decodePB01Wire(JSON.stringify(wire())).semantic;
  expect(() => encodePB01Semantic(JSON.stringify({ ...semantic, ignored: true }))).toThrow();
  delete semantic.steps[0].message;
  expect(() => encodePB01Semantic(JSON.stringify(semantic))).toThrow("semantic_message_absence_not_representable");
});
it("low-risk DSL matches exact trigger/action/parameters and full validators", () => {
  const outcome = validatePB01Plan(JSON.stringify(wire()), source);
  expect(outcome.status).toBe("validated_offline");
  if (outcome.status !== "validated_offline") throw Error("expected validated plan");
  expect(outcome.plan).toEqual({ name: "Kullanıcıya bir bildirim gösterir", trigger: { type: "ios.battery.falls_below", params: { level: 20, condition: "below" } }, steps: [{ type: "ios.notification.show" }] });
  expect(outcome.validation.ok).toBe(true); expect(outcome.realDispatchAllowed).toBe(false); expect(outcome.installationVerified).toBe(false);
});
it("null confidence cannot invoke the legacy 0.75 default", () => {
  const convert = vi.spyOn(llm, "toIntentResult");
  const w: any = wire(); w.confidence = null;
  expect(validatePB01Plan(JSON.stringify(w), source)).toMatchObject({ status: "unsupported_by_offline_bridge", reason: "missing_explicit_confidence" });
  expect(convert).not.toHaveBeenCalled();
});
it.each(["vehicle_lock", "vehicle_climate", "ask_confirmation"])("%s never gains auto-generated approval/branch success", semantic => {
  const w = wire(); w.steps[0]!.semantic = semantic;
  expect(validatePB01Plan(JSON.stringify(w), source)).toMatchObject({ status: "unsupported_by_offline_bridge", reason: "approval_branch_not_representable_no_auto_approval" });
});
it("empty decoded details are rejected when the builder omits empty params", () => {
  const w = wire(); w.steps[0]!.details = [];
  // Wire [] decodes to {}; optional registry parameters pass the name check,
  // but resolveParameters returns undefined for no values. The lossless
  // bridge must still reject that {} -> undefined representation change.
  expect(validatePB01Plan(JSON.stringify(w), source)).toMatchObject({
    status: "unsupported_by_offline_bridge", reason: "builder_changed_details",
    realDispatchAllowed: false, installationVerified: false,
  });
});
it.each([{ details: [{ key: "ignored", value: text("keep me") }] },
  { details: [{ key: "nested", value: { kind: "null", value: null } }] }])("unmapped action details %j are rejected, not silently lost", ({ details }) => {
  const w = wire(); w.steps[0]!.details = details;
  expect(validatePB01Plan(JSON.stringify(w), source)).toMatchObject({ status: "unsupported_by_offline_bridge", reason: "details_not_losslessly_mapped_to_dsl" });
});
it.each(["", "Please notify"])("nonnull message %s is not silently discarded", message => {
  const w = wire(); w.steps[0]!.message = message;
  expect(validatePB01Plan(JSON.stringify(w), source)).toMatchObject({ reason: "message_not_losslessly_mapped_to_dsl" });
});
it("current permission validator fails closed with future runtime permission seam", () => {
  const original = registry.findCapability;
  vi.spyOn(registry, "findCapability").mockImplementation(id => {
    const cap = original(id); return cap?.semantic === "notify" ? { ...cap, runtimePermissions: ["microphone"] } : cap;
  });
  const outcome = validatePB01Plan(JSON.stringify(wire()), source);
  expect(outcome).toMatchObject({ status: "unsupported_by_offline_bridge", reason: "validation_failed" });
  if (!("validation" in outcome)) throw Error("expected validation result");
  expect(outcome.validation.issues.some(i => i.code === "missing_permission")).toBe(true);
});
it("temporal ambiguity remains clarification, not a guessed time or validated plan", () => {
  const w: any = wire(); w.trigger = { semantic: "time", details: [{ key: "time", value: text("09:00") }] };
  expect(validatePB01Plan(JSON.stringify(w), "9'da bana haber ver").status).toBe("needs_clarification");
});
it("wire coverage and downstream coverage include every scheduled fixture", () => {
  const w: any = wire(); w.confidence = null;
  const report = evaluatePB01Schedule([{ caseId: "ok", wireText: JSON.stringify(wire()), sourceText: source },
    { caseId: "unsupported", wireText: JSON.stringify(w), sourceText: source }, { caseId: "invalid", wireText: "{}", sourceText: source }]);
  expect(report).toMatchObject({ scheduled: 3, wirePassed: 2, wireRejected: 1, downstreamPassed: 1, downstreamUnsupported: 1,
    downstreamNotEvaluated: 1, wireCoverage: 2 / 3, downstreamCoverage: 1 / 3, realModelQualityMeasured: false });
  expect(evaluatePB01Schedule([]).downstreamCoverage).toBeNull();
  expect(() => evaluatePB01Schedule([{ caseId: "x", wireText: "{}", sourceText: "" }, { caseId: "x", wireText: "{}", sourceText: "" }])).toThrow("duplicate_case_id");
});
it("offline validation never calls external transport", () => {
  const fetch = vi.fn(() => { throw Error("network forbidden"); }); vi.stubGlobal("fetch", fetch);
  expect(validatePB01Plan(JSON.stringify(wire()), source).status).toBe("validated_offline"); expect(fetch).not.toHaveBeenCalled();
});
it("future builder value mutation is rejected rather than mistaken for preserved details", () => {
  const original = builder.buildPlan;
  vi.spyOn(builder, "buildPlan").mockImplementation((...args) => {
    const result = original(...args);
    if (result.status === "plan") result.plan.trigger.params = { ...result.plan.trigger.params, level: 25 };
    return result;
  });
  expect(validatePB01Plan(JSON.stringify(wire()), source)).toMatchObject({ reason: "builder_changed_semantics" });
});
it("future builder capability substitution is rejected", () => {
  const original = builder.buildPlan;
  vi.spyOn(builder, "buildPlan").mockImplementation((...args) => {
    const result = original(...args);
    if (result.status === "plan") result.plan.steps = [{ type: "unknown.capability" }];
    return result;
  });
  expect(validatePB01Plan(JSON.stringify(wire()), source)).toMatchObject({ reason: "builder_changed_action" });
});
it("nonempty entities and absent trigger details are not silently mapped away", () => {
  const w: any = wire(); w.entities = [{ name: "vehicle", value: "Model Y" }];
  expect(validatePB01Plan(JSON.stringify(w), source)).toMatchObject({ reason: "entities_not_losslessly_mapped_to_dsl" });
  w.entities = []; w.trigger.details = null;
  expect(validatePB01Plan(JSON.stringify(w), source)).toMatchObject({ reason: "explicit_trigger_details_required" });
});
