import * as fs from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { lp1Corpus } from "../src/evaluation/lp1-corpus.js";
import { LP2Journal } from "../src/evaluation/lp2-journal.js";
import { normalizeB2CUsage, recoveredB2CRun, runB2COffline, summarizeB2C } from "../src/evaluation/b2c-bridge.js";
import type { B2CResponse, B2CScript } from "../src/evaluation/b2c-types.js";
import type { B2CRun } from "../src/evaluation/b2c-types.js";
const corpus = lp1Corpus(), test = corpus.find(c => c.id === "basit-4")!;
const answer = { intent: "create_automation", status: "plan", trigger: { semantic: "battery_below", params: { level: 20, condition: "below" } },
  actionSemantics: ["notify"], question: null, approval: "not_required", runtimePermissions: [], externalSetup: ["notifications"],
  plan: { name: "Bildirim", trigger: { type: "ios.battery.falls_below", params: { level: 20, condition: "below" } }, steps: [{ type: "ios.notification.show" }] }, unsupportedReason: null };
const usage = { inputTokens: 10, outputTokens: 20, reasoningTokens: 5, totalTokens: 30, reasoningIncludedInOutput: true };
const price = { configurationId: "synthetic-A", modelId: "mock-model-v1", input: 100_000, output: 200_000 };
const limits = { calls: 360, tokens: 2_000_000, microUsd: 5_000_000 }, maxima = { input: 100, output: 100 };
const dirs: string[] = [], journals: LP2Journal[] = [];
const response = (outputJson = JSON.stringify(answer), u: unknown = usage): B2CResponse => ({ version: "synthetic-v1", outputJson, usage: u });
const report = (runs: B2CRun[]) => summarizeB2C(runs.map(r => ({ runId: r.runId, modelLabel: r.modelLabel,
  test: corpus.find(c => c.id === r.test.id)! })), runs);
function setup(call: B2CScript["call"] = async () => response()) {
  const d = fs.mkdtempSync(join(tmpdir(), "b2c-offline-")); dirs.push(d);
  const j = new LP2Journal(d, limits, price); journals.push(j);
  const script = { mode: "offline/mock" as const, configurationId: price.configurationId, modelId: price.modelId, call: vi.fn(call) };
  return { d, j, script };
}
afterEach(() => {
  vi.restoreAllMocks(); vi.useRealTimers(); vi.unstubAllGlobals();
  for (const j of journals.splice(0)) j.close();
  for (const d of dirs.splice(0)) fs.rmSync(d, { recursive: true, force: true });
});
it("publishes quality only after run completion and settled accounting", async () => {
  const { j, script } = setup(); const run = await runB2COffline(j, test, "synthetic-A", "run", script, maxima);
  expect(run).toMatchObject({ accountingSettled: true, qualityPublished: true, qualityStatus: "published" });
  expect(run.attempts[0]).toMatchObject({ preflightValid: true, accountingSettled: true, qualityPublished: true });
  expect(script.call).toHaveBeenCalledTimes(1); expect(report([run]).final.passed).toBe(1);
});
it("preflight success cannot publish quality when usage exceeds reservation", async () => {
  const { j, script } = setup(async () => response(undefined, { ...usage, outputTokens: 101, totalTokens: 111 }));
  const run = await runB2COffline(j, test, "synthetic-A", "run", script, maxima);
  expect(run.attempts[0]?.preflightValid).toBe(true); expect(run.qualityPublished).toBe(false); expect(j.isStopped).toBe(true);
  expect(report([run])).toMatchObject({ scheduled: 1, qualityEvaluated: 0, skippedUnavailable: 1, coverage: 0 });
});
it("settled accounting plus semantic mismatch publishes FAIL, not inferred PASS", async () => {
  const bad = structuredClone(answer); bad.trigger.params.level = 25; bad.plan.trigger.params.level = 25;
  const { j, script } = setup(async () => response(JSON.stringify(bad)));
  const run = await runB2COffline(j, test, "synthetic-A", "run", script, maxima);
  expect(run.accountingSettled).toBe(true); expect(run.qualityPublished).toBe(true);
  expect(run.attempts[0]?.provisionalScore?.passed).toBe(false); expect(script.call).toHaveBeenCalledTimes(1);
  expect(report([run]).final.passed).toBe(0);
});
it("repair preserves first-pass FAIL and final PASS in separate cohorts", async () => {
  const { j, script } = setup(async (_signal, attempt) => {
    if (attempt === 1) expect(j.snapshot()[0]?.state).toBe("settled");
    return attempt === 0 ? response("{broken") : response();
  });
  const run = await runB2COffline(j, test, "synthetic-A", "run", script, maxima), summary = report([run]);
  expect(script.call).toHaveBeenCalledTimes(2); expect(summary.firstPass.passed).toBe(0); expect(summary.final.passed).toBe(1);
  expect(summary.firstPass.count).toBe(1); expect(summary.final.count).toBe(1); expect(j.totals()).toEqual({ calls: 2, tokens: 60, microUsd: 10 });
});
it.each([null, {}, { ...usage, totalTokens: 31 }, { ...usage, inputTokens: "10" }, { ...usage, reasoningIncludedInOutput: "true" }])("invalid usage %j stops without provisional quality", async u => {
  const { j, script } = setup(async () => response(undefined, u));
  const run = await runB2COffline(j, test, "synthetic-A", "run", script, maxima);
  expect(run.qualityPublished).toBe(false); expect(run.attempts[0]?.preflightValid).toBeNull(); expect(j.isStopped).toBe(true);
  expect(j.totals().tokens).toBe(200); expect(script.call).toHaveBeenCalledTimes(1);
});
it.each(["unsafe_action", "unknown", "malformed_risky", "approval_bypass", "permissions_bypass", "unsupported_plan"])("%s => zero repair and STOP", async kind => {
  let selected = test; const bad: any = structuredClone(answer);
  if (kind === "unknown") bad.plan.steps = [{ type: "ios.imaginary" }];
  if (kind === "unsafe_action") bad.plan.steps = [{ type: "tesla.doors.lock" }];
  if (kind === "malformed_risky") bad.plan.steps = [{ type: "tesla.doors.lock", unexpected: true }];
  if (kind === "approval_bypass") selected = { ...test, oracle: { ...test.oracle, approval: "required" } };
  if (kind === "permissions_bypass") selected = { ...test, oracle: { ...test.oracle, runtimePermissions: ["camera"] } };
  if (kind === "unsupported_plan") selected = corpus.find(c => c.oracle.status === "unsupported")!;
  const { j, script } = setup(async () => response(JSON.stringify(bad)));
  const run = await runB2COffline(j, selected, "synthetic-A", "run", script, maxima);
  expect(run.qualityStatus).toBe("safety_stop"); expect(run.qualityPublished).toBe(false);
  expect(script.call).toHaveBeenCalledTimes(1); expect(j.isStopped).toBe(true);
});
it.each(["429", "503", "network"])("%s cannot be quality success or retry", async error => {
  const { j, script } = setup(async () => { throw Error(error); });
  const run = await runB2COffline(j, test, "synthetic-A", "run", script, maxima);
  expect(script.call).toHaveBeenCalledTimes(1); expect(run.qualityPublished).toBe(false); expect(j.totals().tokens).toBe(200);
});
it("repair timeout keeps both reservations and withholds whole-run quality", async () => {
  vi.useFakeTimers(); const { j, script } = setup(async (_signal, attempt) => attempt === 0 ? response("bad-json") : new Promise(() => {}));
  const pending = runB2COffline(j, test, "synthetic-A", "run", script, maxima); await vi.advanceTimersByTimeAsync(20_000);
  const run = await pending; expect(run.qualityPublished).toBe(false); expect(script.call).toHaveBeenCalledTimes(2);
  expect(run.attempts[0]?.provisionalScore?.passed).toBe(false); expect(j.totals()).toEqual({ calls: 2, tokens: 230, microUsd: 35 });
});
it("aborted run never publishes late output or mutates returned metrics", async () => {
  let finish!: (r: B2CResponse) => void;
  const { j, script } = setup(() => new Promise(resolve => { finish = resolve; })), controller = new AbortController();
  const pending = runB2COffline(j, test, "synthetic-A", "run", script, maxima, controller.signal); controller.abort();
  const run = await pending, before = JSON.stringify(run); finish(response()); await Promise.resolve(); await Promise.resolve();
  expect(JSON.stringify(run)).toBe(before); expect(run.qualityPublished).toBe(false);
});
it("crash replay reports incomplete calls without dispatch", async () => {
  const { d, j, script } = setup(); j.reserve({ id: "run_0", runId: "run", attempt: 0, configurationId: price.configurationId, input: 100, output: 100, microUsd: 30 });
  j.dispatch("run_0"); j.close(); const resumed = new LP2Journal(d, limits, price); journals.push(resumed);
  const run = await runB2COffline(resumed, test, "synthetic-A", "run", script, maxima);
  expect(run.accountingStatus).toBe("stopped"); expect(script.call).not.toHaveBeenCalled(); expect(run.qualityPublished).toBe(false);
});
it("settled but lost output stays unavailable and is never re-dispatched", async () => {
  const { d, j, script } = setup(); await runB2COffline(j, test, "synthetic-A", "run", script, maxima); j.close();
  const resumed = new LP2Journal(d, limits, price); journals.push(resumed); script.call.mockClear();
  const run = await runB2COffline(resumed, test, "synthetic-A", "run", script, maxima);
  expect(run.accountingSettled).toBe(true); expect(run.qualityStatus).toBe("unavailable_after_restart");
  expect(run.qualityPublished).toBe(false); expect(script.call).not.toHaveBeenCalled();
});
it("reasoning included is not charged twice; excluded is explicitly added once", () => {
  const a = normalizeB2CUsage(usage), b = normalizeB2CUsage({ ...usage, outputTokens: 15, reasoningIncludedInOutput: false });
  expect(a).toEqual(b); expect(a).toMatchObject({ output: 20, total: 30 });
  expect(normalizeB2CUsage({ ...usage, reasoningIncludedInOutput: false })).toBeNull();
});
it.each(["outputTokens", "inputTokens", "reasoningTokens", "totalTokens"])("invalid %s is not coerced", key => {
  for (const value of [-1, 0.5, Infinity, NaN, Number.MAX_SAFE_INTEGER + 1, "1", null]) {
    expect(normalizeB2CUsage({ ...usage, [key]: value })).toBeNull();
  }
});
it("strict envelope rejects extra fields without storing them", async () => {
  const { d, j, script } = setup(async () => ({ ...response(), credential: "DO_NOT_LOG" }));
  const run = await runB2COffline(j, test, "synthetic-A", "run", script, maxima);
  expect(run.qualityPublished).toBe(false); expect(fs.readFileSync(join(d, "lp2.jsonl"), "utf8")).not.toContain("DO_NOT_LOG");
});
it("over-64KiB UTF8 response stops without parsing/repair", async () => {
  const { j, script } = setup(async () => response("ü".repeat(32769)));
  const run = await runB2COffline(j, test, "synthetic-A", "run", script, maxima);
  expect(run.qualityStatus).toBe("safety_stop"); expect(script.call).toHaveBeenCalledTimes(1); expect(run.attempts[0]?.provisionalScore).toBeNull();
});
it("does not strip markdown or salvage a JSON substring", async () => {
  const { j, script } = setup(async () => response("```json\n" + JSON.stringify(answer) + "\n```"));
  const run = await runB2COffline(j, test, "synthetic-A", "run", script, maxima);
  expect(run.qualityPublished).toBe(false); expect(script.call).toHaveBeenCalledTimes(2);
  expect(run.attempts.every(a => a.provisionalScore?.failures.includes("json"))).toBe(true);
});
it("coverage includes skipped model/category/split/family, quality denominator excludes unavailable", async () => {
  const { j, script } = setup(), completed = await runB2COffline(j, test, "synthetic-A", "one", script, maxima);
  const missing = recoveredB2CRun(j, corpus.find(c => c.split === "holdout")!, "synthetic-B", "unattempted");
  const schedule = [completed, missing].map(r => ({ runId: r.runId, modelLabel: r.modelLabel, test: corpus.find(c => c.id === r.test.id)! }));
  // Missing output row is actually absent; explicit schedule preserves its denominator.
  const summary = summarizeB2C(schedule, [completed]);
  expect(summary).toMatchObject({ scheduled: 2, attempted: 1, accountingSettled: 1, qualityEvaluated: 1, skippedUnavailable: 1, coverage: 0.5 });
  expect(summary.final.count).toBe(1); expect(summary.byModel.find(m => m.value === "synthetic-B")).toMatchObject({ scheduled: 1, coverage: 0, skippedUnavailable: 1 });
  expect(summary.bySplit.find(s => s.value === "holdout")?.coverage).toBe(0);
  expect(summary.byCategory.reduce((n, c) => n + c.scheduled, 0)).toBe(2);
  expect(summary.byFamily.reduce((n, f) => n + f.scheduled, 0)).toBe(2);
  expect(() => report([completed, completed])).toThrow("duplicate"); expect(summarizeB2C([], []).coverage).toBeNull();
  expect(() => summarizeB2C([], [completed])).toThrow("unplanned");
});
it("has no external transport; callbacks are explicit test-only scripts", async () => {
  const fetch = vi.fn(() => { throw Error("external network forbidden"); }); vi.stubGlobal("fetch", fetch);
  const { j, script } = setup(); await runB2COffline(j, test, "synthetic-A", "run", script, maxima); expect(fetch).not.toHaveBeenCalled();
});
it("safe plan schema error may repair after first usage settles", async () => {
  const bad = structuredClone(answer); delete (bad.plan.trigger as { type?: string }).type;
  const { j, script } = setup(async (_s, attempt) => attempt === 0 ? response(JSON.stringify(bad)) : response());
  const run = await runB2COffline(j, test, "synthetic-A", "run", script, maxima);
  expect(run.attempts[0]?.repairDecision).toBe("repairable"); expect(script.call).toHaveBeenCalledTimes(2);
  expect(report([run]).firstPass.passed).toBe(0); expect(report([run]).final.passed).toBe(1);
});
it("settlement fsync failure cannot turn provisional PASS into published quality", async () => {
  const d = fs.mkdtempSync(join(tmpdir(), "b2c-fsync-")); dirs.push(d);
  const j = new LP2Journal(d, limits, price, (op, kind) => { if (op === "fsync" && kind === "settle") throw Error("fault"); }); journals.push(j);
  const call = vi.fn(async () => response());
  const run = await runB2COffline(j, test, "synthetic-A", "run", { mode: "offline/mock", ...price, call }, maxima);
  expect(run.attempts[0]?.preflightValid).toBe(true); expect(run.qualityPublished).toBe(false); expect(call).toHaveBeenCalledTimes(1);
  expect(j.totals().tokens).toBe(200);
});
it("exactly 64KiB output is accepted, shared deadline zero invokes nothing", async () => {
  const text = JSON.stringify(answer); const padded = text + " ".repeat(65536 - Buffer.byteLength(text));
  const { j, script } = setup(async () => response(padded));
  expect((await runB2COffline(j, test, "synthetic-A", "one", script, maxima)).qualityPublished).toBe(true);
  const result = await runB2COffline(j, test, "synthetic-A", "two", script, maxima, undefined, performance.now() - 1);
  expect(result.attempted).toBe(false); expect(result.qualityPublished).toBe(false); expect(script.call).toHaveBeenCalledTimes(1);
});
