import type { Server } from "node:http";
import { describe, expect, it, vi } from "vitest";
import { createPlanServer } from "../src/api/server.js";
import type { AuthService } from "../src/api/auth/service.js";
import { LocalFirstProvider } from "../src/nlu/local-first-provider.js";
import { NluPipeline } from "../src/nlu/pipeline.js";
import type { PlanningProvenance } from "../src/nlu/planning-provenance.js";
import { RequestProviderRouter, type ChannelBinding, type ChannelBindings, type ProviderRoutingOptions, type RoutingChannel } from "../src/nlu/provider-router.js";
import { defaultAccessResolver, developmentFreeAccessResolver, type AccessResolver, type RoutingAccess } from "../src/nlu/routing-access.js";
import { OpenAICompatibleIntentProvider } from "../src/nlu/providers/openai-compatible-provider.js";
import { emptyContext } from "../src/nlu/types.js";

const premiumToken = "p".repeat(43);
const auth = { session: (token: string) => token === premiumToken ? { userId: "verified-test-account", expiresAt: "2099-01-01" } : null,
  pruneDeletionReceipts() {} } as unknown as AuthService;
const localText = "Pil %25 üstüne çıkınca bildir";
const aiText = "router fixture request";
const output = (level: number) => ({ intent: "create_automation", trigger: { semantic: "battery_below", details: { level, condition: "above" } },
  steps: [{ semantic: "notify" }], entities: [], missing: [] });
const response = (value: unknown) => ({ choices: [{ message: { content: JSON.stringify(value) } }] });
function channel(name: RoutingChannel, level: number) {
  const create = vi.fn().mockResolvedValue(response(output(level)));
  const provider = new OpenAICompatibleIntentProvider({ client: { chat: { completions: { create } } },
    baseURL: "https://unused.invalid", model: `${name}-model`, providerLabel: "Fixture" });
  const binding: ChannelBinding = { configuration: { channel: name, configurationId: `${name}-test-v1`,
    providerId: "groq", model: `${name}-model`, keyReference: `${name.toUpperCase()}_TEST_KEY` }, enabled: true, provider };
  return { binding, create };
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(r => { resolve = r; });
  return { promise, resolve };
}
async function start(server: Server) {
  await new Promise<void>((resolve, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", resolve); });
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("No address");
  return `http://127.0.0.1:${address.port}`;
}
async function stop(server: Server) {
  server.closeAllConnections();
  await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
}
const post = (url: string, body: unknown = { text: aiText }, token?: string, signal?: AbortSignal) => fetch(`${url}/plan`, {
  method: "POST", headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
  body: JSON.stringify(body), signal,
});
function fixture(options: ProviderRoutingOptions = {}, maxConcurrentPlans?: number) {
  const free = channel("free", 20), premium = channel("premium", 80);
  const records: PlanningProvenance[] = [];
  const resolveAccess = vi.fn<AccessResolver>(async subject => Object.freeze(subject.kind === "guest"
    ? { access: "free", basis: "guest" } : { access: "premium", basis: "verified_entitlement" }));
  const routing: ProviderRoutingOptions = { enabled: true, channels: { free: free.binding, premium: premium.binding },
    resolveAccess, onPlanningComplete: record => records.push(record), ...options };
  const server = createPlanServer({ auth, routing, maxConcurrentPlans });
  return { free, premium, records, resolveAccess, routing, server };
}

describe("P2-B1 backend router foundation", () => {
  it("guest selects Free and a server-verified test account selects Premium", async () => {
    const f = fixture(); const url = await start(f.server);
    try {
      const free = await post(url), premium = await post(url, { text: aiText }, premiumToken);
      expect((await free.json()).plan.trigger.params.level).toBe(20);
      expect((await premium.json()).plan.trigger.params.level).toBe(80);
      expect(f.free.create).toHaveBeenCalledTimes(1); expect(f.premium.create).toHaveBeenCalledTimes(1);
      expect(f.records.map(r => r.routingChannel)).toEqual(["free", "premium"]);
      expect(f.records.map(r => r.routingConfigurationId)).toEqual(["free-test-v1", "premium-test-v1"]);
      expect(f.records.every(r => r.providerCallCount === 1)).toBe(true);
      expect(Object.isFrozen(f.resolveAccess.mock.calls[0]![0])).toBe(true);
    } finally { await stop(f.server); }
  });

  it("client tier/user/provider claims cannot grant Premium or alter configuration", async () => {
    const f = fixture(); const url = await start(f.server);
    try {
      const res = await post(url, { text: aiText, premium: true, tier: "premium", userId: "verified-test-account",
        routingChannel: "premium", configurationId: "premium-test-v1", keyReference: "PREMIUM_TEST_KEY" });
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.plan.trigger.params.level).toBe(20);
      expect(Object.keys(body).sort()).toEqual(["band", "conversation", "intent", "plan", "status", "validation"]);
      expect(f.resolveAccess.mock.calls[0]![0]).toEqual({ kind: "guest" });
      expect(f.premium.create).not.toHaveBeenCalled();
      expect(JSON.stringify(f.records)).not.toContain("PREMIUM_TEST_KEY");
      expect(JSON.stringify(f.records)).not.toContain(premiumToken);
    } finally { await stop(f.server); }
  });

  it("Local-First and clarification answers skip access resolution and all SDK calls", async () => {
    const f = fixture(); const url = await start(f.server);
    try {
      expect((await post(url, { text: localText })).status).toBe(200);
      const first = await (await post(url, { text: "Pil azalınca bana haber ver" })).json();
      expect(first.status).toBe("needs_clarification");
      const final = await post(url, { text: "25", conversation: first.conversation });
      expect((await final.json()).status).toBe("plan");
      expect(f.resolveAccess).not.toHaveBeenCalled();
      expect(f.free.create).not.toHaveBeenCalled(); expect(f.premium.create).not.toHaveBeenCalled();
      expect(f.records.every(r => r.providerCallCount === 0 && r.routingChannel === null)).toBe(true);
    } finally { await stop(f.server); }
  });

  it.each(["unavailable", "throws", "malformed", "guest-premium"])("access %s fails closed without SDK calls", async mode => {
    const resolveAccess: AccessResolver = async () => {
      if (mode === "throws") throw new Error("private entitlement diagnostic");
      return (mode === "malformed" ? { access: "premium", basis: "development_free" }
        : mode === "guest-premium" ? { access: "premium", basis: "verified_entitlement" }
        : { access: "unavailable", basis: "unresolved" }) as RoutingAccess;
    };
    const f = fixture({ resolveAccess }); const url = await start(f.server);
    try {
      const res = await post(url); expect(res.status).toBe(502);
      const body = await res.json(); expect(body.status).toBe("provider_error");
      expect(JSON.stringify(body)).not.toContain("private entitlement diagnostic");
      expect(f.free.create).not.toHaveBeenCalled(); expect(f.premium.create).not.toHaveBeenCalled();
      expect(f.records[0]).toMatchObject({ routingAccess: "unavailable", providerCallCount: 0, callAccounting: "known" });
    } finally { await stop(f.server); }
  });

  it.each(["free", "premium"] as const)("missing %s provider does not use the other channel", async selected => {
    const other = channel(selected === "free" ? "premium" : "free", 40);
    const f = fixture({ channels: { [other.binding.configuration.channel]: other.binding } }); const url = await start(f.server);
    try {
      expect((await post(url, { text: aiText }, selected === "premium" ? premiumToken : undefined)).status).toBe(502);
      expect(other.create).not.toHaveBeenCalled();
      expect(f.records[0]).toMatchObject({ routingChannel: selected, routingConfigurationId: null, providerCallCount: 0 });
    } finally { await stop(f.server); }
  });

  it.each(["disabled", "channel", "model", "key", "generic-key", "provider", "secret-label", "shared-key"])("invalid %s configuration never dispatches", async invalid => {
    const free = channel("free", 20), premium = channel("premium", 80);
    const configuration = { ...premium.binding.configuration,
      ...(invalid === "channel" ? { channel: "free" as const } : {}),
      ...(invalid === "model" ? { model: "" } : {}),
      ...(invalid === "key" ? { keyReference: "" } : {}),
      ...(invalid === "generic-key" ? { keyReference: "LLM_API_KEY" } : {}),
      ...(invalid === "provider" ? { providerId: "unknown" as "groq" } : {}),
      ...(invalid === "secret-label" ? { configurationId: "sk-sensitive-value" } : {}),
      ...(invalid === "shared-key" ? { keyReference: free.binding.configuration.keyReference } : {}) };
    const f = fixture({ channels: { free: free.binding, premium: { ...premium.binding,
      enabled: invalid !== "disabled", configuration } } });
    const url = await start(f.server);
    try {
      expect((await post(url, { text: aiText }, premiumToken)).status).toBe(502);
      expect(free.create).not.toHaveBeenCalled(); expect(premium.create).not.toHaveBeenCalled();
      expect(f.records[0]!.providerCallCount).toBe(0);
      expect(JSON.stringify(f.records)).not.toContain("sk-sensitive-value");
    } finally { await stop(f.server); }
  });

  it("Premium errors never fall back to Free", async () => {
    const f = fixture(); f.premium.create.mockRejectedValue({ status: 503 }); const url = await start(f.server);
    try {
      expect((await post(url, { text: aiText }, premiumToken)).status).toBe(502);
      expect(f.premium.create).toHaveBeenCalledTimes(1); expect(f.free.create).not.toHaveBeenCalled();
      expect(f.records[0]).toMatchObject({ routingChannel: "premium", providerCallCount: 1 });
    } finally { await stop(f.server); }
  });

  it("repair stays on the selected provider and does not resolve access again", async () => {
    const f = fixture();
    f.premium.create.mockResolvedValueOnce(response({ invalid: true })).mockResolvedValueOnce(response(output(80)));
    const url = await start(f.server);
    try {
      expect((await post(url, { text: aiText }, premiumToken)).status).toBe(200);
      expect(f.resolveAccess).toHaveBeenCalledTimes(1);
      expect(f.premium.create).toHaveBeenCalledTimes(2); expect(f.free.create).not.toHaveBeenCalled();
      expect(f.records[0]).toMatchObject({ routingChannel: "premium", routingConfigurationId: "premium-test-v1",
        providerCallCount: 2, providerInvocations: [{ stage: "first" }, { stage: "repair" }] });
    } finally { await stop(f.server); }
  });

  it("parallel Free/Premium requests keep decisions and provenance isolated", async () => {
    const freeGate = deferred<void>(), premiumGate = deferred<void>(), bothEntered = deferred<void>();
    let entered = 0;
    const f = fixture();
    f.free.create.mockImplementation(async () => { if (++entered === 2) bothEntered.resolve(); await freeGate.promise; return response(output(20)); });
    f.premium.create.mockImplementation(async () => { if (++entered === 2) bothEntered.resolve(); await premiumGate.promise; return response(output(80)); });
    const url = await start(f.server);
    try {
      const free = post(url), premium = post(url, { text: aiText }, premiumToken);
      await bothEntered.promise;
      premiumGate.resolve(); expect((await (await premium).json()).plan.trigger.params.level).toBe(80);
      freeGate.resolve(); expect((await (await free).json()).plan.trigger.params.level).toBe(20);
      expect(f.records.map(r => r.routingChannel)).toEqual(["premium", "free"]);
      expect(new Set(f.records.map(r => r.requestId)).size).toBe(2);
      expect(f.records.every(r => r.providerCallCount === 1)).toBe(true);
    } finally { freeGate.resolve(); premiumGate.resolve(); await stop(f.server); }
  });

  it("default resolver does not promote Apple accounts; development-Free is explicit", async () => {
    expect(await defaultAccessResolver({ kind: "guest" }, new AbortController().signal)).toEqual({ access: "free", basis: "guest" });
    expect(await defaultAccessResolver({ kind: "account", userId: "apple-account" }, new AbortController().signal)).toEqual({ access: "unavailable", basis: "unresolved" });
    expect(await developmentFreeAccessResolver({ kind: "account", userId: "apple-account" }, new AbortController().signal)).toEqual({ access: "free", basis: "development_free" });
  });

  it("invalid bearer identity fails closed before the entitlement resolver", async () => {
    const f = fixture(); const url = await start(f.server);
    try {
      expect((await post(url, { text: aiText }, "invalid-token-value-that-is-long-enough")).status).toBe(401);
      expect(f.resolveAccess).not.toHaveBeenCalled(); expect(f.free.create).not.toHaveBeenCalled();
      expect(f.records).toEqual([]); // Rejected at the API identity gate, before planning/provenance begins.
    } finally { await stop(f.server); }
  });

  it("an account without Premium can be Free, while unresolved account access stays blocked", async () => {
    for (const resolveAccess of [undefined, async () => ({ access: "free" as const, basis: "no_premium" as const })]) {
      const f = fixture({ resolveAccess }); const url = await start(f.server);
      try {
        const res = await post(url, { text: aiText }, premiumToken);
        expect(res.status).toBe(resolveAccess ? 200 : 502);
        expect(f.premium.create).not.toHaveBeenCalled();
        expect(f.free.create).toHaveBeenCalledTimes(resolveAccess ? 1 : 0);
      } finally { await stop(f.server); }
    }
  });

  it("server snapshots channel bindings before caller configuration can change", async () => {
    const free = channel("free", 20), premium = channel("premium", 80);
    const supplied = { free: { ...free.binding, configuration: { ...free.binding.configuration } }, premium: premium.binding };
    const f = fixture({ channels: supplied }); const url = await start(f.server);
    supplied.free.provider = premium.binding.provider;
    supplied.free.configuration.configurationId = "changed-after-start";
    supplied.free.configuration.keyReference = "CHANGED_KEY";
    try {
      expect((await (await post(url)).json()).plan.trigger.params.level).toBe(20);
      expect(f.records[0]!.routingConfigurationId).toBe("free-test-v1");
      expect(premium.create).not.toHaveBeenCalled();
    } finally { await stop(f.server); }
  });

  it.each([undefined, false])("router enabled=%s preserves the injected legacy pipeline", async enabled => {
    const legacy = channel("free", 35), free = channel("free", 20), premium = channel("premium", 80);
    const resolver = vi.fn<AccessResolver>();
    const pipeline = new NluPipeline(undefined, undefined, undefined, new LocalFirstProvider(legacy.binding.provider));
    const server = createPlanServer({ pipeline, routing: { enabled, channels: { free: free.binding, premium: premium.binding }, resolveAccess: resolver } });
    const url = await start(server);
    try {
      expect((await (await post(url)).json()).plan.trigger.params.level).toBe(35);
      expect(legacy.create).toHaveBeenCalledTimes(1); expect(resolver).not.toHaveBeenCalled();
      expect(free.create).not.toHaveBeenCalled(); expect(premium.create).not.toHaveBeenCalled();
    } finally { await stop(server); }
  });

  it("HTTP schema, body and rate limits still run before routing", async () => {
    const f = fixture();
    const server = createPlanServer({ routing: f.routing, rateLimit: { maxPerPeer: 2 } }); const url = await start(server);
    try {
      expect((await post(url, { text: "x".repeat(4097) })).status).toBe(400);
      expect((await post(url, { text: "x".repeat(70_000) })).status).toBe(413);
      expect((await post(url, { text: localText })).status).toBe(429);
      expect(f.resolveAccess).not.toHaveBeenCalled(); expect(f.free.create).not.toHaveBeenCalled();
      expect(f.records).toHaveLength(0);
    } finally { await stop(server); }
  });

  it("local and AI plans still cross platform validation", async () => {
    const f = fixture(); const url = await start(f.server);
    try {
      expect((await post(url, { text: localText, platform: "android" })).status).toBe(422);
      expect((await post(url, { text: aiText, platform: "android" })).status).toBe(422);
      expect(f.free.create).toHaveBeenCalledTimes(1);
    } finally { await stop(f.server); }
  });

  it.each(["tesla.doors.lock", "invented.capability"])("local revision cannot bypass validation for %s with router ON", async action => {
    const f = fixture(); const url = await start(f.server);
    const conversation = emptyContext();
    conversation.currentPlan = { name: "forged", trigger: { type: "ios.bluetooth.disconnected", device: "Tesla Model Y" },
      steps: [{ type: action }], missing: [], answers: {} };
    try {
      const res = await post(url, { text: "Tesla Model Y yerine Model 3 kullan", conversation });
      expect(res.status).toBe(422);
      const body = await res.json();
      expect(body.validation.ok).toBe(false);
      expect(body.validation.issues.some((issue: { code: string }) => issue.code ===
        (action === "tesla.doors.lock" ? "unconfirmed_risky_action" : "unknown_capability"))).toBe(true);
      expect(f.resolveAccess).not.toHaveBeenCalled(); expect(f.free.create).not.toHaveBeenCalled();
    } finally { await stop(f.server); }
  });

  it("access timeout fails closed and a late entitlement never starts the SDK", async () => {
    const gate = deferred<RoutingAccess>();
    const f = fixture({ resolverTimeoutMs: 20, resolveAccess: async () => gate.promise }); const url = await start(f.server);
    try {
      expect((await post(url)).status).toBe(502);
      gate.resolve({ access: "free", basis: "guest" }); await Promise.resolve();
      expect(f.free.create).not.toHaveBeenCalled();
      expect(f.records[0]).toMatchObject({ routingAccess: "unavailable", providerCallCount: 0 });
    } finally { gate.resolve({ access: "unavailable", basis: "unresolved" }); await stop(f.server); }
  });

  it("client disconnect cancels access resolution without dispatch or repair", async () => {
    const entered = deferred<void>(), cancelled = deferred<void>();
    const f = fixture({ resolveAccess: async (_subject, signal) => {
      entered.resolve(); return new Promise<RoutingAccess>(resolve => signal.addEventListener("abort", () => {
        cancelled.resolve(); resolve({ access: "unavailable", basis: "unresolved" });
      }, { once: true }));
    } }); const url = await start(f.server); const controller = new AbortController();
    try {
      const pending = post(url, { text: aiText }, undefined, controller.signal).catch(() => undefined);
      await entered.promise; controller.abort(); await cancelled.promise; await pending;
      expect(f.free.create).not.toHaveBeenCalled(); expect(f.premium.create).not.toHaveBeenCalled();
    } finally { controller.abort(); await stop(f.server); }
  });

  it("HTTP capacity admission also applies to Local-First while access resolution is pending", async () => {
    const gate = deferred<RoutingAccess>(), entered = deferred<void>();
    const f = fixture({ resolveAccess: async () => { entered.resolve(); return gate.promise; } }, 1);
    const url = await start(f.server);
    try {
      const first = post(url); await entered.promise;
      expect((await post(url, { text: localText })).status).toBe(503);
      gate.resolve({ access: "free", basis: "guest" });
      expect((await first).status).toBe(200);
      expect(f.records).toHaveLength(1);
    } finally { gate.resolve({ access: "unavailable", basis: "unresolved" }); await stop(f.server); }
  });

  it("in-flight SDK cancellation preserves the Premium channel with no repair or Free call", async () => {
    const entered = deferred<void>(), observed = deferred<PlanningProvenance>();
    const f = fixture({ onPlanningComplete: record => observed.resolve(record) });
    f.premium.create.mockImplementation((_params, options) => {
      entered.resolve();
      return new Promise((_resolve, reject) => options.signal.addEventListener("abort", () => reject(
        Object.assign(new Error("cancelled"), { name: "AbortError" })), { once: true }));
    });
    const url = await start(f.server); const controller = new AbortController();
    try {
      const pending = post(url, { text: aiText }, premiumToken, controller.signal).catch(() => undefined);
      await entered.promise; controller.abort(); await pending;
      expect(await observed.promise).toMatchObject({ cancelled: true, routingChannel: "premium", providerCallCount: 1, pipelineAttempts: 1 });
      expect(f.premium.create).toHaveBeenCalledTimes(1); expect(f.free.create).not.toHaveBeenCalled();
    } finally { controller.abort(); await stop(f.server); }
  });

  it("SDK timeout keeps its channel and does not fall back", async () => {
    const f = fixture();
    f.premium.create.mockRejectedValue(Object.assign(new Error("timeout"), { name: "APIConnectionTimeoutError" }));
    const url = await start(f.server);
    try {
      expect((await post(url, { text: aiText }, premiumToken)).status).toBe(502);
      expect(f.premium.create).toHaveBeenCalledTimes(1); expect(f.free.create).not.toHaveBeenCalled();
      expect(f.records[0]).toMatchObject({ routingChannel: "premium", providerCallCount: 1 });
    } finally { await stop(f.server); }
  });

  it("a request-bound router cannot be reused for a second planning request", async () => {
    const free = channel("free", 20);
    const resolver = vi.fn(async () => ({ access: "free" as const, basis: "guest" as const }));
    const router = new RequestProviderRouter({ free: free.binding }, resolver);
    const pipeline = new NluPipeline(undefined, undefined, undefined, new LocalFirstProvider(router));
    expect((await pipeline.planAsync(aiText, emptyContext())).status).toBe("plan");
    expect((await pipeline.planAsync(aiText, emptyContext())).status).toBe("provider_error");
    expect(free.create).toHaveBeenCalledTimes(1); expect(resolver).toHaveBeenCalledTimes(1);
  });
});
