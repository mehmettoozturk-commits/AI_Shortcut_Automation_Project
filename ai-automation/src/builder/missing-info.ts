/**
 * Eksik bilgi sıralaması — docs/ux.md §7.4.
 *
 * Kural: her seferinde TEK soru, ve şu öncelikle:
 *   1. tetikleyici  2. cihaz/kişi  3. eylem detayı  4. opsiyonel tercihler
 *
 * Aynı kategoride birden fazla eksik varsa plandaki görülme sırası
 * korunur (stable). UI'dan bağımsız saf fonksiyon olduğu için doğrudan
 * unit test edilebilir.
 */

import { MISSING_INFO_PRIORITY, type DraftAutomationPlan, type MissingInfoField } from "./types.js";

/** Cevabı verilmemiş alanlar, öncelik sırasına göre. */
export function pendingMissingInfo(draft: DraftAutomationPlan): MissingInfoField[] {
  const unanswered = draft.missing.filter((f) => draft.answers[f.id] === undefined);
  return unanswered
    .map((field, index) => ({ field, index }))
    .sort((a, b) => {
      const pa = MISSING_INFO_PRIORITY.indexOf(a.field.kind);
      const pb = MISSING_INFO_PRIORITY.indexOf(b.field.kind);
      if (pa !== pb) return pa - pb;
      return a.index - b.index; // aynı kategori: plandaki sıra korunur
    })
    .map((x) => x.field);
}

/** Sorulacak sıradaki tek soru; hiç kalmadıysa null. */
export function nextMissingInfoQuestion(draft: DraftAutomationPlan): MissingInfoField | null {
  const pending = pendingMissingInfo(draft);
  return pending.length > 0 ? pending[0]! : null;
}
