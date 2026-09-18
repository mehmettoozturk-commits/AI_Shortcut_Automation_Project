/**
 * Phase 2 sözleşme testleri.
 *
 * Buradaki testler NLU katmanının kendi başına karar VERMEDİĞİNİ
 * kanıtlar: capability kararı registry'ye, çalıştırılabilirlik kararı
 * validator zincirine aittir.
 */

import { afterEach, describe, expect, it } from "vitest";
import { NluPipeline } from "../src/nlu/pipeline.js";
import { RuleBasedIntentExtractor } from "../src/nlu/rule-based.js";
import { emptyContext } from "../src/nlu/types.js";
import { CAPABILITIES, findCapability } from "../src/capability-registry/registry.js";
import { runValidationPipeline } from "../src/validators/pipeline.js";
import { checkRegistryContract } from "../src/compiler/contract.js";

/* ================================================================
   TEST 1 — Capability hardcode testi
   Registry'deki eşleme değişince NLU eski capability id'sini
   ÜRETEMEMELİ. Üretiyorsa, id bir yere hardcode edilmiş demektir.
   ================================================================ */

describe("Registry source-of-truth: capability id'leri AI katmanında hardcode DEĞİL", () => {
  const sentry = findCapability("tesla.sentry_mode.toggle")!;
  const originalKeywords = [...(sentry.nluKeywords ?? [])];
  const originalSemantic = sentry.semantic;

  afterEach(() => {
    sentry.nluKeywords = [...originalKeywords];
    sentry.semantic = originalSemantic;
  });

  it("temel durum: registry eşlemesi yerindeyken Sentry Mode üretilir", () => {
    const outcome = new NluPipeline().plan("Arabadan inince Tesla Model Y Sentry Mode'u aç.", emptyContext());
    expect(outcome.status).toBe("plan");
    if (outcome.status === "plan") {
      expect(JSON.stringify(outcome.plan.steps)).toContain("tesla.sentry_mode.toggle");
    }
  });

  it("registry'den anahtar kelime kaldırılınca NLU o capability'yi ARTIK üretemez", () => {
    sentry.nluKeywords = [];
    const outcome = new NluPipeline().plan("Arabadan inince Tesla Model Y Sentry Mode'u aç.", emptyContext());
    if (outcome.status === "plan") {
      expect(JSON.stringify(outcome.plan.steps)).not.toContain("tesla.sentry_mode.toggle");
    } else {
      // Eşleme olmadığı için desteklenmeyen/anlaşılmayan sonuç beklenir
      expect(["unsupported", "not_understood"]).toContain(outcome.status);
    }
  });

  it("registry'de anahtar kelime başka capability'ye taşınınca NLU onu üretir", () => {
    sentry.nluKeywords = [];
    const climate = findCapability("tesla.climate.start")!;
    const climateOriginal = [...(climate.nluKeywords ?? [])];
    climate.nluKeywords = [...climateOriginal, "sentry"];

    const outcome = new NluPipeline().plan("Arabadan inince Tesla Model Y Sentry Mode'u aç.", emptyContext());
    if (outcome.status === "plan") {
      expect(JSON.stringify(outcome.plan.steps)).toContain("tesla.climate.start");
    }
    climate.nluKeywords = climateOriginal;
  });

  it("alternatifler registry'den gelir: bir alternatif kaldırılınca listeden düşer", () => {
    const climate = findCapability("tesla.climate.start")!;
    const original = climate.availableInShortcuts;
    climate.availableInShortcuts = false;

    const outcome = new NluPipeline().plan("Arabadan inince Tesla Model Y kamerayı aç.", emptyContext());
    if (outcome.status === "unsupported") {
      expect(outcome.alternatives.map((a) => a.id)).not.toContain("tesla.climate.start");
      expect(outcome.alternatives.map((a) => a.id)).toContain("tesla.sentry_mode.toggle");
    }
    climate.availableInShortcuts = original;
  });

  it("AI katmanı kaynak dosyalarında capability id'si hardcode edilmemiş", async () => {
    const { readFileSync } = await import("node:fs");
    for (const file of ["src/nlu/rule-based.ts", "src/nlu/pipeline.ts", "src/nlu/plan-builder.ts"]) {
      const source = readFileSync(file, "utf8");
      // Registry'deki TÜM capability id'leri aranır — tesla.* ve ios.*
      // dahil. Hiçbiri AI katmanında geçmemeli.
      const hits = CAPABILITIES.map((c) => c.id).filter((id) => source.includes(id));
      expect(hits, `${file} içinde hardcode capability id bulundu`).toEqual([]);
    }
  });
});

/* ================================================================
   TEST 2 — Context preservation (çok turlu)
   ================================================================ */

describe("Context preservation: çok turlu akışta önceki bilgiler silinmez", () => {
  it("klima → 'Hangi araç?' → Model Y → sonra 'Hayır, Model 3.'", () => {
    const pipeline = new NluPipeline();
    const ctx = emptyContext();

    // 1. tur: eylem belli, araç belli değil
    const first = pipeline.plan("Arabadan inince klimayı aç.", ctx);
    expect(first.status).toBe("needs_clarification");
    if (first.status === "needs_clarification") {
      expect(first.question.id).toBe("vehicle");
      expect(first.question.question).toContain("Hangi aracı");
    }

    // 2. tur: cevap
    const second = pipeline.answerClarification("Tesla Model Y.", ctx);
    expect(second.status).toBe("plan");
    if (second.status === "plan") {
      expect(second.plan.trigger.device).toBe("Tesla Model Y");
      expect(second.plan.trigger.type).toBe("ios.bluetooth.disconnected");
      expect(JSON.stringify(second.plan.steps)).toContain("tesla.climate.start");
    }

    // 3. tur: düzeltme — yalnızca araç değişmeli
    const third = pipeline.plan("Hayır, Model 3.", ctx);
    expect(third.intent.intent).toBe("modify_automation");
    const plan = ctx.currentPlan!;
    expect(plan.trigger.device).toBe("Tesla Model 3");
    // Önceki bilgiler korunuyor:
    expect(plan.trigger.type).toBe("ios.bluetooth.disconnected");
    expect(JSON.stringify(plan.steps)).toContain("tesla.climate.start");
    expect(JSON.stringify(plan.steps)).not.toContain("tesla.sentry_mode.toggle");
  });

  it("düzeltme, cevaplanmış eksik bilgileri sıfırlamaz", () => {
    const pipeline = new NluPipeline();
    const ctx = emptyContext();
    pipeline.plan("Arabadan inince klimayı aç.", ctx);
    pipeline.answerClarification("Tesla Model Y.", ctx);
    pipeline.plan("Hayır, Model 3.", ctx);
    expect(ctx.currentPlan!.answers.vehicle).toBeDefined();
  });

  it("bağlam turları biriktirir", () => {
    const pipeline = new NluPipeline();
    const ctx = emptyContext();
    pipeline.plan("Arabadan inince klimayı aç.", ctx);
    pipeline.answerClarification("Tesla Model Y.", ctx);
    pipeline.plan("Hayır, Model 3.", ctx);
    expect(ctx.conversationTurns.length).toBe(3);
    expect(ctx.originalInput).toContain("klimayı");
  });
});

/* ================================================================
   TEST 3 — AM/PM belirsizliği
   ================================================================ */

describe("AM/PM: belirsizken ASLA 09:00 veya 21:00 'a karar verilmez", () => {
  it("\"9'da hatırlat\" kesin bir saat üretmez, soru üretir", () => {
    const ctx = emptyContext();
    const outcome = new NluPipeline().plan("9'da ilacımı hatırlat.", ctx);
    expect(outcome.status).toBe("needs_clarification");
    if (outcome.status === "needs_clarification") {
      expect(outcome.question.question).toContain("Sabah 9 mu");
      expect(outcome.question.options).toEqual(["Sabah", "Akşam"]);
    }
  });

  it("belirsizlik çözülmeden plan kesinleşmez", () => {
    const ctx = emptyContext();
    new NluPipeline().plan("9'da ilacımı hatırlat.", ctx);
    // Plan taslakta var ama time_of_day sorusu cevaplanmamış durumda
    expect(ctx.lastMissingField).toBe("time_of_day");
    const i = new RuleBasedIntentExtractor().extract("9'da ilacımı hatırlat.");
    expect(i.entities.time?.ambiguous).toBe(true);
    expect(i.missing.map((m) => m.field)).toContain("time_of_day");
  });

  it("kullanıcı 'Akşam' derse 21:00, 'Sabah' derse 09:00 olur", () => {
    const morning = new NluPipeline();
    const ctxM = emptyContext();
    morning.plan("9'da ilacımı hatırlat.", ctxM);
    morning.answerClarification("Sabah", ctxM);
    expect((ctxM.currentPlan!.trigger.params as { time?: string }).time).toBe("09:00");

    const evening = new NluPipeline();
    const ctxE = emptyContext();
    evening.plan("9'da ilacımı hatırlat.", ctxE);
    evening.answerClarification("Akşam", ctxE);
    expect((ctxE.currentPlan!.trigger.params as { time?: string }).time).toBe("21:00");
  });
});

/* ================================================================
   Validation pipeline bypass testleri
   ================================================================ */

describe("Validation bypass: NLU çıktısı doğrulama zincirini atlayamaz", () => {
  it("NLU planı Schema/Capability/Permission/Safety zincirinden geçirilebilir", () => {
    const outcome = new NluPipeline().plan("Arabadan inince Tesla Model Y Sentry Mode'u aç.", emptyContext());
    if (outcome.status !== "plan") throw new Error("plan beklenirdi");
    const result = runValidationPipeline(
      { name: outcome.plan.name, trigger: { type: outcome.plan.trigger.type }, steps: outcome.plan.steps },
      { platform: "ios", grantedPermissions: ["bluetooth", "tesla_account"] }
    );
    expect(result.ok).toBe(true);
    expect(result.stage).toBe("complete");
  });

  it("NLU riskli eylemi onaysız bırakırsa Safety Validator YAKALAR", () => {
    // NLU'nun ürettiği plandan onay adımı çıkarılırsa zincir reddetmeli.
    const outcome = new NluPipeline().plan("Arabadan inince Tesla Model Y Sentry Mode'u aç.", emptyContext());
    if (outcome.status !== "plan") throw new Error("plan beklenirdi");
    const stripped = { name: "x", trigger: { type: "ios.bluetooth.disconnected" }, steps: [{ type: "tesla.sentry_mode.toggle" }] };
    const result = runValidationPipeline(stripped, { platform: "ios", grantedPermissions: ["bluetooth", "tesla_account"] });
    expect(result.ok).toBe(false);
    expect(result.issues.some((i) => i.code === "unconfirmed_risky_action")).toBe(true);
  });

  it("izin verilmemişse NLU planı da geçemez", () => {
    const outcome = new NluPipeline().plan("Arabadan inince Tesla Model Y Sentry Mode'u aç.", emptyContext());
    if (outcome.status !== "plan") throw new Error("plan beklenirdi");
    const result = runValidationPipeline(
      { name: outcome.plan.name, trigger: { type: outcome.plan.trigger.type }, steps: outcome.plan.steps },
      { platform: "ios", grantedPermissions: [] }
    );
    expect(result.ok).toBe(false);
    expect(result.issues.some((i) => i.code === "missing_permission")).toBe(true);
  });

  it("NLU'nun ürettiği her plan şema olarak geçerlidir", () => {
    const inputs = [
      "Arabadan inince Tesla Model Y Sentry Mode'u aç.",
      "Pil yüzde yirmiye düşünce bana haber ver.",
      "Her akşam saat dokuzda bana hatırlat.",
    ];
    for (const input of inputs) {
      const outcome = new NluPipeline().plan(input, emptyContext());
      const plan = outcome.status === "plan" ? outcome.plan : outcome.status === "needs_clarification" ? null : null;
      if (!plan) continue;
      const result = runValidationPipeline(
        { name: plan.name, trigger: { type: plan.trigger.type }, steps: plan.steps },
        { platform: "ios", grantedPermissions: ["bluetooth", "tesla_account", "notifications"] }
      );
      expect(result.stage, input).not.toBe("schema");
    }
  });
});

/* ================================================================
   Registry sözleşmesi hâlâ sağlam
   ================================================================ */

describe("Registry sözleşmesi Phase 2 eklemelerinden sonra da geçerli", () => {
  it("sözleşme ihlali yok", () => {
    expect(checkRegistryContract()).toEqual([]);
  });

  it("NLU eşlemesi olan her capability semantic ve nluKeywords taşır", () => {
    const withSemantic = CAPABILITIES.filter((c) => c.semantic);
    expect(withSemantic.length).toBeGreaterThan(10);
    for (const cap of withSemantic) {
      expect(cap.nluKeywords, cap.id).toBeDefined();
      expect(cap.nluKeywords!.length, cap.id).toBeGreaterThan(0);
    }
  });
});
