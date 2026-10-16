import { PB03OperationSchema } from "./pb03-types.js";
import type { PB03Operation, PB03Snapshot } from "./pb03-types.js";
import { PB03MockWitness } from "./pb03-witness.js";
import { classifyPB03Recovery } from "./pb03-recovery.js";
import type { PB03Checkpoint } from "./pb03-recovery.js";

export type PB03LocalCache = { checkpoint?: PB03Checkpoint; staleLock?: boolean };
export type PB03Fault = (point: "after_witness" | "before_local_ack" | "after_local_ack", operation: PB03Operation) => void;
/** Memory-only local fsync/ack simulator. Does not write files or acquire/release OS locks. */
export class PB03OfflineLedger {
  private failed = false;
  readonly realDispatchAllowed = false;
  constructor(private readonly witness: PB03MockWitness, private readonly cache: PB03LocalCache, private readonly fault?: PB03Fault) {
    try {
      const s = witness.snapshot();
      const recovery = classifyPB03Recovery(s, cache.checkpoint, cache.staleLock);
      if (recovery === "stop") { this.failClosed("recovery_stop"); return; }
      this.cache.checkpoint = { sequence: s.sequence, head: s.head };
      // Settlement-only reconstruction is accounting, not permission to resume the old run.
      if (recovery === "reconcile_settlement_only") this.failed = true;
    } catch { this.failClosed("witness_proof_unavailable"); }
  }
  private failClosed(reason: string): void {
    this.failed = true;
    try { this.witness.stop(reason); } catch { /* Local fail-closed is not a claimed global durable STOP. */ }
  }
  get isStopped(): boolean { return this.failed; }
  perform(input: PB03Operation): { duplicate: boolean; simulatedDispatchGranted: boolean; snapshot: PB03Snapshot } {
    if (this.failed) throw new Error("local_fail_closed");
    const op = PB03OperationSchema.parse(input);
    let committed = false;
    try {
      const result = this.witness.transact(this.cache.checkpoint!.sequence, op);
      if (result.duplicate) return { ...result, simulatedDispatchGranted: false };
      committed = true;
      this.fault?.("after_witness", op);
      this.fault?.("before_local_ack", op);
      this.cache.checkpoint = { sequence: result.snapshot.sequence, head: result.snapshot.head };
      this.fault?.("after_local_ack", op);
      const simulatedDispatchGranted = op.kind === "dispatch" && this.witness.grantSimulation(op.operationId, result.snapshot.sequence);
      return { duplicate: false, simulatedDispatchGranted, snapshot: this.witness.snapshot() };
    } catch (error) {
      // A settlement committed at the witness may be reconstructed locally later. Do not add a
      // conflicting STOP event that would obscure its accounting-only reconciliation evidence.
      if (committed && op.kind === "settle") this.failed = true;
      else if (error instanceof Error && error.message === "cas_conflict") this.failed = true;
      else this.failClosed("operation_uncertain");
      throw error;
    }
  }
}
