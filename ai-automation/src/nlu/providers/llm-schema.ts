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

// NOT: Projenin geri kalanı zod v3 API'sini (`import { z } from "zod"`)
// kullanır — bu DEĞİŞMEDİ. Bu dosyadaki şema, `zodOutputFormat`
// (Anthropic) ve `z.toJSONSchema` (Gemini'nin `responseJsonSchema`'sı
// için) gerektirdiğinden SADECE burada `zod/v4` kullanılıyor — bilinçli,
// dar kapsamlı bir istisna (bkz. claude-provider.ts'teki ilk not, Phase
// 4B). Phase 4D-2: bu şema artık TÜM LLM sağlayıcıları (Claude, Gemini,
// Groq, NVIDIA NIM) arasında PAYLAŞILIYOR — her biri kendi şeklini icat
// etmiyor.
import { z } from "zod/v4";
import { CAPABILITIES } from "../../capability-registry/registry.js";
import { normalizeTime } from "../turkish.js";
import type { ConversationContext, Entities, IntentResult, IntentType } from "../types.js";

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

const INTENT_TYPES: [IntentType, ...IntentType[]] = [
  "create_automation",
  "modify_automation",
  "explain_automation",
  "disable_automation",
  "enable_automation",
  "delete_automation",
  "not_understood",
];

/**
 * LLM'in üretmek ZORUNDA olduğu yapı — capability id İÇERMEZ. TÜM
 * sağlayıcılar (Claude, Gemini, Groq, NVIDIA NIM) bu AYNI şemaya karşı
 * doğrulanır; her sağlayıcı kendi şeklini icat ETMEZ.
 */
export const LlmPlanOutputSchema = z.object({
  intent: z.enum(INTENT_TYPES),
  confidence: z.number().min(0).max(1).optional(),
  trigger: z
    .object({
      semantic: z.string(),
      details: z.record(z.string(), z.unknown()).optional(),
    })
    .nullable(),
  steps: z.array(
    z.object({
      semantic: z.string(),
      message: z.string().nullable().optional(),
      details: z.record(z.string(), z.unknown()).optional(),
    })
  ),
  entities: z.array(z.object({ name: z.string(), value: z.string() })),
  missing: z.array(z.object({ field: z.string(), reason: z.string() })),
});

export type LlmPlanOutput = z.infer<typeof LlmPlanOutputSchema>;

/**
 * `LlmPlanOutputSchema`'nın standart JSON Schema karşılığı — Gemini'nin
 * `responseJsonSchema`'sı gibi Zod nesnesi DEĞİL, ham JSON Schema
 * bekleyen sağlayıcılar için. Zod v4'ün yerleşik `toJSONSchema`'sı
 * kullanılır; şema burada AYRICA elle yazılmaz.
 */
export const LlmPlanOutputJsonSchema = z.toJSONSchema(LlmPlanOutputSchema);

/**
 * TÜM sağlayıcılar için AYNI sistem promptu — her biri kendi promptunu
 * icat etmez, davranış farkı yalnızca hangi model/API'nin bu promptu ne
 * kadar iyi izlediğinden kaynaklanır (Phase 4D-2'nin ölçtüğü tam olarak
 * bu).
 */
export function systemPrompt(): string {
  const catalog = buildSemanticCatalog();
  const lines = catalog.map((c) => `- [${c.kind}] ${c.semantic}: ${c.description}`).join("\n");
  return [
    "Sen bir otomasyon uygulamasının niyet/varlık (intent/entity) çıkarım katmanısın.",
    "Kullanıcının Türkçe cümlesini SEMANTİK bir plana çevirirsin.",
    "",
    "KESİN KURAL: Yalnızca aşağıdaki semantik isimleri üretebilirsin.",
    "Bunlar dışında hiçbir platform/sistem id'si (nokta içeren, 'ios.'/'tesla.' gibi",
    "başlayan herhangi bir şey) ÜRETME — böyle bir şey görmüyorsun, bilmiyorsun.",
    "",
    "Bilinen semantik tetikleyiciler/eylemler:",
    lines,
    "",
    "Bir istek bu listedeki hiçbir semantiğe uymuyorsa `steps` boş kalabilir;",
    "asla uydurma bir semantik isim üretme.",
    "`missing` alanına, eylemi çalıştırmak için netleşmemiş ama gerekli olan",
    "alanları ekle (örn. bir araç eylemi için araç belirtilmemişse",
    '{field: "vehicle", reason: "required_for_vehicle_action"}).',
    "",
    "SAAT (ZAMAN) KURALI — Phase 4D-3, gerçek bir modelin bu hatayı",
    "yaptığı gözlemlendi: Türkçe saat ifadesinde sabah/öğle/öğleden",
    "sonra/akşam/gece gibi bir GÜN BÖLÜMÜ belirtilmemişse ve saat 1-12",
    "arasında (12 saatlik formatta) veriliyorsa, bu saat SABAH mı AKŞAM",
    "mı BİLİNMEZ. Böyle bir durumda:",
    "  ❌ 09:00 veya 21:00 gibi bir saat ASLA UYDURMA/TAHMİN ETME.",
    "  ❌ `entities` içine belirsiz bir saat değeri KOYMA.",
    '  ✅ `missing` alanına {field: "time_of_day", reason: "am_pm_ambiguous"} ekle.',
    'Örnek: "9\'da hatırlat" → gün bölümü YOK → belirsiz → missing\'e ekle.',
    'Örnek: "akşam 9\'da" / "sabah 9\'da" / "21\'de" → gün bölümü VEYA',
    "24 saatlik format zaten VAR → belirsizlik yok, saati normal üret.",
  ].join("\n");
}

export function userPrompt(input: string, context?: ConversationContext): string {
  const parts: string[] = [];
  if (context?.conversationTurns.length) {
    parts.push("Önceki konuşma turları:");
    for (const t of context.conversationTurns) parts.push(`${t.role}: ${t.text}`);
  }
  if (context?.lastIntent) {
    // Yalnızca SEMANTİK bir ipucu — context.lastIntent.trigger/steps zaten
    // capability id değil, semantik isim taşır (bkz. types.ts).
    parts.push(
      `Önceki tur için üretilmiş semantik plan (yalnızca ipucu, aynen tekrar etme gerekmez): ${JSON.stringify({
        trigger: context.lastIntent.trigger,
        steps: context.lastIntent.steps,
      })}`
    );
  }
  parts.push(`Kullanıcının şimdiki cümlesi: "${input}"`);
  return parts.join("\n");
}

/**
 * Doğrulanmış `LlmPlanOutput` → `IntentResult`. Tüm sağlayıcılar bunu
 * paylaşır. Bilinçli olarak SAF bir eşleme — Phase 4D-3'ün deterministik
 * güvenlik ağı (`hardenTemporalAmbiguity`) burada DEĞİL, `NluPipeline.
 * planAsync()`'te uygulanır: amaç "hangi `NluProvider` olursa olsun"
 * (bu fonksiyonu hiç çağırmayan, ileride yazılacak bir sağlayıcı dahil)
 * korunan bir invariant — tek bir paylaşılan yardımcıya gömülü,
 * atlanabilir bir kontrol DEĞİL.
 */
export function toIntentResult(out: LlmPlanOutput, sourceText: string): IntentResult {
  return {
    intent: out.intent,
    confidence: out.confidence ?? 0.75,
    trigger: out.trigger ? { type: out.trigger.semantic, details: out.trigger.details } : undefined,
    steps: out.steps.map((s) => ({ type: s.semantic, message: s.message, details: s.details })),
    entities: toEntities(out.entities),
    missing: out.missing,
    sourceText,
  };
}

/**
 * Phase 4D-3 — DETERMİNİSTİK güvenlik ağı (Katman 2), `NluPipeline.
 * planAsync()` tarafından her async sağlayıcının (hangi LLM/model
 * olursa olsun) çıktısına uygulanır. Prompttaki "SAAT KURALI" (Katman 1,
 * `systemPrompt()`) bir talimattır, GARANTİ değil — gerçek bir smoke
 * testte bir model, "9'da bana hatırlat" için ne clarification sordu ne
 * bir saat uydurdu: şema açısından geçerli ama saat bilgisi TAMAMEN EKSİK
 * bir `time` tetikleyicisi üretti. Bu fonksiyon LLM'e GÜVENMEDEN,
 * `sourceText`'i (hangi sağlayıcı olursa olsun aynı metin) kural tabanlı
 * `normalizeTime()` ile YENİDEN değerlendirir — modelin kendisi
 * değişse/iyileşse bile bu invariant kod tarafında sabit kalır.
 */
export function hardenTemporalAmbiguity(result: IntentResult): IntentResult {
  if (result.trigger?.type !== "time") return result;
  if (result.missing.some((m) => m.field === "time_of_day" || m.field === "time")) return result;

  const normalized = normalizeTime(result.sourceText);
  if (normalized === null) {
    return { ...result, missing: [...result.missing, { field: "time", reason: "required_for_time_trigger" }] };
  }
  if (normalized.ambiguous) {
    return { ...result, missing: [...result.missing, { field: "time_of_day", reason: "am_pm_ambiguous" }] };
  }
  return result;
}
