/**
 * Mimari karar (bu konuşmada kilitlendi): AI/NLU katmanı platforma özel
 * capability id'lerini ("ios.bluetooth.disconnected",
 * "tesla.sentry_mode.toggle") ASLA üretmez — yalnızca semantik isimler
 * üretir ("vehicle_departure", "vehicle_sentry_mode"). Bu isimlerin
 * gerçek capability'lere çözümlenmesi yalnızca
 * PlanBuilder/CapabilityRegistry'nin işidir.
 *
 * Bu, ürünün iOS + Android + Home Assistant + başka servislere
 * genişleyebilmesinin temel taşı: AI hiçbir zaman platforma özel bir
 * kelime öğrenmek zorunda kalmaz.
 *
 * `nlu-contract.test.ts`'teki "kaynak dosyada hardcode id yok" testi
 * STATIK bir kontroldü (kaynak kodu okur). Bu dosya aynı kuralı
 * ÇALIŞMA ZAMANINDA, gerçek IntentResult çıktıları üzerinden kilitler.
 */

import { describe, expect, it } from "vitest";
import { RuleBasedIntentExtractor } from "../src/nlu/rule-based.js";
import { CAPABILITIES } from "../src/capability-registry/registry.js";

const CAPABILITY_IDS = new Set(CAPABILITIES.map((c) => c.id));

/** Bir platforma özel capability id'si gibi mi görünüyor? (örn. "ios.x", "tesla.y") */
function looksLikeCapabilityId(semantic: string): boolean {
  return CAPABILITY_IDS.has(semantic) || /^(ios|android|tesla)\./.test(semantic);
}

const SAMPLE_INPUTS = [
  "Arabadan inince Tesla Model Y Sentry Mode'u aç.",
  "Arabadan inince Tesla Model Y kamerayı aç.",
  "Arabadan inince Tesla Model Y klimayı aç.",
  "Her akşam saat dokuzda bana ilacımı hatırlat.",
  "Pil yüzde yirmiye düşünce bana haber ver.",
  "Eve gelince ışıkları aç.",
  "Annem WhatsApp'tan yazınca bana bildir.",
  "Yarın sabah 9'da uyandır.",
  "Wifi Ev ağına bağlanınca müzik çal.",
];

describe("Mimari değişmez: IntentResult yalnızca semantik isim üretir, capability id ASLA", () => {
  const extractor = new RuleBasedIntentExtractor();

  it.each(SAMPLE_INPUTS)('"%s" için trigger.type bir capability id değil', (input) => {
    const intent = extractor.extract(input);
    if (intent.trigger) {
      expect(
        looksLikeCapabilityId(intent.trigger.type),
        `trigger.type="${intent.trigger.type}" bir capability id gibi görünüyor — semantik olmalı`
      ).toBe(false);
    }
  });

  it.each(SAMPLE_INPUTS)('"%s" için hiçbir step.type bir capability id değil', (input) => {
    const intent = extractor.extract(input);
    for (const step of intent.steps) {
      expect(
        looksLikeCapabilityId(step.type),
        `step.type="${step.type}" bir capability id gibi görünüyor — semantik olmalı`
      ).toBe(false);
    }
  });

  it("semantik isimler nokta içermez (capability id'lerin aksine)", () => {
    for (const input of SAMPLE_INPUTS) {
      const intent = extractor.extract(input);
      if (intent.trigger) expect(intent.trigger.type).not.toContain(".");
      for (const step of intent.steps) {
        if (!step.type.startsWith("unmapped:")) expect(step.type).not.toContain(".");
      }
    }
  });
});
