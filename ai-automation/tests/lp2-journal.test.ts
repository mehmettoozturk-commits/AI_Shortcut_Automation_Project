import * as fs from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { LP2Journal } from "../src/evaluation/lp2-journal.js";
import { LP2_PILOT_LIMITS, LP2_PLANNED_CALLS, priceOf, sum, validUsage } from "../src/evaluation/lp2-types.js";
import { runLP2Offline } from "../src/evaluation/lp2-offline-runner.js";
import type { LP2Limits, LP2Reservation } from "../src/evaluation/lp2-types.js";

const price = { configurationId: "synthetic-A", modelId: "mock-model-v1", input: 100_000, output: 200_000 };
const limits = { calls: 360, tokens: 2_000_000, microUsd: 5_000_000 };
const usage = { input: 10, output: 20, reasoning: 5, total: 30, reasoningIncludedInOutput: true as const };
const dirs: string[] = [], journals: LP2Journal[] = [];
function directory() { const d = fs.mkdtempSync(join(tmpdir(), "lp2-test-")); dirs.push(d); return d; }
function journal(d = directory(), caps: LP2Limits = limits, fault?: ConstructorParameters<typeof LP2Journal>[3]) {
  const j = new LP2Journal(d, caps, price, fault); journals.push(j); return j;
}
function reservation(id = "run_0", runId = "run", attempt: 0 | 1 = 0): LP2Reservation {
  return { id, runId, attempt, configurationId: price.configurationId, input: 100, output: 100, microUsd: 30 };
}
afterEach(() => {
  vi.restoreAllMocks(); vi.useRealTimers();
  for (const j of journals.splice(0)) j.close();
  for (const d of dirs.splice(0)) fs.rmSync(d, { recursive: true, force: true });
});

describe("LP2 durable offline journal", () => {
  it("uses independent pilot caps, not an authorization to spend", () => {
    expect(LP2_PILOT_LIMITS).toEqual(limits); expect(LP2_PLANNED_CALLS).toBe(340);
  });
  it("settles valid usage, releases unused token/USD reservation but never call count", () => {
    const d = directory(), j = journal(d);
    j.reserve(reservation()); expect(j.totals()).toEqual({ calls: 1, tokens: 200, microUsd: 30 });
    j.dispatch("run_0"); j.settle("run_0", usage);
    expect(j.totals()).toEqual({ calls: 1, tokens: 30, microUsd: 5 }); j.close();
    const next = journal(d); expect(next.isStopped).toBe(false); expect(next.totals()).toEqual(j.totals());
  });
  it.each(["write", "fsync"] as const)("%s reservation fault yields zero synthetic dispatch and retained lock", async operation => {
    const d = directory(), j = journal(d, limits, (op, kind) => { if (op === operation && kind === "reserve") throw Error("fault"); });
    const call = vi.fn();
    await expect(runLP2Offline(j, { mode: "offline/mock", configurationId: price.configurationId, modelId: price.modelId, call }, "run", { input: 100, output: 100 })).rejects.toThrow();
    expect(call).not.toHaveBeenCalled(); expect(j.isStopped).toBe(true); j.close();
    expect(fs.existsSync(join(d, "lp2.lock"))).toBe(true); expect(() => journal(d)).toThrow();
  });
  it.each(["header", "lock"] as const)("directory metadata fsync failure at %s fails initialization", kind => {
    const d = directory(); expect(() => journal(d, limits, (op, k) => {
      if (op === "directory_fsync" && k === kind) throw Error("directory fsync");
    })).toThrow("directory fsync"); expect(fs.existsSync(join(d, "lp2.lock"))).toBe(true);
  });
  it("exclusive second-owner lock rejects and leaves original contents unchanged", () => {
    const d = directory(); journal(d); const before = fs.readFileSync(join(d, "lp2.jsonl"));
    expect(() => journal(d)).toThrow(); expect(fs.readFileSync(join(d, "lp2.jsonl"))).toEqual(before);
  });
  it("does not break stale locks", () => {
    const d = directory(); fs.writeFileSync(join(d, "lp2.lock"), "stale-test-only");
    expect(() => journal(d)).toThrow(); expect(fs.readFileSync(join(d, "lp2.lock"), "utf8")).toBe("stale-test-only");
  });
  it.each(["truncated", "corrupt", "empty", "deleted_row"])("%s journal is never repaired or truncated", mode => {
    const d = directory(), j = journal(d); j.reserve(reservation()); j.close();
    const path = join(d, "lp2.jsonl"), raw = fs.readFileSync(path, "utf8");
    const bad = mode === "truncated" ? raw.slice(0, -2) : mode === "corrupt" ? raw.replace("synthetic-A", "synthetic-X")
      : mode === "empty" ? "" : raw.split("\n").slice(1).join("\n");
    fs.writeFileSync(path, bad); expect(() => journal(d)).toThrow(); expect(fs.readFileSync(path, "utf8")).toBe(bad);
  });
  it.each(["reserved", "dispatching"])("replay after %s interruption keeps full reservation and sends nothing", async state => {
    const d = directory(), j = journal(d); j.reserve(reservation()); if (state === "dispatching") j.dispatch("run_0");
    // Simulates the durable file left after interruption; actual stale-lock process test is separate.
    j.close(); const resumed = journal(d), call = vi.fn();
    expect(resumed.isStopped).toBe(true); expect(resumed.totals()).toEqual({ calls: 1, tokens: 200, microUsd: 30 });
    expect(await runLP2Offline(resumed, { mode: "offline/mock", configurationId: price.configurationId, modelId: price.modelId, call }, "new", { input: 100, output: 100 })).toBe("stopped");
    expect(call).not.toHaveBeenCalled();
  });
  it.each([null, {}, { ...usage, input: -1 }, { ...usage, total: 31 }, { ...usage, reasoning: 21 },
    { ...usage, reasoningIncludedInOutput: false }, { ...usage, input: 0.5 }])("invalid usage %j retains reservation and stops", bad => {
    const d = directory(), j = journal(d); j.reserve(reservation()); j.dispatch("run_0"); j.settle("run_0", bad);
    expect(j.isStopped).toBe(true); expect(j.totals()).toEqual({ calls: 1, tokens: 200, microUsd: 30 });
    j.close(); expect(journal(d).isStopped).toBe(true);
  });
  it("usage above reservation records actual and stops durably", () => {
    const d = directory(), j = journal(d); j.reserve(reservation()); j.dispatch("run_0");
    j.settle("run_0", { ...usage, output: 200, total: 210 });
    expect(j.isStopped).toBe(true); expect(j.totals()).toEqual({ calls: 1, tokens: 210, microUsd: 41 });
    j.close(); const replayed = journal(d); expect(replayed.isStopped).toBe(true); expect(replayed.totals().tokens).toBe(210);
  });
  it.each([{ calls: 0, tokens: 1000, microUsd: 1000 }, { calls: 10, tokens: 199, microUsd: 1000 },
    { calls: 10, tokens: 1000, microUsd: 29 }])("rejects %j caps before dispatch", async cap => {
    const j = journal(directory(), cap), call = vi.fn();
    await expect(runLP2Offline(j, { mode: "offline/mock", configurationId: price.configurationId, modelId: price.modelId, call }, "run", { input: 100, output: 100 })).rejects.toThrow("budget_exhausted");
    expect(call).not.toHaveBeenCalled(); expect(j.totals().calls).toBe(0);
    expect(j.isStopped).toBe(true);
  });
  it("active reservations count toward totals and prohibit concurrent calls", () => {
    const j = journal(); j.reserve(reservation()); expect(() => j.reserve(reservation("other_0", "other"))).toThrow("concurrency_limit");
    expect(() => j.reserve(reservation())).toThrow("duplicate"); j.dispatch("run_0"); expect(() => j.dispatch("run_0")).toThrow("duplicate_dispatch");
  });
  it("exact caps permit first call, then reject next before dispatch and stay stopped on restart", () => {
    const d = directory(), j = journal(d, { calls: 1, tokens: 200, microUsd: 30 });
    j.reserve(reservation()); j.dispatch("run_0"); j.settle("run_0", usage);
    expect(() => j.reserve(reservation("other_0", "other"))).toThrow("budget_exhausted");
    j.close(); expect(journal(d, { calls: 1, tokens: 200, microUsd: 30 }).isStopped).toBe(true);
  });
  it("repair needs settled first usage and cannot happen twice", () => {
    const j = journal(); expect(() => j.reserve(reservation("run_1", "run", 1))).toThrow("invalid_repair");
    j.reserve(reservation()); j.dispatch("run_0"); j.settle("run_0", usage, true);
    j.reserve(reservation("run_1", "run", 1)); j.dispatch("run_1"); j.settle("run_1", usage, true);
    expect(() => j.reserve(reservation("run_2", "run", 1))).toThrow("invalid_repair");
    expect(() => j.reserve(reservation())).toThrow("duplicate");
  });
  it("does not persist arbitrary provider text in invalid usage", () => {
    const d = directory(), j = journal(d); j.reserve(reservation()); j.dispatch("run_0"); j.settle("run_0", { privateText: "DO_NOT_LOG" });
    expect(fs.readFileSync(join(d, "lp2.jsonl"), "utf8")).not.toContain("DO_NOT_LOG");
  });
  it("rejects changed budget/pricing manifest on restart", () => {
    const d = directory(), j = journal(d); j.close(); expect(() => journal(d, { ...limits, calls: 361 })).toThrow("configuration_mismatch");
  });
  it.each([-1, 0.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1])("rejects unsafe numeric value %s", n => {
    expect(() => priceOf(n, 0, price)).toThrow(); expect(validUsage({ ...usage, input: n })).toBe(false);
  });
  it("uses exact big integer intermediates and rejects integer overflow", () => {
    expect(priceOf(1, 0, { ...price, input: 1 })).toBe(1);
    expect(() => sum(Number.MAX_SAFE_INTEGER, 1)).toThrow();
    expect(() => priceOf(Number.MAX_SAFE_INTEGER, 1, { ...price, input: Number.MAX_SAFE_INTEGER })).toThrow("cost_overflow");
  });
});
