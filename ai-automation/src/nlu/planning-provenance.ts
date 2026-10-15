import type { PlanningOutcome } from "./types.js";

export type PlanningRoute = "local_template" | "clarification_required" | "ai_required" | "provider_unavailable";
export type ResolutionSource = "unknown" | "local_template" | "rule_based" | "provider" | "deterministic_fallback" | "clarification_answer";
export type ProviderSDK = "anthropic" | "gemini" | "openai_compatible";

export interface ProviderInvocation {
  readonly sdk: ProviderSDK;
  readonly stage: "first" | "repair";
  /** SDK invocation, not a confirmed network delivery or billable operation. */
  readonly result: "pending" | "returned" | "threw";
}

export interface PlanningProvenance {
  readonly requestId: string;
  readonly routingAccess: "free" | "premium" | "unavailable" | null;
  readonly routingChannel: "free" | "premium" | null;
  readonly routingConfigurationId: string | null;
  /** Null means an uninstrumented/custom provider did not identify its route. */
  readonly route: PlanningRoute | null;
  readonly aiRequired: boolean;
  readonly providerUnavailable: boolean;
  readonly resolutionSource: ResolutionSource;
  readonly pipelineAttempts: number;
  readonly providerCallCount: number;
  /** Unknown custom adapters must never turn an observed zero into free usage. */
  readonly callAccounting: "known" | "unknown";
  readonly providerInvocations: readonly ProviderInvocation[];
  readonly outcome: PlanningOutcome["status"] | null;
  readonly cancelled: boolean;
  /** A deterministic rescue after an AI call is not an AI-produced plan. */
  readonly aiPlanProduced: boolean;
}

export type PlanningObserver = (provenance: PlanningProvenance) => void;

/** Created per pipeline entry; passed explicitly, never stored on a provider,
 * conversation, or process-global variable. No user text or raw errors retained.
 */
export class PlanningTrace {
  private readonly requestId = globalThis.crypto.randomUUID();
  private route: PlanningRoute | null = null;
  private aiRequired = false;
  private providerUnavailable = false;
  private source: ResolutionSource = "unknown";
  private attempts = 0;
  private accountingKnown = false;
  private routingAccess: PlanningProvenance["routingAccess"] = null;
  private routingChannel: PlanningProvenance["routingChannel"] = null;
  private routingConfigurationId: string | null = null;
  private calls: Array<{ sdk: ProviderSDK; stage: "first" | "repair"; result: ProviderInvocation["result"] }> = [];

  beginAttempt(): void { this.attempts++; }
  routerSelection(access: "free" | "premium" | "unavailable", configurationId: string | null): void {
    this.routingAccess = access;
    this.routingChannel = access === "unavailable" ? null : access;
    this.routingConfigurationId = configurationId;
  }
  routerBlocked(): void {
    if (this.routingAccess === null) this.routerSelection("unavailable", null);
    this.providerUnavailable = true;
    if (this.calls.length === 0) this.accountingKnown = true;
  }
  localTemplate(): void { this.route = "local_template"; this.source = "local_template"; this.accountingKnown = true; }
  requireAI(): void { this.aiRequired = true; this.route = "ai_required"; }
  ruleBased(): void {
    this.providerUnavailable = true;
    this.route = "provider_unavailable";
    this.source = "rule_based";
    this.accountingKnown = true;
  }
  deterministicFallback(): void { this.source = "deterministic_fallback"; }
  clarificationAnswer(): void {
    this.route = "clarification_required";
    this.source = "clarification_answer";
    this.accountingKnown = true;
  }

  /** Called at the SDK boundary, after prompt construction and before dispatch. */
  async invoke<T>(sdk: ProviderSDK, repair: boolean, call: () => Promise<T>): Promise<T> {
    this.requireAI();
    this.source = "provider";
    this.accountingKnown = true;
    const entry = { sdk, stage: repair ? "repair" as const : "first" as const, result: "pending" as ProviderInvocation["result"] };
    this.calls.push(entry);
    try {
      const result = await call();
      entry.result = "returned";
      return result;
    } catch (error) {
      entry.result = "threw";
      throw error;
    }
  }

  finish(outcome: PlanningOutcome | undefined, signal?: AbortSignal): PlanningProvenance {
    const cancelled = signal?.aborted ?? false;
    let route = this.route;
    let unavailable = this.providerUnavailable;
    if (outcome?.status === "needs_clarification") route = "clarification_required";
    else if (outcome?.status === "provider_error" && !cancelled) {
      route = "provider_unavailable";
      unavailable = true;
    }
    const invocations = Object.freeze(this.calls.map(call => Object.freeze({ ...call })));
    return Object.freeze({
      requestId: this.requestId, routingAccess: this.routingAccess, routingChannel: this.routingChannel,
      routingConfigurationId: this.routingConfigurationId,
      route, aiRequired: this.aiRequired, providerUnavailable: unavailable,
      resolutionSource: this.source, pipelineAttempts: this.attempts,
      providerCallCount: invocations.length, providerInvocations: invocations,
      callAccounting: this.accountingKnown ? "known" : "unknown",
      outcome: outcome?.status ?? null, cancelled,
      aiPlanProduced: invocations.length > 0 && this.source === "provider" && outcome?.status === "plan",
    });
  }
}

/** Instrument known adapters only; an IntentResult alone never proves AI use. */
export function invokeProvider<T>(trace: PlanningTrace | undefined, sdk: ProviderSDK, repair: boolean, call: () => Promise<T>): Promise<T> {
  return trace ? trace.invoke(sdk, repair, call) : call();
}

export function observePlanning(observer: PlanningObserver | undefined, snapshot: PlanningProvenance): void {
  try { observer?.(snapshot); } catch { /* Diagnostics cannot change planning behavior. */ }
}
