import { PB03ConfigSchema, PB03OperationSchema, pb03Add, pb03Canonical, pb03Exceeds, pb03Hash, pb03Zero } from "./pb03-types.js";
import type { PB03Config, PB03Operation, PB03Snapshot } from "./pb03-types.js";

/** Pre-provisioned test fixture. Not a durable, networked, or rollback-proof witness implementation. */
export class PB03MockWitness {
  private data: PB03Snapshot;
  private available = true;
  private proofAvailable = true;
  private readonly granted = new Set<string>();
  constructor(config: PB03Config) {
    const c = PB03ConfigSchema.parse(config);
    this.data = { mode: "offline_mock", realDispatchAllowed: false, physicalDurabilityVerified: false,
      config: c, sequence: 0, head: pb03Hash(c), stopped: false, attempts: [], events: [],
      reserved: pb03Zero(), spent: pb03Zero(), simulatedDispatchGrants: 0 };
  }
  /** Fault seams do not claim to detect an unannounced rollback of an actual external service. */
  setAvailableForTest(v: boolean): void { this.available = v; }
  simulateRollbackForTest(old: PB03Snapshot): void {
    this.data = structuredClone(old); this.proofAvailable = false;
  }
  private accessible(): void {
    if (!this.available) throw new Error("witness_unavailable");
    if (!this.proofAvailable) throw new Error("independent_rollback_proof_missing");
  }
  snapshot(): PB03Snapshot { this.accessible(); return structuredClone(this.data); }
  private append(operation: PB03Operation): void {
    const row = { sequence: this.data.sequence + 1, previous: this.data.head, operation };
    const event = { ...row, hash: pb03Hash(row) };
    this.data.events.push(event); this.data.sequence = event.sequence; this.data.head = event.hash;
  }
  /** Terminal latch is accessible without ordinary CAS; it can never clear a previous STOP. */
  stop(reason: string): void {
    this.accessible();
    let suffix = this.data.sequence;
    while (this.data.events.some(e => e.operation.operationId === `stop_${suffix}`)) suffix++;
    const operation = PB03OperationSchema.parse({ kind: "stop", operationId: `stop_${suffix}`, reason });
    if (!this.data.stopped) { this.data.stopped = true; this.append(operation); }
  }
  transact(expected: number, input: PB03Operation): { duplicate: boolean; snapshot: PB03Snapshot } {
    this.accessible();
    const op = PB03OperationSchema.parse(input);
    const previous = this.data.events.find(e => e.operation.operationId === op.operationId);
    if (previous) {
      if (pb03Canonical(previous.operation) !== pb03Canonical(op)) { this.stop("operation_id_conflict"); throw new Error("operation_id_conflict"); }
      return { duplicate: true, snapshot: this.snapshot() };
    }
    if (!Number.isSafeInteger(expected) || expected !== this.data.sequence) throw new Error("cas_conflict");
    if (this.data.stopped) throw new Error("terminal_stop");
    const next = structuredClone(this.data);
    const fail = (reason: string): never => { this.stop(reason); throw new Error(reason); };
    const a = "attemptId" in op ? next.attempts.find(c => c.reservation.attemptId === op.attemptId) : undefined;
    if (op.kind === "reserve") {
      if (a || op.configurationId !== next.config.configurationId || op.upper.calls !== 1) fail("invalid_reservation");
      if (next.attempts.some(c => c.state !== "settled")) fail("unresolved_attempt");
      const prior = next.attempts.filter(c => c.reservation.runId === op.runId);
      if (op.attempt === 0 ? prior.length !== 0 : prior.length !== 1 || prior[0]!.state !== "settled" || !prior[0]!.repairNeeded) fail("invalid_repair");
      let total;
      try { total = pb03Add(pb03Add(next.spent, next.reserved), op.upper); } catch { fail("counter_overflow"); }
      if (pb03Exceeds(total!, next.config.limits)) fail("budget_exhausted");
      next.reserved = pb03Add(next.reserved, op.upper);
      next.attempts.push({ reservation: op, state: "reserved" });
    } else if (op.kind === "dispatch") {
      if (!a || a.state !== "reserved") fail("duplicate_or_invalid_dispatch");
      a!.state = "dispatching";
    } else if (op.kind === "settle") {
      if (!a || a.state !== "dispatching") fail("invalid_settlement");
      if (op.usage === null) { a!.state = "unknown"; next.stopped = true; }
      else {
        if (op.usage.calls !== 1) fail("invalid_usage_calls");
        let spent;
        try { spent = pb03Add(next.spent, op.usage); } catch { fail("counter_overflow"); }
        const upper = a!.reservation.upper;
        next.reserved = { calls: next.reserved.calls - upper.calls, tokens: next.reserved.tokens - upper.tokens,
          microUsd: next.reserved.microUsd - upper.microUsd };
        next.spent = spent!; a!.usage = op.usage; a!.repairNeeded = op.repairNeeded; a!.state = "settled";
        if (pb03Exceeds(op.usage, upper)) next.stopped = true;
      }
    } else next.stopped = true;
    this.data = next; this.append(op);
    return { duplicate: false, snapshot: this.snapshot() };
  }
  /** Only a simulated permission counter; no callback, SDK, transport, or executable permit exists. */
  grantSimulation(operationId: string, expected: number): boolean {
    this.accessible();
    const last = this.data.events.at(-1);
    if (this.data.stopped || expected !== this.data.sequence || last?.operation.kind !== "dispatch"
      || last.operation.operationId !== operationId || this.granted.has(operationId)) return false;
    this.granted.add(operationId); this.data.simulatedDispatchGrants++; return true;
  }
}
