/**
 * Phase 2 — Intent + Entity Extraction tipleri.
 *
 * Bu katman SEMANTİK çıktı üretir; capability id'lerini bilmez ve bir
 * şeyin çalıştırılabilir olup olmadığına KARAR VERMEZ. O karar
 * Capability Registry + validator zincirine aittir (docs/ux.md §2).
 *
 * Boru hattı:
 *   Türkçe cümle → Niyet → Entity → DraftAutomationPlan → Schema →
 *   Capability → Permission → Safety → Kullanıcı onayı → Kurulum
 */

import type { DraftAutomationPlan, MissingInfoField } from "../builder/types.js";

export type IntentType =
  | "create_automation"
  | "modify_automation"
  | "explain_automation"
  | "disable_automation"
  | "enable_automation"
  | "delete_automation"
  | "not_understood";

/**
 * Güven bandı. Güven TEK BAŞINA çalıştırma kararı vermez (§7):
 *  high   → akış devam eder
 *  medium → anlama ekranı gösterilir
 *  low    → clarification
 */
export type ConfidenceBand = "high" | "medium" | "low";

export function bandFor(confidence: number): ConfidenceBand {
  if (confidence >= 0.8) return "high";
  if (confidence >= 0.5) return "medium";
  return "low";
}

/** Normalize edilmiş değer, orijinal ifadeyle birlikte saklanır (§5). */
export interface Normalized<T> {
  value: T;
  /** Kullanıcının kullandığı orijinal ifade */
  raw: string;
  /** Belirsizse true; asla sessizce tahmin edilmez */
  ambiguous?: boolean;
}

export type Recurrence =
  | { kind: "daily" }
  | { kind: "weekly"; weekdays: number[] }
  | { kind: "weekday" }
  | { kind: "times_per_week"; count: number }
  | { kind: "once" };

export interface Entities {
  time?: Normalized<string>;
  date?: Normalized<string>;
  recurrence?: Normalized<Recurrence>;
  location?: Normalized<{ semantic?: "home" | "work"; name?: string }>;
  device?: Normalized<string>;
  vehicle?: Normalized<string>;
  person?: Normalized<string>;
  application?: Normalized<string>;
  message?: Normalized<string>;
  batteryLevel?: Normalized<number>;
  condition?: Normalized<"below" | "above" | "equals">;
  wifiNetwork?: Normalized<string>;
  duration?: Normalized<number>;
  /** Kullanıcının bahsettiği ama henüz adı verilmemiş nesne (örn. ilaç) */
  subject?: Normalized<string>;
}

/** NLU'nun semantik tetikleyici tanımı — capability id DEĞİL. */
export interface SemanticTrigger {
  /** örn. "time", "vehicle_departure", "battery_below" */
  type: string;
  details?: Record<string, unknown>;
}

/** NLU'nun semantik eylem tanımı — capability id DEĞİL. */
export interface SemanticStep {
  /** örn. "notify", "vehicle_sentry_mode", "vehicle_camera" */
  type: string;
  message?: string | null;
  details?: Record<string, unknown>;
}

export interface MissingEntity {
  field: string;
  reason: string;
}

export interface IntentResult {
  intent: IntentType;
  confidence: number;
  trigger?: SemanticTrigger;
  steps: SemanticStep[];
  entities: Entities;
  missing: MissingEntity[];
  /** Hangi metinden üretildiği — hata ayıklama ve revizyon için */
  sourceText: string;
}

/** §9 — konuşma bağlamı. Clarification, düzeltme ve alternatif seçimi için. */
export interface ConversationContext {
  originalInput: string;
  currentPlan: DraftAutomationPlan | null;
  conversationTurns: Array<{ role: "user" | "system"; text: string }>;
  lastQuestion: string | null;
  lastMissingField: string | null;
  selectedEntities: Entities;
  /** Son IntentResult; revizyonda temel alınır */
  lastIntent?: IntentResult;
}

export function emptyContext(originalInput = ""): ConversationContext {
  return {
    originalInput,
    currentPlan: null,
    conversationTurns: [],
    lastQuestion: null,
    lastMissingField: null,
    selectedEntities: {},
  };
}

/**
 * Planlama sonucu. `unsupported` kararı NLU'nun değil, registry
 * eşlemesinin sonucudur (§10, §11).
 */
export type PlanningOutcome =
  | { status: "plan"; plan: DraftAutomationPlan; intent: IntentResult; band: ConfidenceBand }
  | { status: "not_understood"; intent: IntentResult }
  | {
      status: "unsupported";
      capability: string | null;
      /** Registry'den türeyen alternatifler; AI katmanında hardcode DEĞİL */
      alternatives: Array<{ id: string; description: string }>;
      intent: IntentResult;
      reason: string;
    }
  | { status: "needs_clarification"; question: MissingInfoField; intent: IntentResult }
  /**
   * Phase 4B — LLM/JSON hatası (ağ, parse, şema). Bu, "anlaşılamadı" ile
   * KARIŞTIRILMAZ: `not_understood` geçerli bir semantik sonuçtur (LLM/
   * kural tabanlı sağlayıcı çalıştı ama niyeti tanımadı); `provider_error`
   * sağlayıcının HİÇ çalışamadığını gösterir — istemci bunu retry/hata
   * mesajıyla ayrı ele almalı.
   */
  | { status: "provider_error"; message: string };
