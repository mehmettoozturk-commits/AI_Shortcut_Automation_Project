/**
 * Capability Matrix types — Phase 1.5.
 *
 * MASTER_SPEC §8'in genişletilmiş hali. Amaç: gerçek Apple davranışlarını
 * registry'nin sözleşmesine dönüştürmek — her satırın makine tarafından
 * okunabilir ve **kanıt seviyesi işaretli** olması.
 *
 * ⚠️ PHASE 1.5'İN EN ÖNEMLİ DERSİ: capability davranışları iOS SÜRÜMÜNE
 * BAĞLIDIR. Bluetooth tetikleyicili otomasyonlar iOS 15'te "onaysız
 * çalıştırılamaz" listesindeydi; iOS 26'da "çalıştırılabilir" listesinde.
 * Bu yüzden davranış tek boolean olarak modellenemez; sürüm sürüm tutulur.
 */

import type { Platform } from "../domain/types.js";

export type RiskLevel = "low" | "medium" | "high";
export type CapabilityKind = "trigger" | "action";

/** Bir iddianın kanıt seviyesi. */
export type EvidenceLevel =
  | "apple_docs"
  | "vendor_docs"
  /** İkincil kaynak (haber, geliştirici forumu) — teyit bekliyor */
  | "secondary"
  /** Hiç doğrulanmadı — varsayım yapmak yasak */
  | "unverified"
  /**
   * Phase 3B: gerçek cihazda bizzat test edilip gözlemlendi (Apple
   * dokümanına dayanmıyor). `apple_docs`'tan güçlü — doküman bir
   * capability'nin VAR OLDUĞUNU söyler, bu ise onu gerçekten
   * ÇALIŞTIRDIĞIMIZI kanıtlar (bkz. docs/capabilities.md §1.2).
   */
  | "device_verified";

/** Üçlü mantık: bilmediğimizi "false" diye kaydetmemek için. */
export type Tristate = true | false | "unverified";

/**
 * Belirli bir iOS sürümünden itibaren geçerli davranış. Çözümleme,
 * cihaz sürümünden küçük/eşit en yüksek kaydı seçer.
 */
export interface OSBehavior {
  minOSVersion: number;
  /**
   * Kullanıcı "Ask Before Running"i kapatabiliyor mu? true ise otomasyon
   * sessizce çalışabilir; false ise iOS her tetiklenmede onay sorar.
   */
  canRunWithoutAsking: Tristate;
  source: string;
  verifiedAt: string;
  evidence: EvidenceLevel;
  note?: string;
}

/**
 * Kurulumu kimin yaptığı. Phase 1.5'te bulunan gerçek: üçüncü taraf bir
 * uygulamanın kullanıcı adına tam bir kişisel otomasyon (tetikleyici +
 * eylem) kurmasına izin veren public bir API bulunmuyor. Bu yüzden
 * "automatic" yalnızca kanıtlandığında kullanılabilir.
 */
export type InstallMethod =
  /** Uygulama kullanıcı müdahalesi olmadan kurar — HİÇBİR SATIRDA KANITLANMADI */
  | "automatic"
  /** Uygulama hazırlar, kullanıcı tek dokunuşla içe alır/onaylar */
  | "user_assisted_import"
  /** Kullanıcı Shortcuts içinde adım adım kendisi kurar */
  | "guided_manual"
  /** Bizim App Intent'imiz; Shortcuts'ta eylem olarak görünür */
  | "app_intent_exposure";

export interface Capability {
  id: string;
  platform: Platform;
  kind: CapabilityKind;
  /** Teknik olmayan, kullanıcıya gösterilebilir açıklama (MASTER_SPEC §3) */
  description: string;

  // --- "native destekliyor mu?" ---
  nativeSupport: boolean;
  availableInShortcuts: Tristate;
  appIntentCapable: Tristate;

  // --- "otomatik çalışıyor mu / iOS onay istiyor mu?" ---
  behaviors: OSBehavior[];

  // --- "izin / kurulum" ---
  permissions: string[];
  installMethod: InstallMethod;
  requiresUserSetupStep: boolean;
  fallbackSteps?: string[];
  fallbackMethod?: string;
  /**
   * Yalnızca `kind: "trigger"` için anlamlı. Phase 3B Test 2 (gerçek
   * cihaz), bir Personal Automation tetikleyicisinin programatik olarak
   * BAĞLANAMADIĞINI kanıtladı — kullanıcı bunu Shortcuts'ın Otomasyon
   * sekmesinde elle yapmalı. Bu, o adımın gerçek (uydurulmamış) adım
   * metni; yalnızca gerçek cihazda doğrulanmış tetikleyiciler için
   * doldurulur. Yoksa builder genel/doğrulanmamış bir patern kullanır.
   */
  triggerLinkingSteps?: string[];

  // --- çözümleme ---
  /** Aynı kullanıcı niyetini karşılayan capability'lerin grubu */
  triggerGroup?: string;
  /** Grup içinde tercih sırası; 1 = en çok tercih edilen */
  priority?: number;
  /** Bu capability seçilirse kullanıcıya ÖNCEDEN söylenecekler (docs/ux.md §3.5) */
  userDisclosures?: string[];

  // --- NLU eşlemesi (Phase 2) ---
  /**
   * Bu capability'nin karşıladığı SEMANTIK tetikleyici/eylem adı.
   * NLU katmanı yalnızca semantik isimler üretir; capability id'lerini
   * hiçbir zaman hardcode etmez. Eşleme burada, registry'de yaşar.
   */
  semantic?: string;
  /** Türkçe doğal dil ipuçları; NLU eşlemesi bunlar üzerinden yapılır. */
  nluKeywords?: string[];
  /**
   * Eylem/tetikleyici yalnızca bu uygulamaları kapsıyorsa. Örnek:
   * mesaj tetikleyicisi yalnızca Mesajlar uygulamasını kapsar; WhatsApp
   * için doğrulanmış bir karşılık yok.
   */
  supportedApps?: string[];

  riskLevel: RiskLevel;
  evidence: EvidenceLevel;
  source: string;
  verifiedAt: string;
}
