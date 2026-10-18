import type { NluProvider, RepairHint } from "./ports.js";
import { normalizeTime } from "./turkish.js";
import type { ConversationContext, IntentResult } from "./types.js";
import type { PlanningTrace } from "./planning-provenance.js";

/** Only typography is normalized. Negation, numbers and extra clauses survive. */
export function normalizeLocalInput(input: string): string {
  return input.normalize("NFC").toLocaleLowerCase("tr").replace(/[’‘]/g, "'")
    .trim().replace(/\s+/g, " ").replace(/[.!?]$/, "").trim();
}

export function vehicleCorrectionTarget(input: string): string | null {
  const match = normalizeLocalInput(input).match(/^(?:tesla )?model [y3sx] yerine (?:tesla )?model ([y3sx]) kullan$/);
  return match ? `Tesla Model ${match[1]!.toUpperCase()}` : null;
}

export type LocalResolution =
  | { route: "local_template"; template: "battery_notification" | "time_notification" | "vehicle_correction"; intent: IntentResult }
  | { route: "ai_required" };

/** Reviewed, whole-input grammars, never a cache of previous model outputs. */
export function resolveLocalPlan(input: string, context?: ConversationContext): LocalResolution {
  const text = normalizeLocalInput(input);
  const base: IntentResult = {
    intent: "create_automation", confidence: 1, steps: [{ type: "notify" }],
    entities: {}, missing: [], sourceText: input,
  };
  // Exact normalized match before parameterized grammars.
  if (text === "saat gelince bildirim gönder") {
    return { route: "local_template", template: "time_notification", intent: {
      ...base, trigger: { type: "time", details: { time: null } },
      missing: [{ field: "time", reason: "required_for_time_trigger" }],
    } };
  }
  const notification = "(?:bildir|bildirim gönder|bana haber ver)";
  if (new RegExp(`^(?:pil|batarya) azalınca ${notification}$`).test(text)) {
    return { route: "local_template", template: "battery_notification", intent: {
      ...base, trigger: { type: "battery_below", details: { level: null, condition: "below" } },
      missing: [{ field: "battery_level", reason: "required_for_battery_trigger" }],
    } };
  }
  const battery = text.match(new RegExp(`^(?:pil|batarya) (?:%\\s*|yüzde )(\\d{1,3})(?:'?(?:nin|nın|in|ın))? (altına düşünce|üstüne çıkınca) ${notification}$`));
  if (battery && Number(battery[1]) <= 100) {
    const level = Number(battery[1]);
    const condition = battery[2] === "altına düşünce" ? "below" : "above";
    return { route: "local_template", template: "battery_notification", intent: {
      ...base,
      // Historical registry semantic; the explicit comparison must survive.
      trigger: { type: "battery_below", details: { level, condition } },
      entities: { batteryLevel: { value: level, raw: battery[1]! }, condition: { value: condition, raw: battery[2]! } },
    } };
  }
  // New coverage is deliberately below-only. Keep the earlier strict above
  // grammar untouched; never infer direction from a keyword or partial match.
  const batteryName = "(?:pil(?:i|im)?|şarj(?:ım)?|batarya(?:m)?)(?: seviye(?:si|m))?";
  const percentageSuffix = "(?:'?(?:nin|nın|nun|nün|in|ın|un|ün|ye|ya|e|a))?";
  const belowNotification = "(?:bildir|bildirim gönder|(?:beni )?uyar|(?:bana )?haber ver)";
  const below = text.match(new RegExp(`^${batteryName} (?:%\\s*|yüzde )(\\d{1,3})${percentageSuffix} (?:altına )?(?:düşerse|düşünce|indiğinde|inince) ${belowNotification}$`));
  if (below && Number(below[1]) <= 100) {
    const level = Number(below[1]);
    return { route: "local_template", template: "battery_notification", intent: {
      ...base, trigger: { type: "battery_below", details: { level, condition: "below" } },
      entities: { batteryLevel: { value: level, raw: below[1]! }, condition: { value: "below", raw: "below" } },
    } };
  }
  const time = text.match(new RegExp(`^saat (\\d{1,2}(?:[.:]\\d{2})?)(?:'?(?:de|da|te|ta))? ${notification}$`));
  if (time) {
    const normalized = normalizeTime(`saat ${time[1]}`);
    if (normalized) return { route: "local_template", template: "time_notification", intent: {
      ...base, trigger: { type: "time", details: { time: normalized.value } },
      entities: { time: normalized },
      missing: normalized.ambiguous ? [{ field: "time_of_day", reason: "am_pm_ambiguous" }] : [],
    } };
  }
  // Explicit clock only: no daypart, recurrence restriction or extra clause.
  const dailyClock = text.match(/^(?:saat (\d{2}[.:]\d{2})(?:'?(?:de|da|te|ta))? (?:olduğunda |olunca )?|her gün (\d{2}[.:]\d{2})(?:'?(?:de|da|te|ta))? )(?:bildir|bildirim gönder|(?:bana )?haber ver|beni uyar)$/);
  if (dailyClock) {
    const normalized = normalizeTime(`saat ${dailyClock[1] ?? dailyClock[2]}`);
    if (normalized) return { route: "local_template", template: "time_notification", intent: {
      ...base, trigger: { type: "time", details: { time: normalized.value } },
      entities: { time: normalized },
    } };
  }
  const vehicle = vehicleCorrectionTarget(input);
  if (vehicle && context?.currentPlan?.trigger.device?.startsWith("Tesla")) {
    return { route: "local_template", template: "vehicle_correction", intent: {
      ...base, intent: "modify_automation", steps: [],
      entities: { vehicle: { value: vehicle, raw: input } },
    } };
  }
  return { route: "ai_required" };
}

/** Semantic output still passes through NluPipeline and existing validators. */
export class LocalFirstProvider implements NluProvider {
  constructor(private readonly fallback: NluProvider) {}

  async plan(input: string, context?: ConversationContext, repair?: RepairHint, signal?: AbortSignal, trace?: PlanningTrace): Promise<IntentResult> {
    signal?.throwIfAborted();
    const result = resolveLocalPlan(input, context);
    if (result.route === "local_template") {
      trace?.localTemplate();
      return result.intent;
    }
    trace?.requireAI();
    return this.fallback.plan(input, context, repair, signal, trace);
  }
}
