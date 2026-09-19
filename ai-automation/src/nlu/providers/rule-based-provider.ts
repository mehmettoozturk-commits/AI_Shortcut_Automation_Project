/**
 * Phase 4B — kural tabanlı sağlayıcının ASYNC sarmalayıcısı.
 *
 * `RuleBasedIntentExtractor`'ın kendisi değişmedi (hâlâ senkron, hâlâ
 * `IntentExtractor`'ı uygular). Bu sınıf onu `NluProvider` sınırına
 * bağlar ki `NluPipeline.planAsync()` — testlerde ve gerçek bir LLM
 * sağlayıcısı olmadan production'da — DETERMİNİSTİK sağlayıcıyı da AYNI
 * async boru hattından çalıştırabilsin (§14: harici API'ye bağımlılık
 * yok, ağ I/O da yok — yalnızca arayüz async).
 */

import type { NluProvider } from "../ports.js";
import { RuleBasedIntentExtractor } from "../rule-based.js";
import type { ConversationContext, IntentResult } from "../types.js";

export class RuleBasedProvider implements NluProvider {
  constructor(private extractor: RuleBasedIntentExtractor = new RuleBasedIntentExtractor()) {}

  async plan(input: string, context?: ConversationContext): Promise<IntentResult> {
    return this.extractor.extract(input, context);
  }
}
