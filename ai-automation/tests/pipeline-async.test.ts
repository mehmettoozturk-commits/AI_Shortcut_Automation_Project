/**
 * Phase 4B — async boru hattı testleri.
 *
 * `planAsync()`'in, senkron `plan()` ile AYNI paylaşılan mantığı
 * (`continueFromIntent`) kullandığını kanıtlar: varsayılan
 * `RuleBasedProvider` ile üretilen sonuç, senkron `plan()`'ınkiyle
 * birebir aynı olmalı. Ayrıca sağlayıcı hatasının (`LlmProviderError`)
 * `not_understood`/`unsupported` ile KARIŞTIRILMADAN ayrı bir
 * `provider_error` durumuna dönüştüğünü doğrular.
 *
 * Hiçbir test gerçek bir ağ çağrısı yapmaz (§14) — sahte bir
 * `NluProvider` enjekte edilir.
 */

import { describe, expect, it } from "vitest";
import { NluPipeline } from "../src/nlu/pipeline.js";
import type { NluProvider } from "../src/nlu/ports.js";
import { LlmProviderError } from "../src/nlu/providers/errors.js";
import { RuleBasedProvider } from "../src/nlu/providers/rule-based-provider.js";
import { emptyContext, type ConversationContext, type IntentResult } from "../src/nlu/types.js";

describe("planAsync — varsayılan (kural tabanlı) sağlayıcı, senkron plan() ile birebir aynı", () => {
  it("net bir cümle için aynı planı üretir", async () => {
    const input = "Arabadan inince Tesla Model Y'nin Sentry Mode'unu aç";
    const sync = new NluPipeline().plan(input, emptyContext());
    const async_ = await new NluPipeline().planAsync(input, emptyContext());
    expect(async_.status).toBe(sync.status);
    if (sync.status === "plan" && async_.status === "plan") {
      expect(JSON.stringify(async_.plan.steps)).toBe(JSON.stringify(sync.plan.steps));
      expect(async_.plan.trigger.type).toBe(sync.plan.trigger.type);
    }
  });

  it("kilitli senaryo: klima → 'Hangi araç?' → Tesla Model Y → 'Hayır, Model 3.' yalnızca aracı değiştirir", async () => {
    const pipeline = new NluPipeline();
    const ctx = emptyContext();

    const first = await pipeline.planAsync("Arabadan inince klimayı aç.", ctx);
    expect(first.status).toBe("needs_clarification");
    if (first.status !== "needs_clarification") return;
    expect(first.question.id).toBe("vehicle");

    // Cevap yolu (answerClarification) senkron kalır — LLM'e ihtiyaç
    // duymaz, bkz. docs/api.md Phase 4B eki.
    const second = pipeline.answerClarification("Tesla Model Y.", ctx);
    expect(second.status).toBe("plan");
    if (second.status !== "plan") return;
    expect(second.plan.trigger.device).toBe("Tesla Model Y");
    expect(JSON.stringify(second.plan.steps)).toContain("tesla.climate.start");

    const third = await pipeline.planAsync("Hayır, Model 3.", ctx);
    expect(third.status).toBe("plan");
    const plan = ctx.currentPlan!;
    expect(plan.trigger.device).toBe("Tesla Model 3");
    // Tetikleyici ve eylem KORUNUR — yalnızca araç değişti.
    expect(plan.trigger.type).toBe("ios.bluetooth.disconnected");
    expect(JSON.stringify(plan.steps)).toContain("tesla.climate.start");
  });
});

describe("planAsync — sağlayıcı hatası ayrı bir durumdur", () => {
  class FailingProvider implements NluProvider {
    async plan(): Promise<IntentResult> {
      throw new LlmProviderError("LLM isteği başarısız oldu (simüle edilmiş).");
    }
  }

  it("LlmProviderError, 'not_understood'/'unsupported' değil 'provider_error' olarak döner", async () => {
    const pipeline = new NluPipeline(undefined, undefined, undefined, new FailingProvider());
    const outcome = await pipeline.planAsync("herhangi bir şey", emptyContext());
    expect(outcome.status).toBe("provider_error");
    if (outcome.status === "provider_error") {
      expect(outcome.message).toContain("simüle edilmiş");
    }
  });

  class ThrowingNonLlmProvider implements NluProvider {
    async plan(): Promise<IntentResult> {
      throw new Error("beklenmeyen çökme");
    }
  }

  it("LlmProviderError dışındaki bir hata da güvenli biçimde provider_error'a düşer", async () => {
    const pipeline = new NluPipeline(undefined, undefined, undefined, new ThrowingNonLlmProvider());
    const outcome = await pipeline.planAsync("x", emptyContext());
    expect(outcome.status).toBe("provider_error");
  });
});

describe("RuleBasedProvider — NluProvider sınırının deterministik sağlayıcısı", () => {
  it("RuleBasedIntentExtractor ile aynı IntentResult'ı async olarak üretir", async () => {
    const provider = new RuleBasedProvider();
    const ctx: ConversationContext = emptyContext();
    const intent = await provider.plan("Arabadan inince Tesla Model Y Sentry Mode'u aç.", ctx);
    expect(intent.intent).toBe("create_automation");
    expect(intent.trigger?.type).toBe("vehicle_departure");
  });
});

describe("RH-01-T08..T14 — cancellation/timeout sözleşmesi", () => {
  const validIntent: IntentResult = {
    intent: "not_understood", confidence: 0.1, entities: {}, steps: [], missing: [],
  };

  it("T08: timeout/provider hatası provider_error olur", async () => {
    class TimeoutProvider implements NluProvider { async plan(): Promise<IntentResult> { throw new LlmProviderError("timeout", undefined, false, { errorCategory: "timeout", httpStatus: null }); } }
    const out = await new NluPipeline(undefined, undefined, undefined, new TimeoutProvider()).planAsync("x", emptyContext());
    expect(out.status).toBe("provider_error");
  });

  it("T09: timeout sonrası aynı pipeline yeniden kullanılabilir", async () => {
    let calls = 0;
    class Provider implements NluProvider { async plan(): Promise<IntentResult> { calls++; if (calls === 1) throw new LlmProviderError("timeout"); return validIntent; } }
    const p = new NluPipeline(undefined, undefined, undefined, new Provider());
    expect((await p.planAsync("x", emptyContext())).status).toBe("provider_error");
    expect((await p.planAsync("x", emptyContext())).status).toBe("not_understood");
  });

  it("T10: AbortSignal provider'a ulaşır", async () => {
    let received: AbortSignal | undefined;
    class Provider implements NluProvider { async plan(_i: string, _c?: ConversationContext, _r?: unknown, signal?: AbortSignal): Promise<IntentResult> { received = signal; return validIntent; } }
    const controller = new AbortController();
    await new NluPipeline(undefined, undefined, undefined, new Provider()).planAsync("x", emptyContext(), controller.signal);
    expect(received).toBe(controller.signal);
  });

  it("T11: iptal sonrası provider sonlanınca pipeline tekrar çağrılabilir", async () => {
    const controller = new AbortController(); let calls = 0;
    class Provider implements NluProvider { async plan(): Promise<IntentResult> { calls++; return validIntent; } }
    controller.abort();
    const out = await new NluPipeline(undefined, undefined, undefined, new Provider()).planAsync("x", emptyContext(), controller.signal);
    expect(out.status).toBe("not_understood");
    expect(calls).toBe(1);
  });

  it("T12: iptal edilen retryable denemede repair çağrısı yapılmaz", async () => {
    const controller = new AbortController(); let calls = 0;
    class Provider implements NluProvider { async plan(): Promise<IntentResult> { calls++; controller.abort(); throw new LlmProviderError("bad output", undefined, true); } }
    const out = await new NluPipeline(undefined, undefined, undefined, new Provider()).planAsync("x", emptyContext(), controller.signal);
    expect(out.status).toBe("provider_error"); expect(calls).toBe(1);
  });

  it("T13: OpenAI-compatible çağrı ikinci parametrede signal taşır", async () => {
    let options: { signal?: AbortSignal } | undefined;
    const client = { chat: { completions: { create: async (_p: Record<string, unknown>, o?: { signal?: AbortSignal }) => { options = o; return { choices: [{ message: { content: JSON.stringify({ intent: "not_understood", confidence: 0.1, trigger: { semantic: "time" }, steps: [{ semantic: "notify" }], entities: [], missing: [] }) } }] }; } } } };
    const controller = new AbortController();
    const { OpenAICompatibleIntentProvider } = await import("../src/nlu/providers/openai-compatible-provider.js");
    await new OpenAICompatibleIntentProvider({ client, baseURL: "https://example.invalid", model: "m", providerLabel: "T" }).plan("x", emptyContext(), undefined, controller.signal);
    expect(options?.signal).toBe(controller.signal);
  });

  it("T14: normal sinyal olmadan istek mevcut akışı korur", async () => {
    const out = await new NluPipeline().planAsync("zzz qqq", emptyContext());
    expect(out.status).toBe("not_understood");
  });
});
