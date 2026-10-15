import type { Server } from "node:http";
import { describe, expect, it, vi } from "vitest";
import { createPlanServer } from "../src/api/server.js";
import { LocalFirstProvider } from "../src/nlu/local-first-provider.js";
import { NluPipeline } from "../src/nlu/pipeline.js";
import { type PlanningProvenance } from "../src/nlu/planning-provenance.js";
import type { NluProvider } from "../src/nlu/ports.js";
import { ClaudeIntentProvider } from "../src/nlu/providers/claude-provider.js";
import { GeminiIntentProvider } from "../src/nlu/providers/gemini-provider.js";
import { LlmProviderError } from "../src/nlu/providers/errors.js";
import { OpenAICompatibleIntentProvider, type OpenAICompatibleChatClient } from "../src/nlu/providers/openai-compatible-provider.js";
import { RuleBasedProvider } from "../src/nlu/providers/rule-based-provider.js";
import { emptyContext } from "../src/nlu/types.js";

const battery = {
  intent: "create_automation", trigger: { semantic: "battery_below", details: { level: 25, condition: "above" } },
  steps: [{ semantic: "notify" }], entities: [], missing: [],
};
const completion = (value: unknown = battery) => ({ choices: [{ message: { content: JSON.stringify(value) } }] });
function sdk(create = vi.fn().mockResolvedValue(completion())) {
  const client: OpenAICompatibleChatClient = { chat: { completions: { create } } };
  return { create, provider: new OpenAICompatibleIntentProvider({ client, baseURL: "https://unused.invalid", model: "test", providerLabel: "Test" }) };
}
function fixture(provider: NluProvider, wrap = true) {
  const records: PlanningProvenance[] = [];
  const pipeline = new NluPipeline(undefined, undefined, undefined,
    wrap ? new LocalFirstProvider(provider) : provider, undefined, record => records.push(record));
  return { pipeline, records };
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(r => { resolve = r; });
  return { promise, resolve };
}
async function start(server: Server) {
  await new Promise<void>((resolve, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", resolve); });
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Missing address");
  return `http://127.0.0.1:${address.port}/plan`;
}
async function stop(server: Server) {
  server.closeAllConnections();
  await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
}
const post = (url: string, body: unknown) => fetch(url, {
  method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
});

describe("P2-A request-scoped planning provenance", () => {
  it("local plans do not become AI successes despite legacy workflow successes", async () => {
    const { provider, create } = sdk();
    const { pipeline, records } = fixture(provider);
    expect((await pipeline.planAsync("Batarya %25 üstüne çıkınca bildir", emptyContext())).status).toBe("plan");
    expect(records[0]).toMatchObject({ route: "local_template", resolutionSource: "local_template",
      aiRequired: false, providerCallCount: 0, callAccounting: "known", aiPlanProduced: false });
    expect(pipeline.retryMetrics.firstPassSuccess).toBe(1); // Workflow, not AI usage.
    expect(create).not.toHaveBeenCalled();
  });

  it("records missing local parameters and every clarification answer as separate zero-call requests", async () => {
    const { provider, create } = sdk();
    const { pipeline, records } = fixture(provider);
    const context = emptyContext();
    expect((await pipeline.planAsync("Pil azalınca bana haber ver", context)).status).toBe("needs_clarification");
    expect(pipeline.answerClarification("101", context).status).toBe("needs_clarification");
    expect(pipeline.answerClarification("25", context).status).toBe("plan");
    expect(records.map(r => r.route)).toEqual(["clarification_required", "clarification_required", "clarification_required"]);
    expect(records.map(r => r.resolutionSource)).toEqual(["local_template", "clarification_answer", "clarification_answer"]);
    expect(records.every(r => r.providerCallCount === 0 && !r.aiRequired && r.callAccounting === "known")).toBe(true);
    expect(new Set(records.map(r => r.requestId)).size).toBe(3);
    expect(create).not.toHaveBeenCalled();
  });

  it("AI-required is not evidence of any SDK call when fallback stops before dispatch", async () => {
    const provider: NluProvider = { plan: async () => { throw new LlmProviderError("Unavailable"); } };
    const { pipeline, records } = fixture(provider);
    expect((await pipeline.planAsync("unmatched", emptyContext())).status).toBe("provider_error");
    expect(records[0]).toMatchObject({ aiRequired: true, route: "provider_unavailable",
      providerCallCount: 0, callAccounting: "unknown", aiPlanProduced: false });
  });

  it("the existing no-key rule-based fallback is not counted as an AI invocation", async () => {
    const { pipeline, records } = fixture(new RuleBasedProvider());
    await pipeline.planAsync("Pil yüzde 20'ye düşünce bana haber ver", emptyContext());
    expect(records[0]).toMatchObject({ aiRequired: true, providerUnavailable: true,
      resolutionSource: "rule_based", providerCallCount: 0, callAccounting: "known", aiPlanProduced: false });
  });

  it.each(["openai_compatible", "anthropic", "gemini"] as const)("counts %s only at its injected SDK boundary", async name => {
    const call = vi.fn().mockResolvedValue(name === "anthropic" ? { parsed_output: battery }
      : name === "gemini" ? { text: JSON.stringify(battery) } : completion());
    const provider = name === "anthropic" ? new ClaudeIntentProvider({ client: { messages: { parse: call } } })
      : name === "gemini" ? new GeminiIntentProvider({ client: { models: { generateContent: call } } })
      : sdk(call).provider;
    const { pipeline, records } = fixture(provider);
    expect((await pipeline.planAsync("unmatched", emptyContext())).status).toBe("plan");
    expect(call).toHaveBeenCalledTimes(1);
    expect(records[0]).toMatchObject({ route: "ai_required", aiRequired: true,
      resolutionSource: "provider", providerCallCount: 1, aiPlanProduced: true,
      providerInvocations: [{ sdk: name, stage: "first", result: "returned" }] });
    expect(JSON.stringify(call.mock.calls)).not.toContain("providerCallCount");
  });

  it("preserves one repair, repair instruction and the same AbortSignal, with two SDK invocations", async () => {
    const create = vi.fn().mockResolvedValueOnce(completion({ intent: "invalid" })).mockResolvedValueOnce(completion());
    const { pipeline, records } = fixture(sdk(create).provider);
    const signal = new AbortController().signal;
    expect((await pipeline.planAsync("unmatched", emptyContext(), signal)).status).toBe("plan");
    expect(create).toHaveBeenCalledTimes(2);
    expect(create.mock.calls[0]![1]).toEqual({ signal });
    expect(create.mock.calls[1]![1]).toEqual({ signal });
    expect(create.mock.calls[1]![0].messages[0].content).not.toBe(create.mock.calls[0]![0].messages[0].content);
    expect(records[0]).toMatchObject({ pipelineAttempts: 2, providerCallCount: 2, aiPlanProduced: true,
      providerInvocations: [{ stage: "first", result: "returned" }, { stage: "repair", result: "returned" }] });
    expect(pipeline.retryMetrics.repairSuccess).toBe(1);
  });

  it("an SDK timeout preserves provider_error and a single failed invocation", async () => {
    const create = vi.fn().mockRejectedValue(Object.assign(new Error("private diagnostic"), { name: "APIConnectionTimeoutError" }));
    const failures: unknown[] = [];
    const records: PlanningProvenance[] = [];
    const pipeline = new NluPipeline(undefined, undefined, undefined, new LocalFirstProvider(sdk(create).provider),
      failure => failures.push(failure), record => records.push(record));
    expect((await pipeline.planAsync("unmatched", emptyContext())).status).toBe("provider_error");
    expect(create).toHaveBeenCalledTimes(1);
    expect(failures[0]).toMatchObject({ errorCategory: "timeout", retryable: false, attemptCount: 1 });
    expect(records[0]).toMatchObject({ route: "provider_unavailable", aiRequired: true,
      providerCallCount: 1, aiPlanProduced: false, providerInvocations: [{ result: "threw" }] });
    expect(JSON.stringify(records)).not.toContain("private diagnostic");
  });

  it("retains the AI call when deterministic rescue produces clarification", async () => {
    const create = vi.fn().mockResolvedValue(completion({ intent: "not_understood", trigger: null, steps: [], entities: [], missing: [] }));
    const { pipeline, records } = fixture(sdk(create).provider);
    expect((await pipeline.planAsync("9'da bana hatırlat.", emptyContext())).status).toBe("needs_clarification");
    expect(records[0]).toMatchObject({ route: "clarification_required", resolutionSource: "deterministic_fallback",
      aiRequired: true, providerCallCount: 1, aiPlanProduced: false });
    expect(pipeline.retryMetrics.deterministicFallback).toBe(1);
  });

  it("AI-generated clarification retains its invocation rather than implying free usage", async () => {
    const create = vi.fn().mockResolvedValue(completion({ intent: "create_automation", trigger: { semantic: "time" },
      steps: [{ semantic: "notify" }], entities: [], missing: [{ field: "time", reason: "required_for_time_trigger" }] }));
    const { pipeline, records } = fixture(sdk(create).provider);
    expect((await pipeline.planAsync("unmatched", emptyContext())).status).toBe("needs_clarification");
    expect(records[0]).toMatchObject({ route: "clarification_required", resolutionSource: "provider", providerCallCount: 1 });
  });

  it("pre-cancelled local requests never dispatch, and in-flight cancellation never repairs", async () => {
    const entered = deferred<void>();
    const controller = new AbortController();
    const create = vi.fn().mockImplementation((_params, options) => {
      entered.resolve();
      return new Promise((_resolve, reject) => options.signal.addEventListener("abort", () => reject(
        Object.assign(new Error("aborted"), { name: "AbortError" })), { once: true }));
    });
    const { pipeline, records } = fixture(sdk(create).provider);
    await pipeline.planAsync("Pil %20 altına düşünce bildir", emptyContext(), AbortSignal.abort());
    expect(create).not.toHaveBeenCalled();
    expect(records[0]).toMatchObject({ cancelled: true, providerCallCount: 0 });
    const pending = pipeline.planAsync("unmatched", emptyContext(), controller.signal);
    await entered.promise;
    controller.abort();
    expect((await pending).status).toBe("provider_error");
    expect(create).toHaveBeenCalledTimes(1);
    expect(records[1]).toMatchObject({ cancelled: true, route: "ai_required", providerCallCount: 1, pipelineAttempts: 1 });
  });

  it("unknown custom provider results are not inferred to be AI calls", async () => {
    const fake: NluProvider = { plan: async (input, context) => new RuleBasedProvider().plan(input, context) };
    const { pipeline, records } = fixture(fake);
    await pipeline.planAsync("Pil yüzde 20'ye düşünce bana haber ver", emptyContext());
    expect(records[0]).toMatchObject({ aiRequired: true, providerCallCount: 0, callAccounting: "unknown", aiPlanProduced: false });
  });

  it("observer errors and snapshot mutation cannot change the planning result", async () => {
    const provider = new LocalFirstProvider(sdk().provider);
    let snapshot: PlanningProvenance | undefined;
    const pipeline = new NluPipeline(undefined, undefined, undefined, provider, undefined, record => {
      snapshot = record;
      (record as { providerCallCount: number }).providerCallCount = 900;
    });
    expect((await pipeline.planAsync("unmatched", emptyContext())).status).toBe("plan");
    expect(snapshot?.providerCallCount).toBe(1);
    expect(Object.isFrozen(snapshot)).toBe(true);
    expect(Object.isFrozen(snapshot!.providerInvocations)).toBe(true);
    expect(Object.isFrozen(snapshot!.providerInvocations[0])).toBe(true);
  });

  it("parallel HTTP success, failure and local requests remain isolated without response metadata", async () => {
    const firstEntry = deferred<void>();
    const secondEntry = deferred<void>();
    const releaseFirst = deferred<void>();
    const releaseSecond = deferred<void>();
    let count = 0;
    const create = vi.fn().mockImplementation(async () => {
      const index = count++;
      if (index === 0) { firstEntry.resolve(); await releaseFirst.promise; throw { status: 503 }; }
      secondEntry.resolve(); await releaseSecond.promise; return completion();
    });
    const { pipeline, records } = fixture(sdk(create).provider);
    const server = createPlanServer({ pipeline });
    const url = await start(server);
    try {
      const failed = post(url, { text: "first unmatched", provenance: { providerCallCount: 99 } });
      await firstEntry.promise;
      const success = post(url, { text: "second unmatched" });
      await secondEntry.promise;
      const local = await post(url, { text: "Pil %25 üstüne çıkınca bildir" });
      expect(local.status).toBe(200);
      const localBody = await local.json();
      expect(Object.keys(localBody).sort()).toEqual(["band", "conversation", "intent", "plan", "status", "validation"]);
      expect(JSON.stringify(localBody)).not.toContain("providerCallCount");
      releaseSecond.resolve();
      expect((await success).status).toBe(200);
      releaseFirst.resolve();
      expect((await failed).status).toBe(502);
      expect(records).toHaveLength(3);
      expect(records.map(r => r.providerCallCount)).toEqual([0, 1, 1]);
      expect(records.map(r => r.route)).toEqual(["local_template", "ai_required", "provider_unavailable"]);
      expect(new Set(records.map(r => r.requestId)).size).toBe(3);
      expect(records[1]!.providerInvocations[0]!.result).toBe("returned");
      expect(records[2]!.providerInvocations[0]!.result).toBe("threw");
      expect(create).toHaveBeenCalledTimes(2);
      expect(records.every(r => !JSON.stringify(r).includes("unmatched"))).toBe(true);
    } finally { releaseFirst.resolve(); releaseSecond.resolve(); await stop(server); }
  });
});
