import { describe, expect, it, vi } from "vitest";
import { PB03MockWitness } from "../src/evaluation/pb03-witness.js";
import { PB03OfflineLedger } from "../src/evaluation/pb03-ledger.js";
import type { PB03LocalCache } from "../src/evaluation/pb03-ledger.js";
import { classifyPB03Recovery } from "../src/evaluation/pb03-recovery.js";
import type { PB03Operation } from "../src/evaluation/pb03-types.js";

const config = { budgetId: "fixture", epoch: "epoch1", configurationId: "synthetic_model_price",
  pricingAssumptionHash: "a".repeat(64), limits: { calls: 3, tokens: 300, microUsd: 300 } };
const reserve = (id = "a", runId = id, attempt: 0 | 1 = 0): PB03Operation => ({ kind: "reserve", operationId: `r_${id}`,
  attemptId: id, runId, attempt, configurationId: config.configurationId, upper: { calls: 1, tokens: 100, microUsd: 100 } });
const dispatch = (id = "a"): PB03Operation => ({ kind: "dispatch", operationId: `d_${id}`, attemptId: id });
const settle = (id = "a", repairNeeded = false): PB03Operation => ({ kind: "settle", operationId: `s_${id}`, attemptId: id,
  usage: { calls: 1, tokens: 80, microUsd: 80 }, repairNeeded });
function fixture() {
  const w = new PB03MockWitness(config); const cache: PB03LocalCache = {};
  return { w, cache, l: new PB03OfflineLedger(w, cache) };
}
function completed(l: PB03OfflineLedger, id: string, repair = false) {
  l.perform(reserve(id)); expect(l.perform(dispatch(id)).simulatedDispatchGranted).toBe(true); l.perform(settle(id, repair));
}

describe("PB-03 offline global accounting", () => {
  it("two runs and a fresh cache share spent counters; deleting cache never resets budget", () => {
    const { w, l } = fixture(); completed(l, "a");
    const next = new PB03OfflineLedger(w, {}); completed(next, "b"); completed(next, "c");
    expect(w.snapshot().spent).toEqual({ calls: 3, tokens: 240, microUsd: 240 });
    expect(() => new PB03OfflineLedger(w, {}).perform(reserve("d"))).toThrow("budget_exhausted");
    expect(w.snapshot().simulatedDispatchGrants).toBe(3);
  });
  it("simultaneous reserve CAS has one winner and one charged reservation", async () => {
    const w = new PB03MockWitness(config);
    const r = await Promise.allSettled([Promise.resolve().then(() => w.transact(0, reserve("a"))),
      Promise.resolve().then(() => w.transact(0, reserve("b")))]);
    expect(r.filter(x => x.status === "fulfilled")).toHaveLength(1);
    expect(w.snapshot().reserved.calls).toBe(1); expect(w.snapshot().simulatedDispatchGrants).toBe(0);
  });
  it("reserve retry is idempotent even with stale CAS, and snapshots are detached", () => {
    const { w, l } = fixture(); l.perform(reserve()); const s = w.snapshot(); s.reserved.calls = 999;
    expect(l.perform(reserve()).duplicate).toBe(true); expect(w.snapshot().reserved.calls).toBe(1);
    expect(w.snapshot().simulatedDispatchGrants).toBe(0);
  });
  it.each(["reserve", "dispatch", "settle"])("same %s ID with changed content triggers terminal STOP", kind => {
    const { w, l } = fixture(); l.perform(reserve()); if (kind !== "reserve") l.perform(dispatch()); if (kind === "settle") l.perform(settle());
    const op = kind === "reserve" ? { ...reserve(), runId: "changed" } : kind === "dispatch" ? { ...dispatch(), attemptId: "changed" }
      : { ...settle(), repairNeeded: true };
    expect(() => l.perform(op as PB03Operation)).toThrow("operation_id_conflict");
    expect(w.snapshot().stopped).toBe(true); expect(w.snapshot().simulatedDispatchGrants).toBe(kind === "reserve" ? 0 : 1);
  });
  it("dispatch duplicate grants no second simulated permission", () => {
    const { w, l } = fixture(); l.perform(reserve()); expect(l.perform(dispatch()).simulatedDispatchGranted).toBe(true);
    expect(l.perform(dispatch()).simulatedDispatchGranted).toBe(false); expect(w.snapshot().simulatedDispatchGrants).toBe(1);
  });
  it("new dispatch ID for same attempt stops instead of granting twice", () => {
    const { w, l } = fixture(); l.perform(reserve()); l.perform(dispatch());
    expect(() => l.perform({ ...dispatch(), operationId: "another" })).toThrow(); expect(w.snapshot().simulatedDispatchGrants).toBe(1);
  });
  it("settlement retry changes neither spent nor grant totals", () => {
    const { w, l } = fixture(); completed(l, "a"); const s = w.snapshot();
    expect(l.perform(settle()).duplicate).toBe(true); expect(w.snapshot()).toEqual(s);
  });
  it("unknown usage preserves the full reservation and stops all future runs", () => {
    const { w, l } = fixture(); l.perform(reserve()); l.perform(dispatch());
    l.perform({ kind: "settle", operationId: "s_a", attemptId: "a", usage: null, repairNeeded: false });
    expect(w.snapshot().reserved).toEqual({ calls: 1, tokens: 100, microUsd: 100 });
    expect(w.snapshot().attempts[0]!.state).toBe("unknown"); expect(new PB03OfflineLedger(w, {}).isStopped).toBe(true);
    expect(w.snapshot().simulatedDispatchGrants).toBe(1);
  });
  it("actual overrun is recorded without clamping and triggers STOP", () => {
    const { w, l } = fixture(); l.perform(reserve()); l.perform(dispatch());
    l.perform({ ...settle(), usage: { calls: 1, tokens: 150, microUsd: 150 } } as PB03Operation);
    expect(w.snapshot().spent.tokens).toBe(150); expect(w.snapshot().reserved.calls).toBe(0);
    expect(w.snapshot().stopped).toBe(true); expect(w.snapshot().simulatedDispatchGrants).toBe(1);
  });
  it.each(["after_witness", "before_local_ack", "after_local_ack"] as const)("reserve crash at %s preserves orphan and zero grants", point => {
    const w = new PB03MockWitness(config); const cache = {};
    const l = new PB03OfflineLedger(w, cache, p => { if (p === point) throw Error("crash"); });
    expect(() => l.perform(reserve())).toThrow("crash");
    expect(w.snapshot().reserved.calls).toBe(1); expect(w.snapshot().stopped).toBe(true);
    expect(new PB03OfflineLedger(w, {}).isStopped).toBe(true); expect(w.snapshot().simulatedDispatchGrants).toBe(0);
  });
  it.each(["after_witness", "before_local_ack", "after_local_ack"] as const)("dispatch crash at %s never grants or resends", point => {
    const { w, cache, l } = fixture(); l.perform(reserve());
    // A second live handle models the same owner's crash seam, not a new recovered run.
    const crashed = new PB03OfflineLedger(w, {});
    expect(crashed.isStopped).toBe(true); // Recovery of pending reserve must already STOP.
    expect(w.snapshot().simulatedDispatchGrants).toBe(0);
    const w2 = new PB03MockWitness(config); const c2: PB03LocalCache = {};
    const l2 = new PB03OfflineLedger(w2, c2, (p, op) => { if (op.kind === "dispatch" && p === point) throw Error("crash"); });
    l2.perform(reserve()); expect(() => l2.perform(dispatch())).toThrow("crash");
    expect(w2.snapshot().attempts[0]!.state).toBe("dispatching"); expect(w2.snapshot().simulatedDispatchGrants).toBe(0);
    expect(new PB03OfflineLedger(w2, c2).isStopped).toBe(true);
    expect(() => l2.perform(dispatch())).toThrow(); expect(w2.snapshot().simulatedDispatchGrants).toBe(0);
  });
  it("crash after an acknowledged simulated dispatch grants no resend", () => {
    const { w, cache, l } = fixture(); l.perform(reserve()); l.perform(dispatch());
    const recovered = new PB03OfflineLedger(w, cache); expect(recovered.isStopped).toBe(true);
    expect(() => recovered.perform(dispatch())).toThrow(); expect(w.snapshot().simulatedDispatchGrants).toBe(1);
  });
  it.each(["after_witness", "before_local_ack"] as const)("settlement crash at %s reconciles accounting only", point => {
    const w = new PB03MockWitness(config); const cache: PB03LocalCache = {};
    const l = new PB03OfflineLedger(w, cache, (p, op) => { if (op.kind === "settle" && p === point) throw Error("crash"); });
    l.perform(reserve()); l.perform(dispatch()); expect(() => l.perform(settle())).toThrow("crash");
    expect(classifyPB03Recovery(w.snapshot(), cache.checkpoint)).toBe("reconcile_settlement_only");
    const recovered = new PB03OfflineLedger(w, cache); expect(recovered.isStopped).toBe(true);
    expect(cache.checkpoint!.head).toBe(w.snapshot().head); expect(w.snapshot().spent.tokens).toBe(80);
    expect(() => recovered.perform(dispatch())).toThrow(); expect(w.snapshot().simulatedDispatchGrants).toBe(1);
  });
  it("complete local settlement survives reopen, but old-run initial reservation cannot repeat", () => {
    const { w, l, cache } = fixture(); completed(l, "a"); const next = new PB03OfflineLedger(w, cache);
    expect(next.isStopped).toBe(false); expect(next.perform(settle()).duplicate).toBe(true);
    expect(() => next.perform(reserve("b", "a"))).toThrow("invalid_repair"); expect(w.snapshot().simulatedDispatchGrants).toBe(1);
  });
  it("repair uses the same configuration and is limited to one", () => {
    const { w, l } = fixture(); completed(l, "a", true);
    l.perform(reserve("repair", "a", 1)); l.perform(dispatch("repair")); l.perform(settle("repair", true));
    expect(() => l.perform(reserve("repair2", "a", 1))).toThrow("invalid_repair"); expect(w.snapshot().simulatedDispatchGrants).toBe(2);
  });
  it("configuration mismatch fails closed before dispatch", () => {
    const { w, l } = fixture(); expect(() => l.perform({ ...reserve(), configurationId: "other" } as PB03Operation)).toThrow();
    expect(w.snapshot().simulatedDispatchGrants).toBe(0);
  });
  it("witness unavailable is local fail-closed, not a claimed global STOP", () => {
    const { w, l } = fixture(); w.setAvailableForTest(false); expect(() => l.perform(reserve())).toThrow();
    expect(l.isStopped).toBe(true); w.setAvailableForTest(true);
    expect(w.snapshot().stopped).toBe(false); expect(w.snapshot().simulatedDispatchGrants).toBe(0);
    expect(() => l.perform(reserve())).toThrow();
  });
  it("unavailable before dispatch never grants permission; reconnect does not revive same handle", () => {
    const { w, l } = fixture(); l.perform(reserve()); w.setAvailableForTest(false);
    expect(() => l.perform(dispatch())).toThrow(); w.setAvailableForTest(true);
    expect(w.snapshot().reserved.calls).toBe(1); expect(() => l.perform(dispatch())).toThrow(); expect(w.snapshot().simulatedDispatchGrants).toBe(0);
  });
  it("local old backup is STOP, not a silent counter reset", () => {
    const { w, cache, l } = fixture(); const old = structuredClone(cache); completed(l, "a");
    expect(new PB03OfflineLedger(w, old).isStopped).toBe(true); expect(w.snapshot().spent.calls).toBe(1);
    expect(w.snapshot().simulatedDispatchGrants).toBe(1);
  });
  it("witness rollback with missing independent proof refuses safe continuation", () => {
    const { w, l } = fixture(); const old = w.snapshot(); completed(l, "a"); w.simulateRollbackForTest(old);
    expect(new PB03OfflineLedger(w, {}).isStopped).toBe(true); expect(() => w.snapshot()).toThrow("independent_rollback_proof_missing");
    expect(() => w.grantSimulation("d_a", 0)).toThrow();
  });
  it("stale lock is not auto-unlocked or deleted", () => {
    const { w } = fixture(); const cache = { staleLock: true }; expect(new PB03OfflineLedger(w, cache).isStopped).toBe(true);
    expect(cache.staleLock).toBe(true); expect(w.snapshot().simulatedDispatchGrants).toBe(0);
  });
  it("terminal STOP rejects new reserve and dispatch", () => {
    const { w, l } = fixture(); w.stop("operator_stop"); expect(() => l.perform(reserve())).toThrow();
    expect(() => w.transact(w.snapshot().sequence, dispatch())).toThrow(); expect(w.snapshot().simulatedDispatchGrants).toBe(0);
  });
  it.each(["tokens", "microUsd"] as const)("global %s ceiling is enforced independently of call count", dimension => {
    const w = new PB03MockWitness({ ...config, limits: { ...config.limits, [dimension]: 150 } });
    const l = new PB03OfflineLedger(w, {}); completed(l, "a");
    expect(() => l.perform(reserve("b"))).toThrow("budget_exhausted");
    expect(w.snapshot().spent[dimension]).toBe(80); expect(w.snapshot().simulatedDispatchGrants).toBe(1);
  });
  it("internal STOP operation identity never collides with a supplied operation identity", () => {
    const { w, l } = fixture(); l.perform({ ...reserve(), operationId: "stop_1" }); w.stop("operator_stop");
    const ids = w.snapshot().events.map(e => e.operation.operationId);
    expect(new Set(ids).size).toBe(ids.length); expect(w.snapshot().simulatedDispatchGrants).toBe(0);
  });
  it("cache copied from a different epoch is rejected", () => {
    const { cache } = fixture(); const w = new PB03MockWitness({ ...config, epoch: "epoch2" });
    expect(new PB03OfflineLedger(w, cache).isStopped).toBe(true); expect(w.snapshot().simulatedDispatchGrants).toBe(0);
  });
  it("cache with changed price-assumption hash is rejected", () => {
    const { cache } = fixture(); const w = new PB03MockWitness({ ...config, pricingAssumptionHash: "b".repeat(64) });
    expect(new PB03OfflineLedger(w, cache).isStopped).toBe(true); expect(w.snapshot().simulatedDispatchGrants).toBe(0);
  });
  it("simulated permission cannot be consumed twice even without a ledger retry", () => {
    const { w, l } = fixture(); l.perform(reserve()); const r = l.perform(dispatch());
    expect(w.grantSimulation("d_a", r.snapshot.sequence)).toBe(false); expect(w.snapshot().simulatedDispatchGrants).toBe(1);
  });
  it("stale CAS cannot grant a dispatch permission", () => {
    const { w, l } = fixture(); l.perform(reserve());
    expect(() => w.transact(0, dispatch())).toThrow("cas_conflict"); expect(w.snapshot().simulatedDispatchGrants).toBe(0);
  });
  it("settlement duplicate remains idempotent after a terminal stop", () => {
    const { w, l } = fixture(); completed(l, "a"); w.stop("operator_stop"); const before = w.snapshot();
    expect(w.transact(0, settle()).duplicate).toBe(true); expect(w.snapshot()).toEqual(before);
    expect(w.snapshot().simulatedDispatchGrants).toBe(1);
  });
  it.each([NaN, Infinity, -1, 0.5, Number.MAX_SAFE_INTEGER + 1])("invalid synthetic counters (%s) cannot grant", n => {
    const { w, l } = fixture(); expect(() => l.perform({ ...reserve(), upper: { calls: 1, tokens: n, microUsd: 1 } } as PB03Operation)).toThrow();
    expect(w.snapshot().simulatedDispatchGrants).toBe(0);
  });
  it("fresh journals cannot bypass an old unknown reservation", () => {
    const { w, l } = fixture(); l.perform(reserve()); l.perform(dispatch());
    l.perform({ kind: "settle", operationId: "u_a", attemptId: "a", usage: null, repairNeeded: false });
    for (let i = 0; i < 5; i++) expect(new PB03OfflineLedger(w, {}).isStopped).toBe(true);
    expect(w.snapshot().reserved.calls).toBe(1); expect(w.snapshot().simulatedDispatchGrants).toBe(1);
  });
  it("offline flags stay false and no fetch is invoked", () => {
    const fetch = vi.spyOn(globalThis, "fetch"); try {
      const { w, l } = fixture(); completed(l, "a"); expect(fetch).not.toHaveBeenCalled();
      expect(l.realDispatchAllowed).toBe(false); expect(w.snapshot().realDispatchAllowed).toBe(false);
      expect(w.snapshot().physicalDurabilityVerified).toBe(false); expect(w.snapshot().simulatedDispatchGrants).toBe(1);
    } finally { fetch.mockRestore(); }
  });
});
