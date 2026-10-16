/** Offline protocol only. These counters are synthetic, not verified provider costs. */
import { createHash } from "node:crypto";
import { z } from "zod/v4";

const id = z.string().regex(/^[A-Za-z0-9_-]{1,80}$/);
const n = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
export const PB03AmountSchema = z.object({ calls: n, tokens: n, microUsd: n }).strict();
export type PB03Amount = z.infer<typeof PB03AmountSchema>;
export const PB03ConfigSchema = z.object({ budgetId: id, epoch: id, configurationId: id,
  pricingAssumptionHash: z.string().regex(/^[a-f0-9]{64}$/), limits: PB03AmountSchema }).strict();
export type PB03Config = z.infer<typeof PB03ConfigSchema>;
const base = { operationId: id };
export const PB03OperationSchema = z.discriminatedUnion("kind", [
  z.object({ ...base, kind: z.literal("reserve"), attemptId: id, runId: id,
    attempt: z.union([z.literal(0), z.literal(1)]), configurationId: id, upper: PB03AmountSchema }).strict(),
  z.object({ ...base, kind: z.literal("dispatch"), attemptId: id }).strict(),
  z.object({ ...base, kind: z.literal("settle"), attemptId: id, usage: PB03AmountSchema.nullable(), repairNeeded: z.boolean() }).strict(),
  z.object({ ...base, kind: z.literal("stop"), reason: id }).strict(),
]);
export type PB03Operation = z.infer<typeof PB03OperationSchema>;
export type PB03Attempt = {
  reservation: Extract<PB03Operation, { kind: "reserve" }>;
  state: "reserved" | "dispatching" | "settled" | "unknown";
  usage?: PB03Amount; repairNeeded?: boolean;
};
export type PB03Event = { sequence: number; previous: string; hash: string; operation: PB03Operation };
export type PB03Snapshot = {
  mode: "offline_mock"; realDispatchAllowed: false; physicalDurabilityVerified: false;
  config: PB03Config; sequence: number; head: string; stopped: boolean;
  attempts: PB03Attempt[]; events: PB03Event[]; reserved: PB03Amount; spent: PB03Amount;
  simulatedDispatchGrants: number;
};
export const pb03Zero = (): PB03Amount => ({ calls: 0, tokens: 0, microUsd: 0 });
export function pb03Add(a: PB03Amount, b: PB03Amount): PB03Amount {
  return PB03AmountSchema.parse({ calls: a.calls + b.calls, tokens: a.tokens + b.tokens, microUsd: a.microUsd + b.microUsd });
}
export const pb03Exceeds = (a: PB03Amount, b: PB03Amount): boolean =>
  a.calls > b.calls || a.tokens > b.tokens || a.microUsd > b.microUsd;
/** Order-independent record serialization; no user prompts, secrets, or network payloads accepted. */
export function pb03Canonical(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(pb03Canonical).join(",")}]`;
  if (v !== null && typeof v === "object") return `{${Object.keys(v).sort().map(k => `${JSON.stringify(k)}:${pb03Canonical((v as Record<string, unknown>)[k])}`).join(",")}}`;
  return JSON.stringify(v);
}
export const pb03Hash = (v: unknown): string => createHash("sha256").update(pb03Canonical(v)).digest("hex");
