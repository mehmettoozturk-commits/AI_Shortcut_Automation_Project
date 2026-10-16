/** Offline accounting contracts. Never imported by the production provider path. */
export interface LP2Limits { calls: number; tokens: number; microUsd: number }
export const LP2_PILOT_LIMITS: Readonly<LP2Limits> = Object.freeze({ calls: 360, tokens: 2_000_000, microUsd: 5_000_000 });
export const LP2_PLANNED_CALLS = 340;
export interface LP2Price {
  configurationId: string;
  modelId: string;
  /** Integer micro-USD per million billable tokens; synthetic assumptions only. */
  input: number; output: number;
}
export interface LP2Usage { input: number; output: number; reasoning: number; total: number; reasoningIncludedInOutput: true }
export interface LP2Reservation {
  id: string; runId: string; attempt: 0 | 1; configurationId: string;
  input: number; output: number; microUsd: number;
}
export type LP2State = "reserved" | "dispatching" | "settled" | "unknown";
export interface LP2Call { reservation: LP2Reservation; state: LP2State; usage?: LP2Usage; actualMicroUsd?: number; repairNeeded?: boolean }
export function natural(value: number): number {
  if (!Number.isSafeInteger(value) || value < 0) throw new Error("invalid_integer");
  return value;
}
export function sum(...values: number[]): number {
  return natural(values.reduce((a, b) => natural(a + natural(b)), 0));
}
export function priceOf(input: number, output: number, price: LP2Price): number {
  const units = BigInt(natural(input)) * BigInt(natural(price.input)) + BigInt(natural(output)) * BigInt(natural(price.output));
  const cost = (units + 999_999n) / 1_000_000n;
  if (cost > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error("cost_overflow");
  return Number(cost);
}
export function validUsage(value: unknown): value is LP2Usage {
  if (!value || typeof value !== "object") return false;
  const u = value as LP2Usage;
  try {
    for (const n of [u.input, u.output, u.reasoning, u.total]) natural(n);
    return u.reasoningIncludedInOutput === true && u.reasoning <= u.output && u.total === sum(u.input, u.output);
  } catch { return false; }
}
export function label(value: string): void {
  if (typeof value !== "string" || !/^[a-zA-Z0-9_-]{1,80}$/.test(value)) throw new Error("invalid_label");
}
