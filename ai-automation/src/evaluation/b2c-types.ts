import type { LP1Case, LP1Score } from "./lp1-types.js";
export interface B2CUsage {
  inputTokens: number; outputTokens: number; reasoningTokens: number; totalTokens: number;
  reasoningIncludedInOutput: boolean;
}
/** Synthetic v1, NOT a real SDK wire contract. */
export interface B2CResponse { version: "synthetic-v1"; outputJson: string; usage: unknown }
export interface B2CScript {
  readonly mode: "offline/mock"; readonly modelId: string; readonly configurationId: string;
  call(signal: AbortSignal, attempt: 0 | 1): Promise<unknown>;
}
export interface B2CAttempt {
  callId: string; attempt: 0 | 1; preflightValid: boolean | null;
  accountingSettled: boolean; qualityPublished: boolean;
  repairDecision: "none" | "repairable" | "safety_stop";
  /** Provisional diagnostic only; not automatically included in quality rates. */
  provisionalScore: LP1Score | null;
}
export interface B2CRun {
  mode: "mock/simulated"; runId: string; modelLabel: string; test: Pick<LP1Case, "id" | "category" | "split" | "familyId">;
  accountingStatus: "not_attempted" | "settled" | "stopped";
  qualityStatus: "published" | "not_evaluated_accounting_stop" | "safety_stop" | "unavailable_after_restart" | "not_scheduled_yet";
  attempted: boolean; accountingSettled: boolean; qualityPublished: boolean;
  attempts: B2CAttempt[];
}
export interface B2CScheduled { runId: string; modelLabel: string; test: LP1Case }
