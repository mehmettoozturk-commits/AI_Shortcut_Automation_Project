/**
 * Builder Flow types — docs/ux.md §1.2 (state machine) ve §6.2 (tip iskeleti).
 *
 * Bu dosya platformdan bağımsızdır: aynı state machine Phase 3'te SwiftUI
 * tarafına birebir taşınabilsin diye hiçbir UI/DOM bağımlılığı yoktur.
 */

import type { WorkflowStep } from "../dsl/schema.js";
import type { Automation } from "../domain/types.js";

/**
 * Eksik bilgi kategorileri — docs/ux.md §7.4'teki öncelik sırası bu
 * sıralamayla birebir aynıdır. Sıra bilinçli: dizideki index = öncelik.
 */
export const MISSING_INFO_PRIORITY = [
  "trigger",
  "device_or_person",
  "action_detail",
  "optional_preference",
] as const;

export type MissingInfoKind = (typeof MISSING_INFO_PRIORITY)[number];

export interface MissingInfoField {
  /** Plan içindeki alan kimliği, örn. "vehicle" */
  id: string;
  kind: MissingInfoKind;
  /** Kullanıcıya gösterilecek tek soru, örn. "Hangi Tesla'yı kullanalım?" */
  question: string;
  /** Dokunulabilir cevap seçenekleri (form değil — docs/ux.md §3.4) */
  options: string[];
  /** true ise kullanıcı "Şimdilik geç" diyebilir (§7.4, 4. seviye) */
  optional?: boolean;
}

/**
 * AI'nin ürettiği **taslak** plan. Henüz doğrulanmamıştır ve eksik
 * alanlar içerebilir. Doğrulanmış hali `AutomationPlan` (dsl/schema.ts).
 */
export interface DraftAutomationPlan {
  name: string;
  trigger: {
    type: string;
    device?: string | null;
    params?: Record<string, unknown>;
  };
  steps: WorkflowStep[];
  /** Planner'ın çözemediği alanlar; boşalınca preview'a geçilebilir. */
  missing: MissingInfoField[];
  /** Kullanıcının verdiği cevaplar (id -> cevap) */
  answers: Record<string, string>;
}

export type SetupKind =
  /** Shortcuts'a aktarılabilir; kullanıcı tek dokunuşla onaylar */
  | { kind: "user_assisted_import" }
  /** Native karşılığı yok; kullanıcı elle yapar */
  | { kind: "guided_manual"; steps: string[] };

/**
 * Kurulumun gerçek durumu. "Kestirmeler'e gönderdim" ile "kestirme
 * gerçekten kuruldu" arasındaki farkı uygulama BİLMEK zorundadır —
 * Execution/Activity tarafı buna dayanacak.
 */
export type InstallStatus = "pending_user" | "installed" | "failed";

/** docs/ux.md §1.2'deki state machine'in durumları. */
export type BuilderStep =
  | { kind: "idle" }
  | {
      kind: "capturing";
      text: string;
      /** Revizyonda taslak korunur — §7.1 */
      draft: DraftAutomationPlan | null;
      /** §7.2: AI hiçbir şey anlamadıysa aynı ekranın bir durumu */
      notUnderstood: boolean;
    }
  | { kind: "understanding"; draft: DraftAutomationPlan }
  /** §7.3: istenen eylem desteklenmiyor — akış durmaz, alternatif sunulur */
  | {
      kind: "unsupported";
      draft: DraftAutomationPlan;
      message: string;
      /** Desteklenen alternatif eylemler (boşsa yalnızca revizyon kalır) */
      alternatives: Array<{ id: string; description: string }>;
      /** Elle yapılabiliyorsa adımlar */
      manualSteps?: string[];
    }
  | { kind: "missing_info"; draft: DraftAutomationPlan; question: MissingInfoField }
  | {
      kind: "preview_confirm";
      draft: DraftAutomationPlan;
      /** Permission Validator'dan gelen eksik izinler (§3.5) */
      missingPermissions: string[];
      /** Registry'den türeyen, kurulumdan önce söylenecekler */
      disclosures: string[];
    }
  /** Plan doğrulandı ve kurulum paketi hazırlanıyor */
  | { kind: "setup"; draft: DraftAutomationPlan; setup: SetupKind }
  /** Hazır; kullanıcının Kestirmeler'de onaylaması bekleniyor */
  | { kind: "user_assisted_import"; draft: DraftAutomationPlan; setup: SetupKind }
  /**
   * Kullanıcı Kestirmeler'e aktarıldı. Uygulama kurulumun gerçekleşip
   * gerçekleşmediğini BİLMİYOR — bu yüzden buradan otomatik ilerleme YOK.
   */
  | { kind: "waiting_for_user"; draft: DraftAutomationPlan; setup: SetupKind }
  /** Kullanıcı kurulumu doğruladı; otomasyon kaydedildi */
  | { kind: "installed"; automation: Automation }
  | { kind: "success"; automation: Automation }
  | { kind: "setup_failed"; draft: DraftAutomationPlan; setup: SetupKind; reason: string };
