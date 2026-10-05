/**
 * Ports (protocol'ler) — UI mimarisi değişmeden gerçek AI Core / native
 * entegrasyonlar mock'ların yerine geçebilsin diye tanımlandı.
 *
 * Phase 2'de `Planner`'ın yerini gerçek Intent/Entity Extraction alacak.
 * Phase 3'te `SetupService`'in yerini gerçek Shortcuts/App Intents
 * adaptörü alacak. Hiçbirinin state machine'i veya UI'ı değiştirmesi
 * gerekmez.
 */

import type { DraftAutomationPlan } from "./types.js";
import type { Automation } from "../domain/types.js";

export type PlannerResult =
  | { kind: "plan"; plan: DraftAutomationPlan }
  /** docs/ux.md §7.2 — AI hiçbir niyet çıkaramadı */
  | { kind: "not_understood" };

export interface Planner {
  /** Start a fresh automation attempt without retaining earlier conversation. */
  resetConversation(): void;
  /**
   * @param text Kullanıcının serbest metni (veya ses→metin çıktısı)
   * @param existingDraft Revizyon durumunda korunan mevcut taslak (§7.1).
   *   Verilmişse planner, planı sıfırdan üretmek yerine **revize** eder.
   */
  plan(text: string, existingDraft?: DraftAutomationPlan | null): Promise<PlannerResult>;
}

export interface PermissionService {
  /** Kullanıcının o an verdiği izinler, örn. ["bluetooth"] */
  grantedPermissions(): Promise<string[]>;
  /** İhtiyaç anında izin ister (docs/ux.md §3.5 / MASTER_SPEC §20) */
  request(permission: string): Promise<boolean>;
}

export interface SetupService {
  /**
   * Native kurulumu dener. Native destek olup olmadığına state machine
   * Capability Registry'den karar verir; bu port yalnızca kurulumu yapar.
   */
  installNative(plan: DraftAutomationPlan): Promise<{ installed: boolean }>;
}

export interface AutomationRepository {
  list(): Promise<Automation[]>;
  save(automation: Automation): Promise<void>;
  setActive(id: string, active: boolean): Promise<void>;
}
