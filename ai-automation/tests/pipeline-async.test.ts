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
