/**
 * Phase 4B — LLM'in ÜRETMESİ GEREKEN yapılandırılmış çıktının şeması ve
 * LLM'e verilecek semantik katalog.
 *
 * ⚠️ EN ÖNEMLİ KURAL (bu projenin tamamında tekrarlanan değişmez):
 * platforma özel capability id'leri LLM'e prompt/context olarak dahi
 * VERİLMEZ — yalnızca semantik isimler (kural tabanlı sağlayıcının
 * ürettiği türden, örn. `vehicle_departure`/`vehicle_sentry_mode`) görür
 * ve üretir. Bu dosya, registry'den yalnızca `semantic`/`kind`/
 * `description` alanlarını okuyarak bu katalogu üretir; `id` alanı asla
 * dışa aktarılmaz (bkz. tests/nlu-contract.test.ts — bu dosya da o
 * statik hardcode taramasına dahil).
 */

import { CAPABILITIES } from "../../capability-registry/registry.js";
import type { Entities } from "../types.js";

/** LLM'e gösterilecek TEK bir semantik giriş — capability id İÇERMEZ. */
export interface SemanticCatalogEntry {
  semantic: string;
  kind: "trigger" | "action";
  /** Kullanıcıya gösterilebilir, teknik olmayan açıklama. */
  description: string;
}

/**
 * Registry'deki tüm capability'lerden semantik katalogu türetir
 * (hardcode yok — registry değişirse katalog da değişir). Aynı semantik
 * ad birden fazla capability'ye karşılık gelebilir (örn. "vehicle_departure"
 * → CarPlay/Bluetooth/konum); katalogda yalnızca BİR kez görünür.
 */
export function buildSemanticCatalog(): SemanticCatalogEntry[] {
  const seen = new Set<string>();
  const out: SemanticCatalogEntry[] = [];
  for (const cap of CAPABILITIES) {
    if (!cap.semantic || seen.has(cap.semantic)) continue;
    seen.add(cap.semantic);
    out.push({ semantic: cap.semantic, kind: cap.kind, description: cap.description });
  }
  return out;
}

/** LLM'in üretebileceği, `Entities`'e eşlenecek düz anahtarlar. */
export const KNOWN_ENTITY_NAMES = [
  "vehicle",
  "device",
  "person",
  "application",
  "location",
  "time",
  "date",
  "wifiNetwork",
  "subject",
  "message",
  "batteryLevel",
  "condition",
] as const;

export type KnownEntityName = (typeof KNOWN_ENTITY_NAMES)[number];

/**
 * LLM'in düz `{name, value}[]` çıktısını, aşağı akışın (plan-builder.ts,
 * rule-based.ts'in `Entities` tüketicileri) beklediği tipli `Entities`
 * şekline çevirir. Bilinmeyen bir `name` sessizce yok sayılır — uydurma
 * alan eklenmez.
 */
export function toEntities(raw: Array<{ name: string; value: string }>): Entities {
  const e: Entities = {};
  for (const { name, value } of raw) {
    switch (name as KnownEntityName) {
      case "vehicle":
        e.vehicle = { value, raw: value };
        break;
      case "device":
        e.device = { value, raw: value };
        break;
      case "person":
        e.person = { value, raw: value };
        break;
      case "application":
        e.application = { value, raw: value };
        break;
      case "time":
        e.time = { value, raw: value };
        break;
      case "date":
        e.date = { value, raw: value };
        break;
      case "wifiNetwork":
        e.wifiNetwork = { value, raw: value };
        break;
      case "subject":
        e.subject = { value, raw: value };
        break;
      case "message":
        e.message = { value, raw: value };
        break;
      case "location":
        e.location = { value: { name: value }, raw: value };
        break;
      case "batteryLevel": {
        const n = Number(value);
        if (!Number.isNaN(n)) e.batteryLevel = { value: n, raw: value };
        break;
      }
      case "condition":
        if (value === "below" || value === "above" || value === "equals") {
          e.condition = { value, raw: value };
        }
        break;
      default:
        // Bilinmeyen alan: uydurma yapmadan yok sayılır.
        break;
    }
  }
  return e;
}
