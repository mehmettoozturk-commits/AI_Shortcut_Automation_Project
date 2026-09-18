/**
 * Phase 2 boru hattı: clarification, revizyon ve planlayıcı.
 *
 * Boru hattı sırası (§10) — kestirme yok:
 *   Türkçe cümle → Niyet → Entity → DraftAutomationPlan → (Builder
 *   state machine üzerinden) Schema → Capability → Permission → Safety
 *   → kullanıcı onayı → kurulum
 */

import { nextMissingInfoQuestion } from "../builder/missing-info.js";
import type { DraftAutomationPlan, MissingInfoField } from "../builder/types.js";
import type { Planner, PlannerResult } from "../builder/ports.js";
import { findBySemantic, findCapability } from "../capability-registry/registry.js";
import type { WorkflowStep } from "../dsl/schema.js";
import { buildPlan } from "./plan-builder.js";
import type { ClarificationEngine, EntityExtractor, IntentExtractor, NluPlanner, PlanRevisionEngine } from "./ports.js";
import { RuleBasedEntityExtractor, RuleBasedIntentExtractor } from "./rule-based.js";
import { lower, normalizeTime } from "./turkish.js";
import {
  emptyContext,
  type ConversationContext,
  type PlanningOutcome,
} from "./types.js";

/* ---------------- clarification ---------------- */

export class DefaultClarificationEngine implements ClarificationEngine {
  /**
   * Phase 1.5 öncelik kurallarını yeniden kullanır: tetikleyici →
   * cihaz/kişi → eylem detayı → opsiyonel. Her seferinde TEK soru.
   */
  nextQuestion(plan: DraftAutomationPlan): MissingInfoField | null {
    return nextMissingInfoQuestion(plan);
  }
}

/* ---------------- revizyon ---------------- */

export class DefaultPlanRevisionEngine implements PlanRevisionEngine {
  constructor(private entities: EntityExtractor = new RuleBasedEntityExtractor()) {}

  /**
   * Yalnızca düzeltilen parçayı değiştirir; geri kalan her şey korunur
   * (§8). Yeni ve ilgisiz bir otomasyon ÜRETMEZ.
   */
  revise(currentPlan: DraftAutomationPlan, correction: string, context: ConversationContext): DraftAutomationPlan {
    const t = lower(correction);
    let plan: DraftAutomationPlan = { ...currentPlan, trigger: { ...currentPlan.trigger } };

    // 1. Eylem düzeltmesi: "kamera değil Sentry Mode", "hayır, klimayı aç"
    const newActionCap = this.findActionInText(correction);
    if (newActionCap) {
      plan = { ...plan, steps: replaceActionSteps(plan.steps, newActionCap), name: newActionCap.replace(/\.$/, "") };
      const cap = findCapability(newActionCap);
      if (cap) plan.name = cap.description.replace(/\.$/, "");
    }

    // 2. Saat düzeltmesi: "9 değil 10", "10 olsun"
    const newTime = this.reviseTime(t, currentPlan);
    if (newTime) {
      plan = { ...plan, trigger: { ...plan.trigger, params: { ...(plan.trigger.params ?? {}), time: newTime } } };
    }

    // 3. Araç düzeltmesi
    const e = this.entities.extract(correction, context);
    if (e.vehicle) {
      plan = { ...plan, trigger: { ...plan.trigger, device: e.vehicle.value } };
      plan.answers = { ...plan.answers, vehicle: e.vehicle.value };
    }

    return plan;
  }

  /** Metindeki eylemi registry üzerinden bulur (hardcode id yok). */
  private findActionInText(text: string): string | null {
    const t = lower(text);
    let best: { id: string; len: number } | null = null;
    for (const cap of findAllActions()) {
      for (const kw of cap.nluKeywords ?? []) {
        if (t.includes(lower(kw)) && (!best || kw.length > best.len)) {
          // Düzeltmede yalnızca desteklenen eylemler kabul edilir;
          // desteklenmeyene dönüş yapılmaz.
          if (cap.availableInShortcuts === true) best = { id: cap.id, len: kw.length };
        }
      }
    }
    return best?.id ?? null;
  }

  /**
   * "9 değil 10" gibi düzeltmelerde, orijinal plandaki sabah/akşam
   * bağlamı KORUNUR — yani 21:00 planı "10 olsun" ile 22:00 olur, 10:00
   * olmaz.
   */
  private reviseTime(t: string, currentPlan: DraftAutomationPlan): string | null {
    const previous = (currentPlan.trigger.params as { time?: string } | undefined)?.time;
    const numbers = [...t.matchAll(/(\d{1,2})/g)].map((m) => Number(m[1]));
    const explicit = normalizeTime(t);

    let hour: number | null = null;
    if (/değil/.test(t) && numbers.length >= 2) hour = numbers[numbers.length - 1]!;
    else if (/olsun|yap/.test(t) && numbers.length >= 1) hour = numbers[numbers.length - 1]!;
    else if (explicit && !explicit.ambiguous) return explicit.value;

    if (hour === null || hour > 23) return null;

    // Önceki plan akşam saatindeyse (>=13) akşam bağlamını koru.
    const previousHour = previous ? Number(previous.split(":")[0]) : null;
    if (previousHour !== null && previousHour >= 13 && hour <= 12) {
      return `${String(hour + 12).padStart(2, "0")}:00`;
    }
    return `${String(hour).padStart(2, "0")}:00`;
  }
}

function findAllActions() {
  // findBySemantic semantik bazlı; burada tüm eylemleri gezmek gerekiyor.
  const semantics = new Set<string>();
  const out = [] as ReturnType<typeof findBySemantic>;
  for (const sem of [
    "notify", "ask_confirmation", "vehicle_sentry_mode", "vehicle_climate", "vehicle_lock", "vehicle_camera",
  ]) {
    if (semantics.has(sem)) continue;
    semantics.add(sem);
    out.push(...findBySemantic(sem, "action"));
  }
  return out;
}

function replaceActionSteps(steps: WorkflowStep[], capabilityId: string): WorkflowStep[] {
  return steps.map((s) => {
    if (s.type === "ask_confirmation") return s;
    if (s.type === "conditional" && "then" in s && "else" in s) {
      return { ...s, then: replaceActionSteps(s.then, capabilityId), else: replaceActionSteps(s.else, capabilityId) };
    }
    return { type: capabilityId };
  });
}

/* ---------------- planlayıcı ---------------- */

export class NluPipeline implements NluPlanner {
  constructor(
    private intentExtractor: IntentExtractor = new RuleBasedIntentExtractor(),
    private clarification: ClarificationEngine = new DefaultClarificationEngine(),
    private revision: PlanRevisionEngine = new DefaultPlanRevisionEngine()
  ) {}

  plan(input: string, context: ConversationContext): PlanningOutcome {
    const intent = this.intentExtractor.extract(input, context);
    context.conversationTurns.push({ role: "user", text: input });
    context.lastIntent = intent;

    // Düzeltme: mevcut planı revize et, yeni otomasyon üretme (§8)
    if (intent.intent === "modify_automation" && context.currentPlan) {
      const revised = this.revision.revise(context.currentPlan, input, context);
      context.currentPlan = revised;
      const question = this.clarification.nextQuestion(revised, context);
      if (question) return { status: "needs_clarification", question, intent };
      return { status: "plan", plan: revised, intent, band: "high" };
    }

    const outcome = buildPlan(intent);

    if (outcome.status === "plan") {
      context.currentPlan = outcome.plan;
      if (!context.originalInput) context.originalInput = input;
      context.selectedEntities = { ...context.selectedEntities, ...intent.entities };

      // Güven düşükse doğrudan clarification (§7). Güven tek başına
      // çalıştırma kararı vermez; yalnızca ne SORULACAĞINI etkiler.
      const question = this.clarification.nextQuestion(outcome.plan, context);
      if (question) {
        context.lastQuestion = question.question;
        context.lastMissingField = question.id;
        return { status: "needs_clarification", question, intent };
      }
    }

    return outcome;
  }

  /**
   * Sorulan tek soruya verilen cevabı işler ve akışı ilerletir (§6).
   * Cevap, bağlamdaki plana yazılır; önceki bilgiler KORUNUR.
   */
  answerClarification(answer: string, context: ConversationContext): PlanningOutcome {
    const plan = context.currentPlan;
    const field = context.lastMissingField;
    if (!plan || !field) {
      return this.plan(answer, context);
    }

    context.conversationTurns.push({ role: "user", text: answer });

    const updated: DraftAutomationPlan = {
      ...plan,
      answers: { ...plan.answers, [field]: answer },
      trigger: { ...plan.trigger },
    };

    // Cevabın taşıdığı entity'ler bağlama eklenir (silinmez, birleşir).
    const extracted = new RuleBasedEntityExtractor().extract(answer, context);
    context.selectedEntities = { ...context.selectedEntities, ...extracted };

    if (field === "vehicle" && extracted.vehicle) {
      updated.trigger.device = extracted.vehicle.value;
    } else if (field === "vehicle") {
      updated.trigger.device = answer;
    } else if (field === "time_of_day") {
      const previous = (updated.trigger.params as { time?: string } | undefined)?.time;
      const hour = previous ? Number(previous.split(":")[0]) % 12 : null;
      if (hour !== null) {
        const resolved = /akşam|gece/i.test(answer) ? hour + 12 : hour;
        updated.trigger.params = { ...(updated.trigger.params ?? {}), time: `${String(resolved).padStart(2, "0")}:00` };
      }
    } else if (field.endsWith("_name")) {
      updated.steps = attachMessage(updated.steps, answer);
    }

    context.currentPlan = updated;
    const next = this.clarification.nextQuestion(updated, context);
    if (next) {
      context.lastQuestion = next.question;
      context.lastMissingField = next.id;
      return { status: "needs_clarification", question: next, intent: context.lastIntent! };
    }
    context.lastQuestion = null;
    context.lastMissingField = null;
    return { status: "plan", plan: updated, intent: context.lastIntent!, band: "high" };
  }
}

/** Bildirim adımına kullanıcının verdiği içeriği yazar. */
function attachMessage(steps: WorkflowStep[], message: string): WorkflowStep[] {
  return steps.map((s) => {
    if (s.type === "conditional" && "then" in s && "else" in s) {
      return { ...s, then: attachMessage(s.then, message), else: attachMessage(s.else, message) };
    }
    if (s.type === "ask_confirmation") return s;
    return { ...s, params: { ...((s as { params?: Record<string, unknown> }).params ?? {}), message } };
  });
}

/**
 * Phase 1 `Planner` portuna uyum katmanı. Mevcut Builder state machine
 * ve onun 101 testi DEĞİŞMEDEN çalışmaya devam eder: unsupported ve
 * clarification durumları, state machine'in kendi mekanizmalarıyla
 * (registry kontrolü ve `missing` alanı) zaten ele alınıyor.
 */
export class NluPlannerAdapter implements Planner {
  private context: ConversationContext = emptyContext();

  constructor(private pipeline: NluPipeline = new NluPipeline()) {}

  resetContext(): void {
    this.context = emptyContext();
  }

  getContext(): ConversationContext {
    return this.context;
  }

  async plan(text: string, existingDraft?: DraftAutomationPlan | null): Promise<PlannerResult> {
    if (existingDraft) this.context.currentPlan = existingDraft;
    const outcome = this.pipeline.plan(text, this.context);

    switch (outcome.status) {
      case "plan":
        return { kind: "plan", plan: outcome.plan };
      case "needs_clarification":
        // Plan üretildi ama eksik bilgi var: state machine kendi
        // missing_info akışını çalıştıracak.
        return this.context.currentPlan
          ? { kind: "plan", plan: this.context.currentPlan }
          : { kind: "not_understood" };
      case "unsupported": {
        // Desteklenmeyen capability'yi plana koyarak state machine'in
        // kendi unsupported/alternatif akışını tetikliyoruz — böylece
        // "unsupported" kararı tek yerde (registry) kalıyor.
        const triggerId = triggerIdFor(outcome);
        if (outcome.capability && triggerId) {
          return {
            kind: "plan",
            plan: {
              name: outcome.reason,
              trigger: { type: triggerId, device: null, params: {} },
              steps: [{ type: outcome.capability }],
              missing: [],
              answers: {},
            },
          };
        }
        return { kind: "not_understood" };
      }
      case "not_understood":
        return { kind: "not_understood" };
    }
  }
}

/**
 * Tetikleyici id'si YALNIZCA registry'den gelir; yedek/varsayılan bir
 * capability id'si burada hardcode edilmez. Bulunamazsa null döner ve
 * akış "anlaşılamadı"ya düşer.
 */
function triggerIdFor(outcome: Extract<PlanningOutcome, { status: "unsupported" }>): string | null {
  const semantic = outcome.intent.trigger?.type;
  if (!semantic) return null;
  return findBySemantic(semantic, "trigger")[0]?.id ?? null;
}
