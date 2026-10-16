import type { PB03Snapshot } from "./pb03-types.js";

export type PB03Checkpoint = { sequence: number; head: string };
export type PB03Recovery = "consistent" | "bind_new_cache" | "reconcile_settlement_only" | "stop";
/** Pure mock recovery classification. It never returns a dispatch permission or unlock action. */
export function classifyPB03Recovery(snapshot: PB03Snapshot, local?: PB03Checkpoint, staleLock = false): PB03Recovery {
  if (staleLock) return "stop";
  if (snapshot.attempts.some(a => a.state !== "settled")) return "stop";
  if (!local) return snapshot.stopped ? "stop" : "bind_new_cache";
  if (local.sequence === snapshot.sequence && local.head === snapshot.head) return snapshot.stopped ? "stop" : "consistent";
  const anchor = local.sequence === 0 ? snapshot.events[0]?.previous
    : snapshot.events.find(e => e.sequence === local.sequence)?.hash;
  const tail = snapshot.events.filter(e => e.sequence > local.sequence);
  // Only authoritative settlements can fill a cache gap, never a missing reserve or dispatch.
  if (anchor === local.head && tail.length > 0 && tail.every(e => e.operation.kind === "settle")) return "reconcile_settlement_only";
  return "stop";
}
