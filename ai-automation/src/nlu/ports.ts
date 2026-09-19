/**
 * Phase 2 provider soyutlaması (§13).
 *
 * Domain katmanı hiçbir LLM sağlayıcısına bağlı değildir. Bu arayüzlerin
 * arkasına kural tabanlı bir sağlayıcı (bu fazda yazılan) ya da ileride
 * bir LLM sağlayıcısı konabilir; boru hattı ve UI değişmez.
 */

import type { DraftAutomationPlan, MissingInfoField } from "../builder/types.js";
import type { ConversationContext, Entities, IntentResult, PlanningOutcome } from "./types.js";

export interface IntentExtractor {
  extract(input: string, context?: ConversationContext): IntentResult;
}

export interface EntityExtractor {
  extract(input: string, context?: ConversationContext): Entities;
}

export interface ClarificationEngine {
  /**
   * Sorulacak SIRADAKİ TEK soruyu üretir (Phase 1.5 öncelik kuralları).
   * Hiç eksik yoksa null.
   */
  nextQuestion(plan: DraftAutomationPlan, context: ConversationContext): MissingInfoField | null;
}

export interface PlanRevisionEngine {
  /**
   * Mevcut planı, kullanıcının düzeltmesine göre REVİZE eder.
   * Yeni ve ilgisiz bir otomasyon üretmez; yalnızca düzeltilen parçayı
   * değiştirir (§8).
   */
  revise(
    currentPlan: DraftAutomationPlan,
    correction: string,
    context: ConversationContext
  ): DraftAutomationPlan;
}

/**
 * Phase 2 planlayıcısı. Phase 1'deki `Planner` portundan farkı: bağlam
 * taşır ve `unsupported` / `needs_clarification` durumlarını da
 * raporlar. Phase 1 portuna uyum `NluPlannerAdapter` ile sağlanır.
 */
export interface NluPlanner {
  plan(input: string, context: ConversationContext): PlanningOutcome;
}

/**
 * Phase 4B — ASYNC sağlayıcı sınırı.
 *
 * Yukarıdaki `IntentExtractor` SENKRON kalır (mevcut 221 test ve
 * `RuleBasedIntentExtractor`'ın doğrudan senkron kullanımı bozulmaz).
 * `NluProvider`, ağ I/O gerektiren gerçek bir LLM sağlayıcısının
 * (`ClaudeIntentProvider`) VE kural tabanlı sağlayıcının aynı ASYNC
 * sınırdan geçmesini sağlayan ayrı, paralel bir arayüzdür —
 * `NluPipeline.planAsync()` bunu kullanır (bkz. pipeline.ts).
 *
 * Sonuç hâlâ `IntentResult` — API'ye özel ayrı bir "SemanticResult"
 * şekli İCAT EDİLMEDİ; LLM de dahil her sağlayıcı aynı semantik
 * sözleşmeye (capability id YOK, yalnızca semantik isim) uyar.
 */
export interface NluProvider {
  plan(input: string, context?: ConversationContext): Promise<IntentResult>;
}
