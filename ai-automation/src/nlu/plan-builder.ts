/**
 * Semantik IntentResult → DraftAutomationPlan eşlemesi (§10).
 *
 * Bu dosya, NLU'nun semantik çıktısını capability id'lerine çevirir.
 * Eşleme kaynağı YALNIZCA Capability Registry'dir; burada hiçbir
 * capability id veya alternatif adı ("Sentry Mode", "Climate", "Lock")
 * hardcode edilmez.
 */

import { findBySemantic, findCapability, supportedAlternativesFor } from "../capability-registry/registry.js";
import { resolveTrigger, type DeviceContext } from "../capability-registry/resolver.js";
import type { Capability } from "../capability-registry/types.js";
import type { DraftAutomationPlan, MissingInfoField } from "../builder/types.js";
import type { WorkflowStep } from "../dsl/schema.js";
import { bandFor, type IntentResult, type PlanningOutcome } from "./types.js";

/** Semantik alanı → eksik bilgi sorusu (Türkçe, teknik terimsiz). */
const QUESTIONS: Record<string, { question: string; options: string[]; kind: MissingInfoField["kind"] }> = {
  vehicle: {
    question: "Hangi aracı kullanalım?",
    options: ["Tesla Model Y", "Tesla Model 3", "Tesla Model S", "Tesla Model X"],
    kind: "device_or_person",
  },
  time_of_day: {
    question: "Sabah 9 mu, akşam 9 mu?",
    options: ["Sabah", "Akşam"],
    kind: "trigger",
  },
  time: {
    question: "Saat kaçta olsun?",
    options: ["08:00", "12:00", "18:00", "21:00"],
    kind: "trigger",
  },
  person: {
    question: "Kimden gelen mesajlar için?",
    options: ["Annem", "Babam", "Eşim", "Başka biri"],
    kind: "device_or_person",
  },
  battery_level: {
    question: "Pil yüzde kaça düşünce?",
    options: ["%10", "%20", "%30"],
    kind: "trigger",
  },
};

function questionFor(field: string): MissingInfoField {
  const known = QUESTIONS[field];
  if (known) {
    return { id: field, kind: known.kind, question: known.question, options: known.options };
  }
  // "ilaç_name" gibi dinamik alanlar: eylem detayı kategorisinde.
  const subject = field.replace(/_name$/, "");
  return {
    id: field,
    kind: "action_detail",
    question: `Hangi ${subject}?`,
    options: [],
  };
}

function firstUsable(caps: Capability[]): Capability | undefined {
  return caps.find((c) => c.availableInShortcuts === true) ?? caps[0];
}

/**
 * Semantik eylemi capability'ye çevirir. Sonuç üç şekilde olabilir:
 *  - eşleşti ve Shortcuts'ta var → capability
 *  - eşleşti ama Shortcuts'ta yok → unsupported (alternatifler registry'den)
 *  - hiç eşleşmedi → unmapped
 */
type ActionResolution =
  | { kind: "ok"; capability: Capability }
  | { kind: "unsupported"; capability: Capability }
  | { kind: "unmapped"; semantic: string };

function resolveAction(semantic: string): ActionResolution {
  if (semantic.startsWith("unmapped:")) return { kind: "unmapped", semantic };
  const caps = findBySemantic(semantic, "action");
  const cap = firstUsable(caps);
  if (!cap) return { kind: "unmapped", semantic };
  if (cap.availableInShortcuts !== true) return { kind: "unsupported", capability: cap };
  return { kind: "ok", capability: cap };
}

/**
 * Tetikleyici seçimi. Bir semantik ad birden fazla capability'ye
 * karşılık geliyorsa (örn. "vehicle_departure" → CarPlay / Bluetooth /
 * konum), seçim Phase 1.5 resolver'ına devredilir; cihaz bağlamına göre
 * karar verir ve NLU katmanı bu kararı kendisi vermez.
 */
function resolveTriggerCapability(intent: IntentResult, device: DeviceContext): Capability | null {
  const semantic = intent.trigger?.type;
  if (!semantic) return null;
  const caps = findBySemantic(semantic, "trigger");
  if (caps.length === 0) return null;

  const group = caps[0]!.triggerGroup;
  if (group && caps.length > 1) {
    const resolved = resolveTrigger(group, device);
    if (resolved) return resolved.capability;
  }
  return firstUsable(caps) ?? null;
}

/**
 * Uygulama kısıtı denetimi: tetikleyici yalnızca belirli uygulamaları
 * kapsıyorsa (örn. mesaj tetikleyicisi sadece Mesajlar), kullanıcının
 * istediği uygulama desteklenmiyorsa unsupported döner.
 */
function appConstraintViolated(cap: Capability, intent: IntentResult): boolean {
  const app = intent.entities.application?.value;
  if (!app || !cap.supportedApps) return false;
  return !cap.supportedApps.some((a) => a.toLocaleLowerCase("tr") === app.toLocaleLowerCase("tr"));
}

function alternativesOf(capabilityId: string): Array<{ id: string; description: string }> {
  return supportedAlternativesFor(capabilityId).map((c) => ({ id: c.id, description: c.description }));
}

/** Cihaz bağlamı verilmezse muhafazakâr varsayım: CarPlay yok. */
const DEFAULT_DEVICE: DeviceContext = { osVersion: 26, hasCarPlay: false };

export function buildPlan(intent: IntentResult, device: DeviceContext = DEFAULT_DEVICE): PlanningOutcome {
  if (intent.intent === "not_understood") {
    return { status: "not_understood", intent };
  }

  const triggerCap = resolveTriggerCapability(intent, device);
  if (!triggerCap) {
    return {
      status: "unsupported",
      capability: null,
      alternatives: [],
      intent,
      reason: intent.trigger
        ? `"${intent.trigger.type}" için desteklenen bir tetikleyici bulunamadı.`
        : "Otomasyonun ne zaman çalışacağını anlayamadım.",
    };
  }

  if (appConstraintViolated(triggerCap, intent)) {
    return {
      status: "unsupported",
      capability: triggerCap.id,
      alternatives: [],
      intent,
      reason: `${intent.entities.application!.value} için doğrulanmış bir tetikleyici yok; bu tetikleyici yalnızca ${triggerCap.supportedApps!.join(", ")} uygulamasını kapsıyor.`,
    };
  }

  // Eylemleri çöz
  const steps: WorkflowStep[] = [];
  for (const semanticStep of intent.steps) {
    const resolved = resolveAction(semanticStep.type);
    if (resolved.kind === "unmapped") {
      return {
        status: "unsupported",
        capability: null,
        alternatives: [],
        intent,
        reason: "Bu işlemi şu anda otomatik olarak yapamıyorum.",
      };
    }
    if (resolved.kind === "unsupported") {
      return {
        status: "unsupported",
        capability: resolved.capability.id,
        alternatives: alternativesOf(resolved.capability.id),
        intent,
        reason: `${resolved.capability.description.replace(/\.$/, "")} iPhone Shortcuts entegrasyonunda bulunmuyor.`,
      };
    }
    steps.push({ type: resolved.capability.id });
  }

  if (steps.length === 0) {
    return {
      status: "unsupported",
      capability: null,
      alternatives: [],
      intent,
      reason: "Ne yapmak istediğini anladım ama karşılık gelen bir işlem bulamadım.",
    };
  }

  // Riskli eylemler kullanıcı onayı arkasına alınır (Safety Validator'ın
  // beklediği yapı). Registry'deki riskLevel'a göre karar verilir.
  const risky = steps.some((s) => {
    const cap = findCapability(s.type);
    return cap ? cap.riskLevel !== "low" : true;
  });

  const finalSteps: WorkflowStep[] = risky
    ? [
        { type: "ask_confirmation", message: confirmationMessage(steps) },
        { type: "conditional", condition: "answer == yes", then: steps, else: [] },
      ]
    : steps;

  const missing: MissingInfoField[] = intent.missing.map((m) => questionFor(m.field));

  const plan: DraftAutomationPlan = {
    name: planName(intent, steps),
    trigger: {
      type: triggerCap.id,
      device: intent.entities.vehicle?.value ?? intent.entities.device?.value ?? null,
      params: intent.trigger?.details ?? {},
    },
    steps: finalSteps,
    missing,
    answers: {},
  };

  return { status: "plan", plan, intent, band: bandFor(intent.confidence) };
}

function confirmationMessage(steps: WorkflowStep[]): string {
  const cap = findCapability(steps[0]!.type);
  const what = cap ? cap.description.replace(/\.$/, "").toLocaleLowerCase("tr") : "bu işlemi";
  return `${what.charAt(0).toLocaleUpperCase("tr")}${what.slice(1)} — yapmak ister misin?`;
}

function planName(intent: IntentResult, steps: WorkflowStep[]): string {
  const actionCap = findCapability(steps[0]!.type);
  return actionCap ? actionCap.description.replace(/\.$/, "") : intent.sourceText.slice(0, 40);
}
