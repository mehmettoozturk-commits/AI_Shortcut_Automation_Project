/**
 * Kural tabanlı sağlayıcı (Phase 2).
 *
 * ⚠️ DÜRÜSTLÜK NOTU: Bu bir LLM değil, Türkçe örüntülere dayanan
 * deterministik bir sağlayıcıdır. `IntentExtractor` / `EntityExtractor`
 * arayüzlerini uyguladığı için, ileride bir LLM sağlayıcısıyla
 * değiştirilebilir; boru hattı, capability eşlemesi ve UI değişmez.
 * Deterministik olması testlerin harici API'ye bağımlı olmamasını sağlar
 * (§14).
 */

import { CAPABILITIES } from "../capability-registry/registry.js";
import type { EntityExtractor, IntentExtractor } from "./ports.js";
import { lower, normalizeDate, normalizeRecurrence, normalizeTime, parseTurkishNumber } from "./turkish.js";
import type {
  ConversationContext,
  Entities,
  IntentResult,
  IntentType,
  MissingEntity,
  SemanticStep,
  SemanticTrigger,
} from "./types.js";

/* ---------------- yardımcılar ---------------- */

/** Registry'deki nluKeywords üzerinden semantik eşleme (hardcode id yok). */
function matchSemantic(text: string, kind: "trigger" | "action"): { semantic: string; hit: string } | null {
  const t = lower(text);
  let best: { semantic: string; hit: string } | null = null;
  for (const cap of CAPABILITIES) {
    if (cap.kind !== kind || !cap.semantic || !cap.nluKeywords) continue;
    for (const kw of cap.nluKeywords) {
      if (t.includes(lower(kw))) {
        // En uzun anahtar kelime kazanır: "arabadan in" > "bluetooth"
        if (!best || kw.length > best.hit.length) best = { semantic: cap.semantic, hit: kw };
      }
    }
  }
  return best;
}

const CORRECTION_PATTERNS = [
  /\bdeğil\b/,
  /\byerine\b/,
  /^hayır\b/,
  /\bolsun\b/,
  /\bdüzelt\b/,
  /\bşöyle yap\b/,
];

const INTENT_PATTERNS: Array<{ intent: IntentType; re: RegExp }> = [
  { intent: "delete_automation", re: /\b(sil|kaldır|iptal et)\b/ },
  { intent: "disable_automation", re: /\b(kapat|durdur|devre dışı)\b/ },
  { intent: "enable_automation", re: /\b(tekrar aç|etkinleştir|devreye al)\b/ },
  { intent: "explain_automation", re: /\b(nasıl çalışıyor|ne yapıyor|açıkla|anlat bana)\b/ },
];

/* ---------------- entity extractor ---------------- */

export class RuleBasedEntityExtractor implements EntityExtractor {
  extract(input: string, context?: ConversationContext): Entities {
    const t = lower(input);
    const e: Entities = { ...(context?.selectedEntities ?? {}) };

    const time = normalizeTime(input);
    if (time) e.time = time;

    const recurrence = normalizeRecurrence(input);
    if (recurrence) e.recurrence = recurrence;

    const date = normalizeDate(input);
    if (date && !recurrence) e.date = date;

    // Araç. "Tesla Model Y" kadar, tek başına "Model 3" de tanınır —
    // marka bağlamdan (önceki turlardan) gelir.
    const vehicle = t.match(/tesla(?:\s+model\s*([y3sx]))?/) ?? t.match(/\bmodel\s*([y3sx])\b/);
    if (vehicle) {
      const model = vehicle[1] ? `Model ${vehicle[1].toLocaleUpperCase("tr")}` : undefined;
      const brand = /tesla/.test(t)
        ? "Tesla"
        : (context?.selectedEntities.vehicle?.value.split(" ")[0] ?? "Tesla");
      e.vehicle = { value: model ? `${brand} ${model}` : brand, raw: vehicle[0] };
    }

    // Konum
    if (/\bev(e|de|den)\b|\beve\b/.test(t)) {
      e.location = { value: { semantic: "home" }, raw: "ev" };
    } else if (/\biş(e|te|ten)\b|\bofis/.test(t)) {
      e.location = { value: { semantic: "work" }, raw: "iş" };
    }

    // Kişi
    const person = t.match(/\b(annem|babam|eşim|kardeşim|patronum|sevgilim)\b/);
    if (person) e.person = { value: person[1]!, raw: person[1]! };

    // Uygulama
    const app = t.match(/\b(whatsapp|telegram|instagram|mesajlar|imessage|slack)\b/);
    if (app) {
      const canonical = { whatsapp: "WhatsApp", telegram: "Telegram", instagram: "Instagram", mesajlar: "Mesajlar", imessage: "iMessage", slack: "Slack" }[app[1]!]!;
      e.application = { value: canonical, raw: app[1]! };
    }

    // Pil
    if (/\bpil|batarya|şarj\b/.test(t)) {
      const pct = t.match(/(?:yüzde\s+)?(\d{1,3}|[a-zçğıöşü\s]+?)\s*(?:%|'?(?:ye|ya|nin|nın|e|a))?\s*(?:düş|in|azal)/);
      const direct = t.match(/%\s*(\d{1,3})/) ?? t.match(/yüzde\s+([a-zçğıöşü]+|\d{1,3})/);
      const level = parseTurkishNumber(direct?.[1] ?? pct?.[1] ?? "");
      if (level !== null && level <= 100) {
        e.batteryLevel = { value: level, raw: direct?.[0] ?? pct?.[0] ?? "" };
        e.condition = { value: /(düş|in|azal|altı)/.test(t) ? "below" : "above", raw: "altına düşünce" };
      }
    }

    // Wi-Fi ağı
    const wifi = t.match(/(?:wifi|wi-fi)\s+["“']?([\w-]+)["”']?/);
    if (wifi) e.wifiNetwork = { value: wifi[1]!, raw: wifi[0] };

    // Hatırlatma konusu (örn. "ilacımı") — adı verilmemişse subject boş kalır
    if (/\bilac|ilaç/.test(t)) e.subject = { value: "ilaç", raw: "ilaç" };

    return e;
  }
}

/* ---------------- intent extractor ---------------- */

export class RuleBasedIntentExtractor implements IntentExtractor {
  constructor(private entities: EntityExtractor = new RuleBasedEntityExtractor()) {}

  extract(input: string, context?: ConversationContext): IntentResult {
    const t = lower(input);
    const entities = this.entities.extract(input, context);

    // Düzeltme mi? (mevcut plan varsa modify_automation)
    const isCorrection = CORRECTION_PATTERNS.some((re) => re.test(t));
    if (isCorrection && context?.currentPlan) {
      return {
        intent: "modify_automation",
        confidence: 0.9,
        steps: [],
        entities,
        missing: [],
        sourceText: input,
      };
    }

    for (const { intent, re } of INTENT_PATTERNS) {
      if (re.test(t)) {
        return { intent, confidence: 0.75, steps: [], entities, missing: [], sourceText: input };
      }
    }

    const triggerMatch = matchSemantic(input, "trigger");
    const actionMatch = matchSemantic(input, "action");

    const trigger = this.buildTrigger(triggerMatch?.semantic, entities, t);
    const steps = this.buildSteps(actionMatch?.semantic, entities, t);

    if (!trigger && steps.length === 0) {
      return {
        intent: "not_understood",
        confidence: 0.1,
        steps: [],
        entities,
        missing: [],
        sourceText: input,
      };
    }

    const missing = this.findMissing(trigger, steps, entities);
    const confidence = this.scoreConfidence(trigger, steps, entities);

    return {
      intent: "create_automation",
      confidence,
      trigger: trigger ?? undefined,
      steps,
      entities,
      missing,
      sourceText: input,
    };
  }

  private buildTrigger(semantic: string | undefined, e: Entities, t: string): SemanticTrigger | null {
    // Zaman tetikleyicisi, anahtar kelime olmasa da saat/tekrar varsa geçerli.
    if (semantic === "time" || (!semantic && (e.time || e.recurrence))) {
      if (!e.time && !e.recurrence && !e.date) return null;
      return {
        type: "time",
        details: {
          time: e.time?.value ?? null,
          recurrence: e.recurrence?.value.kind ?? (e.date ? "once" : null),
          date: e.date?.value ?? null,
        },
      };
    }
    if (!semantic) {
      if (e.location) return { type: "location_arrive", details: { semantic: e.location.value.semantic } };
      return null;
    }
    if (semantic === "battery_below") {
      return { type: "battery_below", details: { level: e.batteryLevel?.value ?? null, condition: e.condition?.value ?? "below" } };
    }
    if (semantic === "incoming_message") {
      return { type: "incoming_message", details: { person: e.person?.value ?? null, application: e.application?.value ?? null } };
    }
    if (semantic === "location_leave" && e.location) {
      return { type: "location_leave", details: { semantic: e.location.value.semantic } };
    }
    // "eve gelince" gibi varış ifadeleri
    if (e.location && /(gel|var|ulaş)/.test(t)) {
      return { type: "location_arrive", details: { semantic: e.location.value.semantic } };
    }
    return { type: semantic, details: { vehicle: e.vehicle?.value ?? null } };
  }

  private buildSteps(semantic: string | undefined, e: Entities, t: string): SemanticStep[] {
    if (!semantic) {
      // "ışıkları aç" gibi registry'de karşılığı olmayan eylemler:
      // semantik olarak yakalanır ama capability eşlemesi başarısız olur
      // ve akış `unsupported`'a düşer (§11). Burada uydurma yapılmaz.
      const unknownAction = t.match(/(ışıkları|ışığı|perdeleri|kombiyi|televizyonu)\s*(aç|kapat)/);
      if (unknownAction) return [{ type: `unmapped:${unknownAction[1]}_${unknownAction[2]}` }];
      return [];
    }
    if (semantic === "notify") {
      return [{ type: "notify", message: e.subject && e.subject.value ? null : null }];
    }
    return [{ type: semantic, details: { vehicle: e.vehicle?.value ?? null } }];
  }

  private findMissing(
    trigger: SemanticTrigger | null,
    steps: SemanticStep[],
    e: Entities
  ): MissingEntity[] {
    const missing: MissingEntity[] = [];

    if (trigger?.type === "time") {
      if (!e.time) missing.push({ field: "time", reason: "required_for_time_trigger" });
      else if (e.time.ambiguous) missing.push({ field: "time_of_day", reason: "am_pm_ambiguous" });
    }
    if (trigger?.type === "battery_below" && e.batteryLevel === undefined) {
      missing.push({ field: "battery_level", reason: "required_for_battery_trigger" });
    }
    if (trigger?.type === "incoming_message" && !e.person) {
      missing.push({ field: "person", reason: "required_for_message_trigger" });
    }
    if (steps.some((s) => s.type === "notify") && e.subject && !e.message) {
      // "ilacımı hatırlat" → hangi ilaç?
      missing.push({ field: `${e.subject.value}_name`, reason: "required_for_reminder" });
    }
    if (steps.some((s) => s.type.startsWith("vehicle_")) && !e.vehicle) {
      missing.push({ field: "vehicle", reason: "required_for_vehicle_action" });
    }
    return missing;
  }

  private scoreConfidence(trigger: SemanticTrigger | null, steps: SemanticStep[], e: Entities): number {
    let score = 0.3;
    if (trigger) score += 0.3;
    if (steps.length > 0) score += 0.25;
    if (e.time || e.recurrence || e.vehicle || e.location || e.batteryLevel !== undefined) score += 0.15;
    if (steps.some((s) => s.type.startsWith("unmapped:"))) score -= 0.2;
    if (e.time?.ambiguous) score -= 0.15;
    return Math.max(0.05, Math.min(0.99, Number(score.toFixed(2))));
  }
}
