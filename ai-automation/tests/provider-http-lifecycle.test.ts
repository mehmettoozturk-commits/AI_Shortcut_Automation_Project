import { createServer, type Server } from "node:http";
import { describe, expect, it } from "vitest";
import { createPlanServer } from "../src/api/server.js";
import { NluPipeline } from "../src/nlu/pipeline.js";
import { OpenAICompatibleIntentProvider } from "../src/nlu/providers/openai-compatible-provider.js";
import { RuleBasedProvider } from "../src/nlu/providers/rule-based-provider.js";
import { LlmProviderError } from "../src/nlu/providers/errors.js";
import type { NluProvider } from "../src/nlu/ports.js";

async function start(server: Server) {
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Missing address");
  return `http://127.0.0.1:${address.port}`;
}
async function stop(server: Server) {
  server.closeAllConnections();
  await new Promise<void>((resolve, reject) => server.close(e => e ? reject(e) : resolve()));
}
const text = "Pil yüzde 20 altına düşünce bildir";
const post = (url: string, signal?: AbortSignal) => fetch(`${url}/plan`, {
  method: "POST", headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ text }), signal,
});
const completion = { choices: [{ message: { content: JSON.stringify({
  intent: "create_automation", trigger: { semantic: "battery_below", details: { level: 20, condition: "below" } },
  steps: [{ semantic: "notify" }], entities: [{ name: "batteryLevel", value: "20" }, { name: "condition", value: "below" }], missing: [],
}) } }] };

describe("RH-01 real SDK and HTTP lifecycle", () => {
  it("T15: SDK timeout yields 502 and releases capacity", async () => {
    let calls = 0;
    const upstream = createServer((req, res) => {
      req.resume(); calls++;
      if (calls > 1) { res.setHeader("Content-Type", "application/json"); res.end(JSON.stringify(completion)); }
    });
    const upstreamURL = await start(upstream);
    const provider = new OpenAICompatibleIntentProvider({ apiKey: "test-only", baseURL: upstreamURL, model: "test", providerLabel: "Local", timeoutMs: 100 });
    const api = createPlanServer({ pipeline: new NluPipeline(undefined, undefined, undefined, provider), maxConcurrentPlans: 1 });
    const url = await start(api);
    try {
      const first = await post(url);
      expect(first.status).toBe(502);
      expect((await first.json()).status).toBe("provider_error");
      expect((await post(url)).status).toBe(200);
      expect(calls).toBe(2);
    } finally { await stop(api); await stop(upstream); }
  });

  it("T16: client disconnect aborts provider, keeps capacity until it ends, then recovers", async () => {
    let entered!: () => void; let aborted!: () => void; let release!: () => void;
    const entry = new Promise<void>(r => { entered = r; });
    const cancellation = new Promise<void>(r => { aborted = r; });
    const gate = new Promise<void>(r => { release = r; });
    let calls = 0;
    const provider: NluProvider = { async plan(input, context, _repair, signal) {
      calls++;
      if (calls === 1) {
        entered();
        await new Promise<void>(resolve => signal!.addEventListener("abort", () => { aborted(); resolve(); }, { once: true }));
        await gate;
        throw new LlmProviderError("Cancelled", undefined, true);
      }
      return new RuleBasedProvider().plan(input, context);
    } };
    const api = createPlanServer({ pipeline: new NluPipeline(undefined, undefined, undefined, provider), maxConcurrentPlans: 1 });
    const url = await start(api);
    const controller = new AbortController();
    try {
      const pending = post(url, controller.signal).catch(() => undefined);
      await entry; controller.abort(); await cancellation; await pending;
      expect((await post(url)).status).toBe(503);
      release();
      await new Promise<void>(r => setTimeout(r, 20));
      expect((await post(url)).status).toBe(200);
      expect(calls).toBe(2);
    } finally { release(); controller.abort(); await stop(api); }
  });

  it("T17: real SDK sends only one request on a retryable HTTP 500", async () => {
    let calls = 0;
    const upstream = createServer((req, res) => { req.resume(); calls++; res.writeHead(500, { "Content-Type": "application/json" }); res.end(JSON.stringify({ error: { message: "test" } })); });
    const url = await start(upstream);
    try {
      const provider = new OpenAICompatibleIntentProvider({ apiKey: "test-only", baseURL: url, model: "test", providerLabel: "Local", timeoutMs: 1000 });
      await expect(provider.plan(text)).rejects.toBeInstanceOf(LlmProviderError);
      expect(calls).toBe(1);
    } finally { await stop(upstream); }
  });
});
