/**
 * Phase 4E-1 — Semantic Completeness / Malformed-Semantic Validation.
 *
 * Gerçek bir NVIDIA NIM smoke testinde (Phase 4D-2/4D-3) gözlemlenen iki
 * ayrı, temporal olmayan hata:
 *
 *   1. Model, sistem promptundaki katalog satırının `"[trigger] "`/
 *      `"[action] "` önekini semantik alana kopyaladı
 *      (`"[trigger] vehicle_departure"`). Registry'de böyle bir semantik
 *      yok — sessizce bırakılırsa "tetikleyici bulunamadı" gibi bir
 *      business-logic "unsupported" mesajına düşer, oysa bu bir PROVIDER
 *      hatasıdır.
 *   2. Model `create_automation` + geçerli bir tetikleyici üretti ama
 *      `steps` tamamen BOŞTU — eylemi unuttu.
 *
 * Bu dosya, `checkSemanticCompleteness` (LLM → Schema → BURASI →
 * Registry) ve `NluPipeline.planAsync()`'e kablolanışını doğrular: her
 * ikisi de sessizce "unsupported"a düşmek yerine `provider_error` olarak
 * raporlanır.
 */

import { describe, expect, it } from "vitest";
import { ClaudeIntentProvider, type ClaudeMessagesClient } from "../src/nlu/providers/claude-provider.js";
import { checkSemanticCompleteness } from "../src/nlu/providers/llm-schema.js";
import { NluPipeline } from "../src/nlu/pipeline.js";
import { emptyContext, type IntentResult } from "../src/nlu/types.js";

function fakeClaudeClient(parsed_output: unknown): ClaudeMessagesClient {
  return { messages: { parse: async () => ({ parsed_output }) } };
}

function pipelineWithClaudeFake(parsed_output: unknown): NluPipeline {
  return new NluPipeline(undefined, undefined, undefined, new ClaudeIntentProvider({ client: fakeClaudeClient(parsed_output) }));
}

describe("checkSemanticCompleteness — birim testleri", () => {
  it("katalogdaki gerçek bir semantik için null döner (geçerli)", () => {
    const intent: IntentResult = {
      intent: "create_automation",
      confidence: 0.9,
      trigger: { type: "vehicle_departure" },
      steps: [{ type: "vehicle_sentry_mode" }],
      entities: {},
      missing: [],
      sourceText: "x",
    };
    expect(checkSemanticCompleteness(intent)).toBeNull();
  });

  it("katalog satırı önekini (\"[trigger] \") kopyalayan bir tetikleyiciyi reddeder", () => {
    const intent: IntentResult = {
      intent: "create_automation",
      confidence: 0.8,
      trigger: { type: "[trigger] vehicle_departure" },
      steps: [{ type: "vehicle_sentry_mode" }],
      entities: {},
      missing: [],
      sourceText: "x",
    };
    expect(checkSemanticCompleteness(intent)).toContain("[trigger] vehicle_departure");
  });

  it("katalog satırı önekini (\"[action] \") kopyalayan bir eylemi reddeder", () => {
    const intent: IntentResult = {
      intent: "create_automation",
      confidence: 0.8,
      trigger: { type: "vehicle_departure" },
      steps: [{ type: "[action] vehicle_sentry_mode" }],
      entities: {},
      missing: [],
      sourceText: "x",
    };
    expect(checkSemanticCompleteness(intent)).toContain("[action] vehicle_sentry_mode");
  });

  it("tamamen uydurma/bilinmeyen bir semantik ismi de reddeder", () => {
    const intent: IntentResult = {
      intent: "create_automation",
      confidence: 0.8,
      trigger: { type: "vehicle_departure" },
      steps: [{ type: "vehicle_teleport" }],
      entities: {},
      missing: [],
      sourceText: "x",
    };
    expect(checkSemanticCompleteness(intent)).toContain("vehicle_teleport");
  });

  it("create_automation + geçerli tetikleyici + BOŞ steps'i reddeder", () => {
    const intent: IntentResult = {
      intent: "create_automation",
      confidence: 0.8,
      trigger: { type: "vehicle_departure" },
      steps: [],
      entities: {},
      missing: [],
      sourceText: "x",
    };
    expect(checkSemanticCompleteness(intent)).toContain("hiçbir eylem üretmedi");
  });

  it("not_understood için boş trigger/steps GEÇERLİDİR (reddedilmez)", () => {
    const intent: IntentResult = {
      intent: "not_understood",
      confidence: 0.1,
      steps: [],
      entities: {},
      missing: [],
      sourceText: "zxcv qwer",
    };
    expect(checkSemanticCompleteness(intent)).toBeNull();
  });

  it("rule-based'in 'unmapped:' konvansiyonu istisnadır (reddedilmez)", () => {
    const intent: IntentResult = {
      intent: "create_automation",
      confidence: 0.5,
      trigger: { type: "vehicle_departure" },
      steps: [{ type: "unmapped:ışıkları_aç" }],
      entities: {},
      missing: [],
      sourceText: "x",
    };
    expect(checkSemanticCompleteness(intent)).toBeNull();
  });

  it("tetikleyici olmayan (undefined) bir create_automation'ı boş steps için reddetmez (trigger yoksa bu kontrol devre dışı)", () => {
    const intent: IntentResult = {
      intent: "create_automation",
      confidence: 0.5,
      steps: [],
      entities: {},
      missing: [],
      sourceText: "x",
    };
    expect(checkSemanticCompleteness(intent)).toBeNull();
  });
});

describe("planAsync — semantic completeness ihlali provider_error olarak döner (unsupported ile KARIŞTIRILMAZ)", () => {
  it("'[trigger] ' önek sızıntısı → provider_error", async () => {
    const pipeline = pipelineWithClaudeFake({
      intent: "create_automation",
      trigger: { semantic: "[trigger] vehicle_departure" },
      steps: [{ semantic: "vehicle_sentry_mode" }],
      entities: [],
      missing: [],
    });
    const outcome = await pipeline.planAsync("Arabadan inince Sentry Mode'u aç.", emptyContext());
    expect(outcome.status).toBe("provider_error");
  });

  it("create_automation + trigger + boş steps → provider_error (unsupported DEĞİL)", async () => {
    const pipeline = pipelineWithClaudeFake({
      intent: "create_automation",
      trigger: { semantic: "vehicle_departure" },
      steps: [],
      entities: [],
      missing: [],
    });
    const outcome = await pipeline.planAsync("Arabadan inince bir şey yap.", emptyContext());
    expect(outcome.status).toBe("provider_error");
  });

  it("geçerli, tam bir semantik plan hâlâ normal şekilde ilerler (yanlış pozitif yok)", async () => {
    const pipeline = pipelineWithClaudeFake({
      intent: "create_automation",
      trigger: { semantic: "vehicle_departure" },
      steps: [{ semantic: "vehicle_sentry_mode" }],
      entities: [{ name: "vehicle", value: "Tesla Model Y" }],
      missing: [],
    });
    const outcome = await pipeline.planAsync("Arabadan inince Tesla Model Y'nin Sentry Mode'unu aç.", emptyContext());
    expect(outcome.status).toBe("plan");
  });

  it("gerçek 'unsupported' (registry'de karşılığı olmayan ama GEÇERLİ bir semantik) hâlâ unsupported kalır", async () => {
    const pipeline = pipelineWithClaudeFake({
      intent: "create_automation",
      trigger: { semantic: "vehicle_departure" },
      steps: [{ semantic: "vehicle_camera" }],
      entities: [],
      missing: [],
    });
    const outcome = await pipeline.planAsync("Arabadan inince kamerayı aç.", emptyContext());
    expect(outcome.status).toBe("unsupported");
  });
});
