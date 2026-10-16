import { z } from "zod/v4";
import { buildSemanticCatalog, KNOWN_ENTITY_NAMES, LlmPlanOutputSchema, type LlmPlanOutput } from "../nlu/providers/llm-schema.js";
import { parsePB01Json, PB01_FORBIDDEN_KEYS, PB01_LIMITS, type PB01Json } from "./pb01-json.js";

export const PB01_VERSION = "pb01-wire-v1";
type Value = { kind: "string"; value: string } | { kind: "number"; value: number } | { kind: "boolean"; value: boolean }
  | { kind: "null"; value: null } | { kind: "array"; value: Value[] } | { kind: "object"; value: Entry[] };
type Entry = { key: string; value: Value };
const object = (properties: Record<string, unknown>) => ({ type: "object", properties, required: Object.keys(properties), additionalProperties: false });
const array = (items: unknown) => ({ type: "array", items });
const nullable = (schema: unknown) => ({ anyOf: [schema, { type: "null" }] });
const string = { type: "string" };
const reference = (name: string) => ({ $ref: `#/$defs/${name}` });
const catalog = buildSemanticCatalog();
const triggers = catalog.filter(c => c.kind === "trigger").map(c => c.semantic);
const actions = catalog.filter(c => c.kind === "action").map(c => c.semantic);
const intents = LlmPlanOutputSchema.shape.intent.options;
const enumeration = (values: readonly string[]) => ({ type: "string", enum: [...values] });
const entries = array(reference("entry"));
const schema = {
  ...object({ version: { type: "string", enum: [PB01_VERSION] }, intent: enumeration(intents), confidence: nullable({ type: "number" }),
    trigger: nullable(object({ semantic: enumeration(triggers), details: nullable(entries) })),
    steps: array(object({ semantic: enumeration(actions), message: nullable(string), details: nullable(entries) })),
    entities: array(object({ name: enumeration(KNOWN_ENTITY_NAMES), value: string })), missing: array(object({ field: string, reason: string })) }),
  $defs: { entry: object({ key: string, value: reference("value") }), value: { anyOf: [
    ...["string", "number", "boolean", "null"].map(kind => object({ kind: enumeration([kind]), value: { type: kind } })),
    object({ kind: enumeration(["array"]), value: array(reference("value")) }), object({ kind: enumeration(["object"]), value: entries }),
  ] } },
};
/** Caller gets a copy. Static strict profile only, never a provider acceptance claim. */
export const pb01WireSchema = () => JSON.parse(JSON.stringify(schema)) as typeof schema;
const valueSchema: z.ZodType<Value> = z.lazy(() => z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("string"), value: z.string() }).strict(),
  z.object({ kind: z.literal("number"), value: z.number() }).strict(),
  z.object({ kind: z.literal("boolean"), value: z.boolean() }).strict(),
  z.object({ kind: z.literal("null"), value: z.null() }).strict(),
  z.object({ kind: z.literal("array"), value: z.array(valueSchema) }).strict(),
  z.object({ kind: z.literal("object"), value: z.array(z.object({ key: z.string(), value: valueSchema }).strict()) }).strict(),
]));
const entrySchema = z.object({ key: z.string(), value: valueSchema }).strict();
const detailsSchema = z.array(entrySchema).nullable();
const wireSchema = z.object({ version: z.literal(PB01_VERSION), intent: z.enum(intents), confidence: z.number().min(0).max(1).nullable(),
  trigger: z.object({ semantic: z.enum(triggers as [string, ...string[]]), details: detailsSchema }).strict().nullable(),
  steps: z.array(z.object({ semantic: z.enum(actions as [string, ...string[]]), message: z.string().nullable(), details: detailsSchema }).strict()),
  entities: z.array(z.object({ name: z.enum(KNOWN_ENTITY_NAMES), value: z.string() }).strict()),
  missing: z.array(z.object({ field: z.string(), reason: z.string() }).strict()),
}).strict();
const semanticSchema = LlmPlanOutputSchema.strict().extend({
  trigger: LlmPlanOutputSchema.shape.trigger.unwrap().strict().nullable(),
  steps: z.array(LlmPlanOutputSchema.shape.steps.element.strict()),
  entities: z.array(LlmPlanOutputSchema.shape.entities.element.strict()), missing: z.array(LlmPlanOutputSchema.shape.missing.element.strict()),
});
const reject = (code: string): never => { throw new Error(code); };
function countDetails() {
  let nodes = 0;
  return (depth: number) => { if (depth > PB01_LIMITS.detailDepth || ++nodes > PB01_LIMITS.detailNodes) reject("details_structure_limit"); };
}
function decodeEntries(entries: Entry[], depth: number, count: ReturnType<typeof countDetails>): Record<string, unknown> {
  count(depth); const out: Record<string, unknown> = Object.create(null), keys = new Set<string>();
  for (const entry of entries) {
    if (PB01_FORBIDDEN_KEYS.has(entry.key) || keys.has(entry.key)) reject("details_duplicate_or_forbidden_key");
    keys.add(entry.key); out[entry.key] = decodeValue(entry.value, depth + 1, count);
  }
  return out;
}
function decodeValue(value: Value, depth: number, count: ReturnType<typeof countDetails>): unknown {
  count(depth);
  if (value.kind === "object") return decodeEntries(value.value, depth, count);
  if (value.kind === "array") return value.value.map(v => decodeValue(v, depth + 1, count));
  return value.value;
}
function checkEntities(out: LlmPlanOutput): void {
  const names = new Set<string>();
  for (const entity of out.entities) {
    if (!(KNOWN_ENTITY_NAMES as readonly string[]).includes(entity.name) || names.has(entity.name)) reject("entity_unknown_or_duplicate");
    names.add(entity.name);
    if (entity.name === "condition" && !["above", "below", "equals"].includes(entity.value)) reject("entity_condition_invalid");
    if (entity.name === "batteryLevel" && (!/^\d{1,3}$/.test(entity.value) || Number(entity.value) > 100)) reject("entity_battery_invalid");
  }
  const missing = new Set<string>();
  for (const field of out.missing) {
    if (missing.has(field.field) || PB01_FORBIDDEN_KEYS.has(field.field)) reject("missing_duplicate_or_forbidden"); missing.add(field.field);
  }
}
/** Lossless at the documented wire→semantic boundary. Null optional details and
 * confidence denote absence; null INSIDE typed details remains JSON null. */
export function decodePB01Wire(text: string): { version: typeof PB01_VERSION; semantic: LlmPlanOutput } {
  const raw = parsePB01Json(text), parsed = wireSchema.safeParse(raw);
  if (!parsed.success) reject("wire_schema_invalid");
  const w = parsed.data!, count = countDetails();
  const details = (e: Entry[] | null) => e === null ? {} : { details: decodeEntries(e, 0, count) };
  const candidate = { intent: w.intent, ...(w.confidence === null ? {} : { confidence: w.confidence }),
    trigger: w.trigger === null ? null : { semantic: w.trigger.semantic, ...details(w.trigger.details) },
    steps: w.steps.map(s => ({ semantic: s.semantic, message: s.message, ...details(s.details) })), entities: w.entities, missing: w.missing };
  const semantic = semanticSchema.parse(candidate); checkEntities(semantic);
  return { version: PB01_VERSION, semantic };
}
function encodeValue(value: unknown): Value {
  if (value === null) return { kind: "null", value: null };
  if (typeof value === "string") return { kind: "string", value };
  if (typeof value === "number") return { kind: "number", value };
  if (typeof value === "boolean") return { kind: "boolean", value };
  if (Array.isArray(value)) return { kind: "array", value: value.map(encodeValue) };
  if (value && typeof value === "object") return { kind: "object", value: encodeEntries(value as Record<string, unknown>) };
  return reject("semantic_value_not_representable");
}
function encodeEntries(value: Record<string, unknown>): Entry[] {
  return Object.entries(value).map(([key, v]) => ({ key, value: encodeValue(v) }));
}
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.keys(value).sort().map(k => `${JSON.stringify(k)}:${canonical((value as Record<string, unknown>)[k])}`).join(",")}}`;
  return JSON.stringify(value);
}
/** Takes semantic JSON text, not arbitrary callback/getter objects. Rejects any
 * source representation the strict wire cannot preserve (e.g. absent message). */
export function encodePB01Semantic(text: string): string {
  const input: PB01Json = parsePB01Json(text), semantic = semanticSchema.parse(input); checkEntities(semantic);
  const details = (d: Record<string, unknown> | undefined) => d === undefined ? null : encodeEntries(d);
  const wire = { version: PB01_VERSION, intent: semantic.intent, confidence: semantic.confidence ?? null,
    trigger: semantic.trigger === null ? null : { semantic: semantic.trigger.semantic, details: details(semantic.trigger.details) },
    steps: semantic.steps.map(s => { if (s.message === undefined) reject("semantic_message_absence_not_representable");
      return { semantic: s.semantic, message: s.message, details: details(s.details) }; }), entities: semantic.entities, missing: semantic.missing };
  const encoded = JSON.stringify(wire), decoded = decodePB01Wire(encoded);
  if (canonical(input) !== canonical(decoded.semantic)) reject("semantic_not_losslessly_representable");
  return encoded;
}
