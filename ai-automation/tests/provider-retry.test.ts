/**
 * Phase 4E-3 — Retry/Repair katmanı.
 *
 * Gerçek NVIDIA NIM'e tekrar tekrar gitmeden, gerçek smoke testte
 * gözlemlenen hataları (Phase 4D-2/4E-1) sahte, senaryolu bir
 * `NluProvider` ile DETERMİNİSTİK olarak yeniden üretir:
 *
 *   malformed "[trigger] ..."  → repair → geçerli  → başarı (1 repair)
 *   eksik eylem                → repair → geçerli  → başarı (1 repair)
 *   malformed                  → repair → hâlâ malformed → provider_error
 *   registry'de gerçekten yok  → (retry YOK) → unsupported
 *   ağ hatası (retryable:false)→ (retry YOK) → provider_error
 *
 * En kritik doğrulama: repair talimatı hiçbir GERÇEK capability id
 * içermez (`CAPABILITIES` listesindeki hiçbir id, modelin ÖNCEKİ
 * (geçersiz) çıktısı yanlışlıkla bir id'ye denk gelmiş olsa bile geri
 * gönderilmez) VE en fazla İKİ sağlayıcı çağrısı yapılır (1 orijinal +
 * 1 repair) — "ne pahasına olursa olsun düzeltme" YOK.
 */

import { describe, expect, it } from "vitest";
import { NluPipeline } from "../src/nlu/pipeline.js";
import type { NluProvider, RepairHint } from "../src/nlu/ports.js";
import { LlmProviderError } from "../src/nlu/providers/errors.js";
import { CAPABILITIES } from "../src/capability-registry/registry.js";
import { emptyContext, type ConversationContext, type IntentResult } from "../src/nlu/types.js";

/** Her çağrıda sırayla bir sonraki script adımını çalıştıran sahte sağlayıcı. */
class ScriptedProvider implements NluProvider {
  public readonly calls: Array<{ input: string; repair?: RepairHint }> = [];
  constructor(private readonly script: Array<() => IntentResult>) {}

  async plan(input: string, _context?: ConversationContext, repair?: RepairHint): Promise<IntentResult> {
    this.calls.push({ input, repair });
    const step = this.script[this.calls.length - 1];
    if (!step) throw new Error("script tükendi — beklenenden fazla çağrı yapıldı");
    return step();
  }
}

function noCapabilityIdLeaks(text: string): void {
  for (const cap of CAPABILITIES) {
    expect(text, `repair talimatı capability id içeriyor: ${cap.id}`).not.toContain(cap.id);
  }
}

describe("Phase 4E-3 — retry/repair: malformed → repair → geçerli", () => {
  it("'[trigger] ' önek sızıntısı: ilk deneme geçersiz, repair sonrası geçerli plana ulaşır", async () => {
    const provider = new ScriptedProvider([
      () => ({
        intent: "create_automation",
        confidence: 0.8,
        trigger: { type: "[trigger] vehicle_departure" },
        steps: [{ type: "vehicle_sentry_mode" }],
        entities: {},
        missing: [],
        sourceText: "x",
      }),
      () => ({
        intent: "create_automation",
        confidence: 0.9,
        trigger: { type: "vehicle_departure" },
        steps: [{ type: "vehicle_sentry_mode" }],
        entities: { vehicle: { value: "Tesla Model Y", raw: "Tesla Model Y" } },
        missing: [],
        sourceText: "x",
      }),
    ]);
    const pipeline = new NluPipeline(undefined, undefined, undefined, provider);

    const outcome = await pipeline.planAsync("Arabadan inince Tesla Model Y'nin Sentry Mode'unu aç.", emptyContext());

    expect(outcome.status).toBe("plan");
    expect(provider.calls).toHaveLength(2);
    expect(provider.calls[1]!.repair).toBeDefined();
    noCapabilityIdLeaks(provider.calls[1]!.repair!.instruction);
    expect(pipeline.retryMetrics).toEqual({ firstPassSuccess: 0, repairSuccess: 1, providerError: 0 });
  });

  it("eksik eylem: ilk deneme boş steps, repair sonrası eylem doğru üretilir", async () => {
    const provider = new ScriptedProvider([
      () => ({
        intent: "create_automation",
        confidence: 0.8,
        trigger: { type: "vehicle_departure" },
        steps: [],
        entities: { vehicle: { value: "Tesla Model Y", raw: "Tesla Model Y" } },
        missing: [],
        sourceText: "x",
      }),
      () => ({
        intent: "create_automation",
        confidence: 0.9,
        trigger: { type: "vehicle_departure" },
        steps: [{ type: "vehicle_sentry_mode" }],
        entities: { vehicle: { value: "Tesla Model Y", raw: "Tesla Model Y" } },
        missing: [],
        sourceText: "x",
      }),
    ]);
    const pipeline = new NluPipeline(undefined, undefined, undefined, provider);

    const outcome = await pipeline.planAsync("Arabadan inince Tesla Model Y'nin Sentry Mode'unu aç.", emptyContext());

    expect(outcome.status).toBe("plan");
    expect(provider.calls).toHaveLength(2);
    noCapabilityIdLeaks(provider.calls[1]!.repair!.instruction);
    expect(pipeline.retryMetrics.repairSuccess).toBe(1);
  });

  it("şema/JSON hatası (retryable LlmProviderError) da repair sonrası kurtarılabilir", async () => {
    let call = 0;
    const provider: NluProvider = {
      async plan(_input, _context, repair) {
        call++;
        if (call === 1) throw new LlmProviderError("Model boş içerik döndürdü.", undefined, true);
        expect(repair).toBeDefined();
        return {
          intent: "create_automation",
          confidence: 0.9,
          trigger: { type: "vehicle_departure" },
          steps: [{ type: "vehicle_sentry_mode" }],
          entities: {},
          missing: [],
          sourceText: "x",
        };
      },
    };
    const pipeline = new NluPipeline(undefined, undefined, undefined, provider);
    const outcome = await pipeline.planAsync("x", emptyContext());
    expect(outcome.status).not.toBe("provider_error");
    expect(call).toBe(2);
    expect(pipeline.retryMetrics.repairSuccess).toBe(1);
  });
});

describe("Phase 4E-3 — retry/repair: hâlâ hatalı → provider_error (en fazla 1 repair)", () => {
  it("malformed → repair → HÂLÂ malformed → provider_error (yalnızca 2 çağrı, sonsuz döngü yok)", async () => {
    const provider = new ScriptedProvider([
      () => ({
        intent: "create_automation",
        confidence: 0.8,
        trigger: { type: "[trigger] vehicle_departure" },
        steps: [{ type: "vehicle_sentry_mode" }],
        entities: {},
        missing: [],
        sourceText: "x",
      }),
      () => ({
        intent: "create_automation",
        confidence: 0.8,
        trigger: { type: "[trigger] vehicle_departure" }, // hâlâ bozuk
        steps: [{ type: "vehicle_sentry_mode" }],
        entities: {},
        missing: [],
        sourceText: "x",
      }),
    ]);
    const pipeline = new NluPipeline(undefined, undefined, undefined, provider);

    const outcome = await pipeline.planAsync("x", emptyContext());

    expect(outcome.status).toBe("provider_error");
    expect(provider.calls).toHaveLength(2); // TAM OLARAK 2 — üçüncü bir deneme YOK
    expect(pipeline.retryMetrics).toEqual({ firstPassSuccess: 0, repairSuccess: 0, providerError: 1 });
  });
});

describe("Phase 4E-3 — retry NE ZAMAN tetiklenmemeli", () => {
  it("geçerli semantik ama registry'de desteklenmeyen istek: retry YOK, doğrudan unsupported", async () => {
    const provider = new ScriptedProvider([
      () => ({
        intent: "create_automation",
        confidence: 0.9,
        trigger: { type: "vehicle_departure" },
        steps: [{ type: "vehicle_camera" }], // katalogda GERÇEK bir semantik, registry'de desteklenmiyor
        entities: {},
        missing: [],
        sourceText: "x",
      }),
    ]);
    const pipeline = new NluPipeline(undefined, undefined, undefined, provider);

    const outcome = await pipeline.planAsync("Arabadan inince kamerayı aç.", emptyContext());

    expect(outcome.status).toBe("unsupported");
    expect(provider.calls).toHaveLength(1); // retry TETİKLENMEDİ
    expect(pipeline.retryMetrics).toEqual({ firstPassSuccess: 1, repairSuccess: 0, providerError: 0 });
  });

  it("retryable OLMAYAN bir sağlayıcı hatası (ağ/timeout) hiç retry edilmez", async () => {
    let calls = 0;
    const countingProvider: NluProvider = {
      async plan() {
        calls++;
        throw new LlmProviderError("Bağlantı zaman aşımına uğradı.", undefined, false);
      },
    };
    const countingPipeline = new NluPipeline(undefined, undefined, undefined, countingProvider);

    const outcome = await countingPipeline.planAsync("x", emptyContext());

    expect(outcome.status).toBe("provider_error");
    expect(calls).toBe(1); // retry TETİKLENMEDİ
    expect(countingPipeline.retryMetrics).toEqual({ firstPassSuccess: 0, repairSuccess: 0, providerError: 1 });
  });
});
