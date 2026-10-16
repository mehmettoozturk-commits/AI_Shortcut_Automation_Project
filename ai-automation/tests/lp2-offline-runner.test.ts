import * as fs from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { afterEach, expect, it, vi } from "vitest";
import { LP2Journal } from "../src/evaluation/lp2-journal.js";
import { runLP2Offline } from "../src/evaluation/lp2-offline-runner.js";
import type { LP2SyntheticProvider } from "../src/evaluation/lp2-offline-runner.js";

const price = { configurationId: "synthetic-A", modelId: "mock-model-v1", input: 100_000, output: 200_000 };
const limits = { calls: 360, tokens: 2_000_000, microUsd: 5_000_000 };
const usage = { input: 10, output: 20, reasoning: 5, total: 30, reasoningIncludedInOutput: true as const };
const maxima = { input: 100, output: 100 };
const dirs: string[] = [], journals: LP2Journal[] = [];
function directory() { const d = fs.mkdtempSync(join(tmpdir(), "lp2-runner-")); dirs.push(d); return d; }
function setup(call: LP2SyntheticProvider["call"]) {
  const d = directory(), j = new LP2Journal(d, limits, price); journals.push(j);
  return { d, j, p: { mode: "offline/mock" as const, configurationId: price.configurationId, modelId: price.modelId, call: vi.fn(call) } };
}
afterEach(() => {
  vi.restoreAllMocks(); vi.useRealTimers(); vi.unstubAllGlobals();
  for (const j of journals.splice(0)) j.close();
  for (const d of dirs.splice(0)) fs.rmSync(d, { recursive: true, force: true });
});

it("dispatch observes reservation AND dispatch marker already written/fsynced", async () => {
  const { d, j, p } = setup(async () => {
    const rows = fs.readFileSync(join(d, "lp2.jsonl"), "utf8").trim().split("\n").map(s => JSON.parse(s).event.kind);
    expect(rows).toEqual(["header", "reserve", "dispatch"]); return { usage, repairNeeded: false };
  });
  expect(await runLP2Offline(j, p, "run", maxima)).toBe("settled"); expect(p.call).toHaveBeenCalledTimes(1);
  expect(j.totals()).toEqual({ calls: 1, tokens: 30, microUsd: 5 });
});
it("one repair stays on same provider/config and reserves separately", async () => {
  const { j, p } = setup(async (_signal, attempt) => ({ usage, repairNeeded: attempt === 0 }));
  expect(await runLP2Offline(j, p, "run", maxima)).toBe("settled");
  expect(p.call.mock.calls.map(c => c[1])).toEqual([0, 1]);
  expect(j.totals()).toEqual({ calls: 2, tokens: 60, microUsd: 10 });
  expect(new Set(j.snapshot().map(c => c.reservation.configurationId)).size).toBe(1);
});
it("second malformed output stops rather than doing a third call", async () => {
  const { j, p } = setup(async () => ({ usage, repairNeeded: true }));
  expect(await runLP2Offline(j, p, "run", maxima)).toBe("stopped"); expect(p.call).toHaveBeenCalledTimes(2);
});
it.each(["429", "503", "network"])("%s stops with reservation charged and no retry/repair", async error => {
  const { j, p } = setup(async () => { throw new Error(error); });
  expect(await runLP2Offline(j, p, "run", maxima)).toBe("stopped"); expect(p.call).toHaveBeenCalledTimes(1);
  expect(j.totals()).toEqual({ calls: 1, tokens: 200, microUsd: 30 });
});
it("missing usage forbids repair", async () => {
  const { j, p } = setup(async () => ({ usage: null, repairNeeded: true }));
  expect(await runLP2Offline(j, p, "run", maxima)).toBe("stopped"); expect(p.call).toHaveBeenCalledTimes(1);
});
it("first timeout aborts synthetic signal, stops after 20s, retains reservation", async () => {
  vi.useFakeTimers(); const { j, p } = setup(async () => new Promise(() => {}));
  const pending = runLP2Offline(j, p, "run", maxima);
  await vi.advanceTimersByTimeAsync(20_000);
  expect(await pending).toBe("stopped"); expect(p.call).toHaveBeenCalledTimes(1);
  expect(p.call.mock.calls[0]![0].aborted).toBe(true); expect(j.totals().tokens).toBe(200);
});
it("repair timeout retains first actual and second full reservation", async () => {
  vi.useFakeTimers(); const { j, p } = setup(async (_signal, attempt) => attempt === 0 ? { usage, repairNeeded: true } : new Promise(() => {}));
  const pending = runLP2Offline(j, p, "run", maxima); await vi.advanceTimersByTimeAsync(20_000);
  expect(await pending).toBe("stopped"); expect(p.call).toHaveBeenCalledTimes(2);
  expect(j.totals()).toEqual({ calls: 2, tokens: 230, microUsd: 35 });
});
it("external abort keeps reservation and cannot trigger repair", async () => {
  const { j, p } = setup(async () => new Promise(() => {})), controller = new AbortController();
  const pending = runLP2Offline(j, p, "run", maxima, controller.signal); controller.abort();
  expect(await pending).toBe("stopped"); expect(p.call).toHaveBeenCalledTimes(1); expect(j.totals().tokens).toBe(200);
});
it("already aborted request or expired deadline never reserves or dispatches", async () => {
  const { j, p } = setup(async () => ({ usage, repairNeeded: false })), controller = new AbortController(); controller.abort();
  expect(await runLP2Offline(j, p, "run", maxima, controller.signal)).toBe("stopped");
  expect(await runLP2Offline(j, p, "run", maxima, undefined, performance.now() - 1)).toBe("stopped");
  expect(p.call).not.toHaveBeenCalled(); expect(j.totals().calls).toBe(0);
});
it("deadline expires during durable reservation: zero dispatch", async () => {
  const { j, p } = setup(async () => ({ usage, repairNeeded: false }));
  const now = vi.spyOn(performance, "now"); now.mockReturnValueOnce(0).mockReturnValueOnce(0).mockReturnValueOnce(0).mockReturnValue(46_000);
  expect(await runLP2Offline(j, p, "run", maxima)).toBe("stopped"); expect(p.call).not.toHaveBeenCalled();
  expect(j.totals().tokens).toBe(200);
});
it("shared E2E deadline prevents repair if first settlement used remaining time", async () => {
  const { j, p } = setup(async () => ({ usage, repairNeeded: true }));
  const settle = j.settle.bind(j); vi.spyOn(j, "settle").mockImplementation((...args) => {
    settle(...args); vi.spyOn(performance, "now").mockReturnValue(46_000);
  });
  vi.spyOn(performance, "now").mockReturnValue(0);
  expect(await runLP2Offline(j, p, "run", maxima)).toBe("stopped"); expect(p.call).toHaveBeenCalledTimes(1);
});
it("shorter common deadline wins over call timeout", async () => {
  vi.useFakeTimers(); const { j, p } = setup(async () => new Promise(() => {}));
  const pending = runLP2Offline(j, p, "run", maxima, undefined, performance.now() + 1000);
  await vi.advanceTimersByTimeAsync(1000); expect(await pending).toBe("stopped"); expect(p.call).toHaveBeenCalledTimes(1);
});
it("late completion after timeout never releases reserved budget", async () => {
  vi.useFakeTimers(); let finish!: (r: { usage: typeof usage; repairNeeded: boolean }) => void;
  const { j, p } = setup(() => new Promise(resolve => { finish = resolve; }));
  const pending = runLP2Offline(j, p, "run", maxima); await vi.advanceTimersByTimeAsync(20_000); await pending;
  finish({ usage, repairNeeded: false }); await Promise.resolve(); expect(j.totals().tokens).toBe(200); expect(j.isStopped).toBe(true);
});
it("second overlapping run is rejected before a second dispatch", async () => {
  const { j, p } = setup(async () => new Promise(() => {})), controller = new AbortController();
  const pending = runLP2Offline(j, p, "run", maxima, controller.signal);
  await expect(runLP2Offline(j, p, "other", maxima)).rejects.toThrow("concurrency_limit");
  expect(p.call).toHaveBeenCalledTimes(1); controller.abort(); await pending;
});
it("same run ID cannot be re-dispatched after settlement", async () => {
  const { j, p } = setup(async () => ({ usage, repairNeeded: false })); await runLP2Offline(j, p, "run", maxima);
  await expect(runLP2Offline(j, p, "run", maxima)).rejects.toThrow("duplicate"); expect(p.call).toHaveBeenCalledTimes(1);
});
it("wrong model/config does not call the synthetic provider", async () => {
  const { j, p } = setup(async () => ({ usage, repairNeeded: false })); p.configurationId = "synthetic-B";
  await expect(runLP2Offline(j, p, "run", maxima)).rejects.toThrow("configuration"); expect(p.call).not.toHaveBeenCalled();
});
it("provider model mutation between initial and repair fails closed", async () => {
  const { j, p } = setup(async () => { p.modelId = "changed-model"; return { usage, repairNeeded: true }; });
  expect(await runLP2Offline(j, p, "run", maxima)).toBe("stopped"); expect(p.call).toHaveBeenCalledTimes(1);
});
it("second OS process cannot acquire live owner's lock", () => {
  const { d } = setup(async () => ({ usage, repairNeeded: false }));
  const module = fileURLToPath(new URL("../src/evaluation/lp2-journal.ts", import.meta.url));
  const code = `import { LP2Journal } from ${JSON.stringify(module)};try{new LP2Journal(process.argv[1],${JSON.stringify(limits)},${JSON.stringify(price)});process.exit(9)}catch(e){process.exit(e.code==='EEXIST'?0:8)}`;
  const result = spawnSync(process.execPath, ["--import", "tsx", "--input-type=module", "-e", code, d], { encoding: "utf8" });
  expect(result.stderr).toBe(""); expect(result.status).toBe(0);
});
it("settlement fsync uncertainty retains lock even when row reached disk", async () => {
  const d = directory(), j = new LP2Journal(d, limits, price, (op, kind) => { if (op === "fsync" && kind === "settle") throw Error("fsync"); });
  journals.push(j); const call = vi.fn(async () => ({ usage, repairNeeded: true }));
  expect(await runLP2Offline(j, { mode: "offline/mock", configurationId: price.configurationId, modelId: price.modelId, call }, "run", maxima)).toBe("stopped");
  expect(call).toHaveBeenCalledTimes(1); expect(j.totals().tokens).toBe(200); j.close();
  expect(fs.existsSync(join(d, "lp2.lock"))).toBe(true); expect(() => new LP2Journal(d, limits, price)).toThrow();
});
it("durable dispatch fsync fault prevents invocation", async () => {
  const d = directory(), j = new LP2Journal(d, limits, price, (op, kind) => { if (op === "fsync" && kind === "dispatch") throw Error("fsync"); });
  journals.push(j); const call = vi.fn();
  await expect(runLP2Offline(j, { mode: "offline/mock", configurationId: price.configurationId, modelId: price.modelId, call }, "run", maxima)).rejects.toThrow();
  expect(call).not.toHaveBeenCalled();
});
it.each(["reserved", "dispatching"])("actual child process exits at %s: stale lock blocks restart; manual inspection still cannot resend", state => {
  const d = directory(); const module = fileURLToPath(new URL("../src/evaluation/lp2-journal.ts", import.meta.url));
  const code = `import { LP2Journal } from ${JSON.stringify(module)}; const j=new LP2Journal(process.argv[1],${JSON.stringify(limits)},${JSON.stringify(price)});j.reserve({id:'run_0',runId:'run',attempt:0,configurationId:'synthetic-A',input:100,output:100,microUsd:30});${state === "dispatching" ? "j.dispatch('run_0');" : ""}process.exit(0);`;
  const result = spawnSync(process.execPath, ["--import", "tsx", "--input-type=module", "-e", code, d], { encoding: "utf8" });
  expect(result.stderr).toBe(""); expect(result.status).toBe(0); expect(() => new LP2Journal(d, limits, price)).toThrow();
  // TEST ONLY: emulate explicit operator unlock; application has no unlock/recovery API.
  fs.unlinkSync(join(d, "lp2.lock")); const resumed = new LP2Journal(d, limits, price); journals.push(resumed);
  expect(resumed.isStopped).toBe(true); expect(() => resumed.dispatch("run_0")).toThrow("pilot_stopped");
});
