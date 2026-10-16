import { createHash } from "node:crypto";
import { QuotaLedgerError, type QuotaIdentity, type QuotaRequest, type SqliteQuotaLedger } from "./sqlite-ledger.js";

export interface DispatchAffinity { readonly providerId: string; readonly model: string; readonly configurationId: string }
export interface BudgetReservation {
  /** Only an acknowledged durable authorization permits a callback. No refund API. */
  authorize(signal?: AbortSignal): Promise<"authorized" | "unavailable" | "unknown">;
}
/** Trusted server dependency, NOT hydrated from request JSON or PB-03 mock data.
 * Interface conformance does not prove durability, pricing bounds or production readiness.
 * Reservations remain charged/held until independent usage reconciliation.
 */
export interface AuthoritativeBudgetGuard {
  reserve(input: Readonly<{ identity: QuotaIdentity; operationId: string; semanticHash: string; stage: "initial" | "repair";
    affinity: DispatchAffinity; maxOutputTokens: number }>, signal?: AbortSignal): Promise<BudgetReservation | null>;
}
export type GuardRejection = Readonly<{ status: 400 | 401 | 409 | 429 | 503; code: string; state?: string }>;
class DispatchDenied extends Error { constructor() { super("AI dispatch not authorized"); } }
/** Includes validated execution input AND raw input (unknown schema-stripped
 * metadata is conservatively bound, never silently omitted). Arrays retain order.
 * NFC only; do not erase negation, numbers or user message whitespace.
 */
export function canonicalRequestHash(value: unknown): string {
  let nodes = 0;
  function encode(v: unknown, depth: number): string {
    if (++nodes > 8192 || depth > 64) throw new DispatchDenied();
    if (v === null || typeof v === "boolean" || typeof v === "number") return JSON.stringify(v);
    if (typeof v === "string") return JSON.stringify(v.normalize("NFC"));
    if (Array.isArray(v)) return "[" + v.map(x => encode(x, depth + 1)).join(",") + "]";
    if (v && typeof v === "object") return "{" + Object.keys(v).sort().filter(k => (v as Record<string,unknown>)[k] !== undefined)
      .map(k => JSON.stringify(k) + ":" + encode((v as Record<string,unknown>)[k], depth + 1)).join(",") + "}";
    throw new DispatchDenied();
  }
  return createHash("sha256").update(encode({ version: 1, input: value }, 0)).digest("hex");
}
export class RequestDispatchGuard {
  private state: "new" | "initial_pending" | "initial_returned" | "repair_pending" | "repair_returned" | "closed" = "new";
  private affinity: string | undefined;
  private request: QuotaRequest | undefined;
  private authorized = false;
  private denied: GuardRejection | null = null;
  constructor(private readonly options: {
    ledger?: SqliteQuotaLedger; budget?: AuthoritativeBudgetGuard;
    identity: () => QuotaIdentity | null;
    operationId: string | null; input: unknown; signal?: AbortSignal;
    budgetTimeoutMs?: number;
  }) {}
  rejection(): GuardRejection | null { return this.denied; }
  block(status: GuardRejection["status"], code: string, state?: string): never {
    this.denied ??= Object.freeze({ status, code, ...(state ? { state } : {}) }); this.state = "closed";
    throw new DispatchDenied();
  }
  private identity(): QuotaIdentity {
    try { const id = this.options.identity(); if (!id) return this.block(401, "identity_required"); return id; }
    catch (error) { if (error instanceof DispatchDenied) throw error; return this.block(503, "identity_unavailable"); }
  }
  private check(): void {
    if (this.denied) throw new DispatchDenied();
    if (this.options.signal?.aborted) this.block(503, "request_cancelled");
    const identity = this.identity();
    if (this.request && (identity.kind !== this.request.identity.kind || identity.subject !== this.request.identity.subject)) this.block(401, "identity_changed");
  }
  private async bounded<T>(work: Promise<T>): Promise<T> {
    const signal = this.options.signal;
    const timeout = Math.min(5000, Math.max(1, this.options.budgetTimeoutMs ?? 2000));
    let timer: ReturnType<typeof setTimeout> | undefined;
    let abort: (() => void) | undefined;
    try {
      return await new Promise<T>((resolve, reject) => {
        abort = () => reject(new DispatchDenied());
        if (signal?.aborted) { abort(); return; }
        signal?.addEventListener("abort", abort, { once: true }); timer = setTimeout(abort, timeout);
        work.then(resolve, reject);
      });
    } finally { clearTimeout(timer); if (abort) signal?.removeEventListener("abort", abort); }
  }
  async invoke<T>(affinity: DispatchAffinity, repair: boolean, maxOutputTokens: number, call: () => Promise<T>): Promise<T> {
    const stage = repair ? "repair" : "initial";
    if (this.state !== (repair ? "initial_returned" : "new")) this.block(409, "dispatch_capability_used");
    this.state = repair ? "repair_pending" : "initial_pending"; // Before the first await.
    try {
      this.check();
      if (!this.options.ledger || !this.options.budget) this.block(503, "dispatch_authority_unavailable");
      const binding = JSON.stringify([affinity.providerId, affinity.model, affinity.configurationId]);
      if (this.affinity && this.affinity !== binding) this.block(503, "provider_affinity_changed");
      this.affinity = binding;
      if (!repair) {
        if (!this.options.operationId || !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(this.options.operationId)) this.block(400, "operation_id_required");
        let semanticHash: string;
        try { semanticHash = canonicalRequestHash(this.options.input); } catch { return this.block(400, "canonical_request_invalid"); }
        this.request = Object.freeze({ identity: Object.freeze({ ...this.identity() }), operationId: this.options.operationId, semanticHash });
        const result = this.options.ledger.reserve(this.request);
        if (!result.created) this.block(409, "operation_already_exists", result.operation.state);
      }
      const permit = await this.bounded(this.options.budget.reserve(Object.freeze({ ...this.request!, stage,
        affinity: Object.freeze({ ...affinity }), maxOutputTokens }), this.options.signal));
      if (!permit) this.block(503, "budget_unavailable");
      this.check();
      if (!repair) {
        if (!this.options.ledger.authorizeDispatch(this.request!).granted) this.block(409, "dispatch_capability_used");
        this.authorized = true;
      }
      if (await this.bounded(permit.authorize(this.options.signal)) !== "authorized") this.block(503, "budget_authorization_uncertain");
      this.check(); // No await between the final identity/abort check and callback.
      const result = await call();
      this.state = repair ? "repair_returned" : "initial_returned";
      return result;
    } catch (error) {
      if (!this.denied) {
        if (error instanceof QuotaLedgerError && error.code === "limit") this.denied = { status: 429, code: "daily_quota_exhausted" };
        else if (error instanceof QuotaLedgerError && error.code === "conflict") this.denied = { status: 409, code: "operation_conflict" };
        else this.denied = { status: 503, code: "dispatch_unavailable" };
      }
      this.state = "closed";
      if (this.authorized && this.request) {
        try { this.options.ledger!.settle(this.request, "OUTCOME_UNKNOWN"); } catch { /* Remains consumed; no retry/refund. */ }
      }
      throw new DispatchDenied();
    }
  }
  finish(success: boolean): void {
    if (!this.authorized || !this.request || this.denied) return;
    try { this.options.ledger!.settle(this.request, success ? "COMPLETED" : "FAILED_AFTER_DISPATCH"); this.state = "closed"; }
    catch { this.block(503, "quota_settlement_unavailable"); }
  }
}
