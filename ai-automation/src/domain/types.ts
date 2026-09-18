/**
 * Domain models — MASTER_SPEC.md §13 "Veri Modeli"
 * Platform-agnostic; no iOS/Android-specific types here.
 */

export type Platform = "ios" | "android";

export interface User {
  id: string;
  createdAt: string; // ISO 8601
  platform: Platform;
  locale: string;
  timezone: string;
}

export type AutomationStatus = "draft" | "active" | "paused" | "archived";

export interface Automation {
  id: string;
  userId: string;
  name: string;
  platform: Platform;
  status: AutomationStatus;
  /** The compiled/validated workflow this automation runs. Typed in dsl/schema.ts */
  trigger: unknown;
  workflow: unknown;
  version: number;
  createdAt: string;
  updatedAt: string;
  /**
   * true ise otomasyon kaydedildi ama kurulumun bir adımı kullanıcı
   * tarafından manuel yapılmalı (docs/ux.md §3.6 / §4 rozeti).
   * MASTER_SPEC §18: bu durumda asla "Tamamlandı" denmez.
   */
  requiresGuidedSetup?: boolean;
  /**
   * Kurulumun gerçek durumu. Uygulama otomasyonu kendisi kuramadığı için
   * (bkz. docs/capabilities.md §1.2) bu alan "Kestirmeler'e gönderdim" ile
   * "gerçekten kuruldu" arasındaki farkı taşır. Yalnızca kullanıcı
   * doğrulaması "installed" yazabilir.
   */
  installStatus: "pending_user" | "installed" | "failed";
}

export type DeviceType = "vehicle" | "phone" | "wearable" | "home" | "other";

export interface Device {
  id: string;
  userId: string;
  type: DeviceType;
  name: string;
  /** Platform-specific identifier (e.g. Bluetooth device name/UUID) */
  platformIdentifier: string;
  metadata?: Record<string, unknown>;
}

export type ExecutionStatus =
  | "pending"
  | "running"
  | "succeeded"
  | "failed"
  | "cancelled_by_user";

export interface Execution {
  id: string;
  automationId: string;
  startedAt: string;
  finishedAt?: string;
  status: ExecutionStatus;
  errorCode?: string;
}
