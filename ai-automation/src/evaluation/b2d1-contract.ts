import { z } from "zod";
import { priceOf, sum } from "./lp2-types.js";
import type { LP2Price } from "./lp2-types.js";
const counter = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const usageSchema = z.object({ prompt_tokens: counter, completion_tokens: counter, total_tokens: counter,
  completion_tokens_details: z.object({ reasoning_tokens: counter }).strict() }).strict();
/** Selected-field synthetic projection, NOT an SDK response parser or transport. */
const fixtureSchema = z.object({ fixtureVersion: z.literal("groq-chat-synthetic-v1"), configurationId: z.string(),
  reasoningAccounting: z.literal("completion_includes_reasoning"), response: z.object({ object: z.literal("chat.completion"), model: z.string(),
    choices: z.array(z.object({ index: z.literal(0), finish_reason: z.string(), message: z.object({ role: z.literal("assistant"), content: z.string(), refusal: z.null() }).strict() }).strict()).length(1),
    usage: usageSchema }).strict() }).strict();
export function validateB2D1Fixture(value: unknown, profile: Readonly<{ modelId: string; configurationId: string }>) {
  if (!["openai/gpt-oss-20b", "openai/gpt-oss-120b"].includes(profile.modelId) || !/^[a-zA-Z0-9_-]{1,80}$/.test(profile.configurationId)) {
    return { ok: false as const, reason: "unknown_profile" };
  }
  const parsed = fixtureSchema.safeParse(value);
  if (!parsed.success) return { ok: false as const, reason: "unknown_or_invalid_contract" };
  const { response: r } = parsed.data;
  if (r.model !== profile.modelId || parsed.data.configurationId !== profile.configurationId) return { ok: false as const, reason: "model_configuration_mismatch" };
  const choice = r.choices[0]!;
  if (choice.finish_reason !== "stop") return { ok: false as const, reason: "incomplete_or_unknown_finish" };
  if (!choice.message.content || Buffer.byteLength(choice.message.content, "utf8") > 65_536) return { ok: false as const, reason: "invalid_output_size" };
  const u = r.usage;
  try {
    if (u.total_tokens !== sum(u.prompt_tokens, u.completion_tokens) || u.completion_tokens_details.reasoning_tokens > u.completion_tokens) {
      return { ok: false as const, reason: "usage_inconsistent" };
    }
  } catch { return { ok: false as const, reason: "usage_overflow" }; }
  return { ok: true as const, mode: "mock/simulated" as const, realDispatchAllowed: false as const,
    outputJson: choice.message.content, usage: { input: u.prompt_tokens, output: u.completion_tokens, total: u.total_tokens,
      reasoning: u.completion_tokens_details.reasoning_tokens, reasoningIncludedInOutput: true as const } };
}

const componentsSchema = z.object({ system: counter, schema: counter, user: counter, history: counter, repair: counter, chatTemplateOverhead: counter }).strict();
const boundSchema = z.object({ evidence: z.enum(["synthetic-exact", "estimate"]), modelId: z.string().min(1),
  tokenizerRevision: z.string().min(1), components: componentsSchema }).strict();
/** Pure offline arithmetic. No boolean/claim here can authorize real dispatch. */
export function preflightB2D1Budget(bounds: readonly unknown[], maxOutput: number, profile: LP2Price,
  caps: Readonly<{ calls: number; tokens: number; microUsd: number }>) {
  try {
    counter.parse(maxOutput); counter.parse(caps.calls); counter.parse(caps.tokens); counter.parse(caps.microUsd);
    if (!["openai/gpt-oss-20b", "openai/gpt-oss-120b"].includes(profile.modelId)) throw Error("unknown_model");
    if (bounds.length < 1 || bounds.length > 2 || bounds.length > caps.calls) throw Error("call_limit");
    let revision: string | undefined;
    const reservations = bounds.map((value, attempt) => {
      const b = boundSchema.parse(value);
      if (b.evidence !== "synthetic-exact" || b.modelId !== profile.modelId || (attempt === 0 && b.components.repair !== 0)) throw Error("unproven_bound");
      if (revision !== undefined && revision !== b.tokenizerRevision) throw Error("revision_mismatch");
      revision = b.tokenizerRevision;
      const input = sum(...Object.values(b.components));
      return { input, output: maxOutput, microUsd: priceOf(input, maxOutput, profile) };
    });
    const totalTokens = sum(...reservations.map(r => sum(r.input, r.output))), microUsd = sum(...reservations.map(r => r.microUsd));
    if (totalTokens > caps.tokens || microUsd > caps.microUsd) throw Error("budget_exceeded");
    return { offlineEligible: true as const, realDispatchAllowed: false as const, reservations, totalTokens, microUsd };
  } catch { return { offlineEligible: false as const, realDispatchAllowed: false as const, reason: "unproven_or_excessive_bound" }; }
}

/** Conservative, locally documented allowlist. Unknown != proven provider rejection.
 * PASS means passes this static profile, NOT provider acceptance. No schema rewriting. */
export function inspectB2D1Schema(schema: unknown) {
  const findings: string[] = [];
  const keywords = new Set(["$schema", "$defs", "$ref", "type", "properties", "required", "additionalProperties", "items", "enum", "anyOf", "description", "title"]);
  const types = new Set(["object", "array", "string", "number", "integer", "boolean", "null"]);
  const seen = new Set<object>(); let nodes = 0;
  const object = (x: unknown): x is Record<string, unknown> => !!x && typeof x === "object" && !Array.isArray(x);
  const reference = (ref: string) => {
    if (ref === "#") return true;
    if (!ref.startsWith("#/$defs/")) return false;
    let target: unknown = schema;
    for (const key of ref.slice(2).split("/").map(k => k.replace(/~1/g, "/").replace(/~0/g, "~"))) {
      if (!object(target) || !Object.hasOwn(target, key)) return false; target = target[key];
    }
    return object(target);
  };
  function walk(value: unknown, path: string) {
    if (!object(value) || seen.has(value) || ++nodes > 10_000) { findings.push(`${path}:invalid_or_cyclic_schema`); return; }
    seen.add(value);
    for (const k of Object.keys(value)) if (!keywords.has(k)) findings.push(`${path}/${k}:unverified_keyword`);
    if (value.$ref !== undefined && (typeof value.$ref !== "string" || !reference(value.$ref))) findings.push(`${path}:unresolved_or_external_ref`);
    const ts = Array.isArray(value.type) ? value.type : value.type === undefined ? [] : [value.type];
    if (ts.some(t => typeof t !== "string" || !types.has(t)) || new Set(ts).size !== ts.length) findings.push(`${path}:invalid_type`);
    if (!ts.length && value.$ref === undefined && !Array.isArray(value.anyOf)) findings.push(`${path}:unconstrained_schema`);
    if (ts.includes("object")) {
      if (value.additionalProperties !== false) findings.push(`${path}:object_not_closed`);
      if (!object(value.properties)) findings.push(`${path}:properties_missing`);
      else {
        const keys = Object.keys(value.properties), required = value.required;
        if (!Array.isArray(required) || required.some(k => typeof k !== "string") || new Set(required).size !== required.length
          || required.length !== keys.length || keys.some(k => !required.includes(k))) findings.push(`${path}:properties_not_all_required`);
        for (const [k, v] of Object.entries(value.properties)) walk(v, `${path}/properties/${k}`);
      }
    }
    if (ts.includes("array")) walk(value.items, `${path}/items`);
    if (value.enum !== undefined && (!Array.isArray(value.enum) || !value.enum.length || value.enum.some(v => v !== null
      && (!["string", "boolean", "number"].includes(typeof v) || (typeof v === "number" && !Number.isFinite(v)))))) findings.push(`${path}:invalid_enum`);
    if (value.anyOf !== undefined) {
      if (!Array.isArray(value.anyOf) || !value.anyOf.length) findings.push(`${path}:invalid_anyOf`);
      else value.anyOf.forEach((v, i) => walk(v, `${path}/anyOf/${i}`));
    }
    if (value.$defs !== undefined) {
      if (!object(value.$defs)) findings.push(`${path}:invalid_defs`);
      else for (const [k, v] of Object.entries(value.$defs)) walk(v, `${path}/$defs/${k}`);
    }
  }
  if (!object(schema) || schema.type !== "object" || schema.anyOf !== undefined) findings.push("#:root_object_required");
  walk(schema, "#");
  return { staticProfilePassed: findings.length === 0, providerAcceptanceVerified: false as const, findings };
}
