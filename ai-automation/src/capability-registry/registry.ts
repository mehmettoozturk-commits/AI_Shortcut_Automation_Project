/**
 * Capability Matrix — Phase 1.5.
 *
 * Her satır doğrulanmış bir kaynağa dayanır ve kanıt seviyesi işaretlidir.
 * CLAUDE.md: "Apple/Android tarafından desteklenmeyen bir özelliği
 * varsayma." Bilinmeyen alanlar `"unverified"` olarak işaretlenir —
 * asla `false` diye tahmin edilmez.
 *
 * Ana kaynaklar (doğrulama: 2026-09-17):
 *  A) Setting triggers (Bluetooth, Wi-Fi, Focus, Low Power, Battery, Charger):
 *     https://support.apple.com/guide/shortcuts/apde31e9638b/ios
 *  B) Event triggers (Time of Day, Alarm, Sleep, Workout):
 *     https://support.apple.com/guide/shortcuts/apd932ff833f/ios
 *  C) "Onaysız çalışabilen otomasyonlar" listesi, iOS 26:
 *     https://support.apple.com/en-kg/guide/shortcuts/apd602971e63/9.0/ios/26
 *  D) Aynı sayfanın iOS 15 sürümü (davranış farkı burada görülüyor):
 *     https://support.apple.com/en-kg/guide/shortcuts/apd602971e63/5.0/ios
 *  E) Tesla resmi Shortcuts desteği (eylem listesi):
 *     https://www.iphoneincanada.ca/2023/08/20/tesla-apple-siri-shortcuts/
 */

import type { Capability, EvidenceLevel, Tristate } from "./types.js";

const APPLE_AUTORUN_26 = "https://support.apple.com/en-kg/guide/shortcuts/apd602971e63/9.0/ios/26";
const APPLE_AUTORUN_15 = "https://support.apple.com/en-kg/guide/shortcuts/apd602971e63/5.0/ios";
const APPLE_SETTING_TRIGGERS = "https://support.apple.com/guide/shortcuts/apde31e9638b/ios";
const APPLE_EVENT_TRIGGERS = "https://support.apple.com/guide/shortcuts/apd932ff833f/ios";
const APPLE_TRAVEL_TRIGGERS = "https://support.apple.com/guide/shortcuts/apd8ebfc4e8e/ios";
const APPLE_COMM_TRIGGERS = "https://support.apple.com/guide/shortcuts/apdd711f9dff/ios";
const TESLA_SHORTCUTS = "https://www.iphoneincanada.ca/2023/08/20/tesla-apple-siri-shortcuts/";
const VERIFIED = "2026-09-17";

/**
 * Üçüncü taraf uygulamaların kişisel otomasyon kurmasına dair bulgular:
 * Apple geliştirici forumlarında geliştiriciler programatik olarak
 * shortcut/automation oluşturmanın yolunu bulamadıklarını bildiriyor ve
 * Apple'ın önerdiği yol App Intents ile eylem sunmak + kullanıcının
 * kendisinin otomasyon kurması. Bu İKİNCİL kanıt seviyesindedir ve
 * Phase 3'te resmi dokümanla teyit edilmelidir — ama tersini varsaymak
 * (yani "otomatik kurabiliriz") kesinlikle yasak.
 */
export const PROGRAMMATIC_AUTOMATION_INSTALL: {
  possible: Tristate;
  assumption: string;
  evidence: EvidenceLevel;
  source: string;
  verifiedAt: string;
} = {
  possible: "unverified",
  assumption: "Kurulum en iyi durumda kullanıcı onaylı içe alma (user_assisted_import) kabul edilir.",
  evidence: "secondary",
  source: "https://developer.apple.com/forums/thread/773521 + https://developer.apple.com/forums/topics/app-and-system-services/automation-and-scripting",
  verifiedAt: VERIFIED,
};

export const CAPABILITIES: Capability[] = [
  /* ---------------- Araç: tetikleyici grubu "vehicle_departure" ---------------- */
  {
    id: "ios.carplay.disconnected",
    platform: "ios",
    kind: "trigger",
    description: "Araçtan inildiğinde (CarPlay bağlantısı kesildiğinde) tetiklenir.",
    nativeSupport: true,
    availableInShortcuts: true,
    appIntentCapable: "unverified",
    behaviors: [
      {
        minOSVersion: 15,
        canRunWithoutAsking: true,
        source: APPLE_AUTORUN_15,
        verifiedAt: VERIFIED,
        evidence: "apple_docs",
        note: "CarPlay, iOS 15'te de onaysız çalışabilenler listesinde.",
      },
    ],
    permissions: [],
    installMethod: "user_assisted_import",
    requiresUserSetupStep: true,
    triggerGroup: "vehicle_departure",
    priority: 1,
    userDisclosures: ["Bu otomasyon yalnızca CarPlay kullanan araçlarda çalışır."],
    semantic: "vehicle_departure",
    nluKeywords: ["carplay"],
    riskLevel: "low",
    evidence: "apple_docs",
    source: APPLE_AUTORUN_15,
    verifiedAt: VERIFIED,
  },
  {
    id: "ios.bluetooth.disconnected",
    platform: "ios",
    kind: "trigger",
    description: "Seçilen Bluetooth cihazının bağlantısı kesildiğinde tetiklenir.",
    nativeSupport: true,
    availableInShortcuts: true,
    appIntentCapable: "unverified",
    behaviors: [
      {
        minOSVersion: 15,
        canRunWithoutAsking: false,
        source: APPLE_AUTORUN_15,
        verifiedAt: VERIFIED,
        evidence: "apple_docs",
        note: "iOS 15: Bluetooth, onaysız çalıştırılamayan tetikleyiciler listesinde.",
      },
      {
        minOSVersion: 26,
        canRunWithoutAsking: true,
        source: APPLE_AUTORUN_26,
        verifiedAt: VERIFIED,
        evidence: "apple_docs",
        note: "iOS 26: Bluetooth artık onaysız çalışabilenler listesinde. iOS 16/17/18 doğrulanmadı.",
      },
    ],
    permissions: ["bluetooth"],
    installMethod: "user_assisted_import",
    requiresUserSetupStep: true,
    triggerGroup: "vehicle_departure",
    priority: 2,
    userDisclosures: [
      "Eski iOS sürümlerinde bu otomasyon her çalıştığında iPhone sana ayrıca onay sorabilir.",
    ],
    semantic: "vehicle_departure",
    nluKeywords: ["arabadan in", "arabadan çık", "araçtan in", "arabadan ayrıl", "araçtan ayrıl", "arabadan uzaklaş", "bluetooth"],
    riskLevel: "low",
    evidence: "apple_docs",
    source: APPLE_SETTING_TRIGGERS,
    verifiedAt: VERIFIED,
  },
  {
    id: "ios.location.leave",
    platform: "ios",
    kind: "trigger",
    description: "Belirlenen bir yerden (örneğin park alanından) ayrıldığında tetiklenir.",
    nativeSupport: true,
    availableInShortcuts: true,
    appIntentCapable: "unverified",
    behaviors: [
      {
        minOSVersion: 15,
        canRunWithoutAsking: false,
        source: APPLE_AUTORUN_15,
        verifiedAt: VERIFIED,
        evidence: "apple_docs",
      },
      {
        minOSVersion: 26,
        canRunWithoutAsking: true,
        source: APPLE_AUTORUN_26,
        verifiedAt: VERIFIED,
        evidence: "apple_docs",
      },
    ],
    permissions: ["location_always"],
    installMethod: "user_assisted_import",
    requiresUserSetupStep: true,
    triggerGroup: "vehicle_departure",
    priority: 3,
    userDisclosures: [
      "Konum tabanlı otomasyon, Bluetooth/CarPlay'in birebir eşdeğeri değildir: aracı değil telefonun konumunu takip eder ve sürekli konum izni gerektirir.",
    ],
    semantic: "location_leave",
    nluKeywords: ["ayrılınca", "uzaklaşınca", "çıkınca"],
    riskLevel: "medium",
    evidence: "apple_docs",
    source: APPLE_TRAVEL_TRIGGERS,
    verifiedAt: VERIFIED,
  },

  /* ---------------- Diğer tetikleyiciler ---------------- */
  {
    id: "ios.time_of_day.daily",
    platform: "ios",
    kind: "trigger",
    description: "Her gün belirlenen saatte tetiklenir.",
    nativeSupport: true,
    availableInShortcuts: true,
    appIntentCapable: "unverified",
    behaviors: [
      { minOSVersion: 15, canRunWithoutAsking: true, source: APPLE_AUTORUN_15, verifiedAt: VERIFIED, evidence: "apple_docs" },
    ],
    permissions: [],
    installMethod: "user_assisted_import",
    requiresUserSetupStep: true,
    semantic: "time",
    nluKeywords: ["saat", "her akşam", "her sabah", "her gün", "her gece"],
    riskLevel: "low",
    evidence: "apple_docs",
    source: APPLE_EVENT_TRIGGERS,
    verifiedAt: VERIFIED,
  },
  {
    id: "ios.wifi.connected",
    platform: "ios",
    kind: "trigger",
    description: "Seçilen Wi-Fi ağına bağlanıldığında tetiklenir.",
    nativeSupport: true,
    availableInShortcuts: true,
    appIntentCapable: "unverified",
    behaviors: [
      { minOSVersion: 15, canRunWithoutAsking: false, source: APPLE_AUTORUN_15, verifiedAt: VERIFIED, evidence: "apple_docs" },
      { minOSVersion: 26, canRunWithoutAsking: true, source: APPLE_AUTORUN_26, verifiedAt: VERIFIED, evidence: "apple_docs" },
    ],
    permissions: [],
    installMethod: "user_assisted_import",
    requiresUserSetupStep: true,
    userDisclosures: [
      "Eski iOS sürümlerinde bu otomasyon her çalıştığında iPhone sana ayrıca onay sorabilir.",
    ],
    semantic: "wifi_connected",
    nluKeywords: ["wifi", "wi-fi", "kablosuz"],
    riskLevel: "low",
    evidence: "apple_docs",
    source: APPLE_SETTING_TRIGGERS,
    verifiedAt: VERIFIED,
  },
  {
    id: "ios.message.received",
    platform: "ios",
    kind: "trigger",
    description: "Belirlenen kişiden mesaj geldiğinde tetiklenir.",
    nativeSupport: true,
    availableInShortcuts: true,
    appIntentCapable: "unverified",
    behaviors: [
      { minOSVersion: 15, canRunWithoutAsking: false, source: APPLE_AUTORUN_15, verifiedAt: VERIFIED, evidence: "apple_docs" },
      { minOSVersion: 26, canRunWithoutAsking: true, source: APPLE_AUTORUN_26, verifiedAt: VERIFIED, evidence: "apple_docs" },
    ],
    permissions: [],
    installMethod: "user_assisted_import",
    requiresUserSetupStep: true,
    userDisclosures: [
      "Yalnızca Mesajlar uygulamasını kapsar. WhatsApp gibi uygulamalar için böyle bir tetikleyici doğrulanmadı.",
    ],
    semantic: "incoming_message",
    nluKeywords: ["mesaj gel", "yazınca", "yazdığında", "mesaj at"],
    supportedApps: ["Mesajlar", "Messages", "iMessage"],
    riskLevel: "medium",
    evidence: "apple_docs",
    source: APPLE_COMM_TRIGGERS,
    verifiedAt: VERIFIED,
  },
  {
    id: "ios.focus.changed",
    platform: "ios",
    kind: "trigger",
    description: "Bir Odak modu açıldığında veya kapandığında tetiklenir.",
    nativeSupport: true,
    availableInShortcuts: true,
    appIntentCapable: "unverified",
    behaviors: [
      {
        minOSVersion: 15,
        canRunWithoutAsking: "unverified",
        source: APPLE_AUTORUN_26,
        verifiedAt: VERIFIED,
        evidence: "unverified",
        note: "Focus, Apple'ın onaysız çalışabilenler/çalışamayanlar listelerinin HİÇBİRİNDE geçmiyor. Tahmin yapılmadı.",
      },
    ],
    permissions: [],
    installMethod: "user_assisted_import",
    requiresUserSetupStep: true,
    semantic: "focus_changed",
    nluKeywords: ["odak", "focus", "rahatsız etme"],
    riskLevel: "low",
    evidence: "apple_docs",
    source: APPLE_SETTING_TRIGGERS,
    verifiedAt: VERIFIED,
  },
  {
    id: "ios.battery.falls_below",
    platform: "ios",
    kind: "trigger",
    description: "Pil seviyesi belirlenen yüzdenin altına düştüğünde tetiklenir.",
    nativeSupport: true,
    availableInShortcuts: true,
    appIntentCapable: "unverified",
    behaviors: [
      { minOSVersion: 15, canRunWithoutAsking: true, source: APPLE_AUTORUN_15, verifiedAt: VERIFIED, evidence: "apple_docs" },
    ],
    permissions: [],
    installMethod: "user_assisted_import",
    requiresUserSetupStep: true,
    semantic: "battery_below",
    nluKeywords: ["pil", "şarj", "batarya", "yüzde"],
    riskLevel: "low",
    evidence: "apple_docs",
    source: APPLE_SETTING_TRIGGERS,
    verifiedAt: VERIFIED,
  },
  {
    id: "ios.app.opened",
    platform: "ios",
    kind: "trigger",
    description: "Belirlenen uygulama açıldığında tetiklenir.",
    nativeSupport: true,
    availableInShortcuts: true,
    appIntentCapable: "unverified",
    behaviors: [
      { minOSVersion: 15, canRunWithoutAsking: true, source: APPLE_AUTORUN_15, verifiedAt: VERIFIED, evidence: "apple_docs" },
    ],
    permissions: [],
    installMethod: "user_assisted_import",
    requiresUserSetupStep: true,
    semantic: "app_opened",
    nluKeywords: ["uygulamasını açınca", "uygulama açıl"],
    riskLevel: "low",
    evidence: "apple_docs",
    source: APPLE_AUTORUN_15,
    verifiedAt: VERIFIED,
  },

  /* ---------------- Eylemler ---------------- */
  {
    id: "ios.ask_confirmation",
    platform: "ios",
    kind: "action",
    description: "Kullanıcıya evet/hayır sorusu gösterir ve cevabı bekler.",
    nativeSupport: true,
    availableInShortcuts: true,
    appIntentCapable: true,
    behaviors: [
      {
        minOSVersion: 15,
        canRunWithoutAsking: false,
        source: "https://support.apple.com/guide/shortcuts/apdb9661c761/ios",
        verifiedAt: VERIFIED,
        evidence: "apple_docs",
        note: "Show Alert eylemi doğası gereği kullanıcı etkileşimi ister.",
      },
    ],
    permissions: [],
    installMethod: "user_assisted_import",
    requiresUserSetupStep: true,
    semantic: "ask_confirmation",
    nluKeywords: ["sor", "isteyip istemediğimi"],
    riskLevel: "low",
    evidence: "apple_docs",
    source: "https://support.apple.com/guide/shortcuts/apdb9661c761/ios",
    verifiedAt: VERIFIED,
  },
  {
    id: "ios.notification.show",
    platform: "ios",
    kind: "action",
    description: "Kullanıcıya bir bildirim gösterir.",
    nativeSupport: true,
    availableInShortcuts: true,
    appIntentCapable: true,
    behaviors: [
      {
        minOSVersion: 15,
        canRunWithoutAsking: true,
        source: "https://support.apple.com/guide/shortcuts/apd2175adcab/ios",
        verifiedAt: VERIFIED,
        evidence: "apple_docs",
      },
    ],
    permissions: ["notifications"],
    installMethod: "user_assisted_import",
    requiresUserSetupStep: true,
    semantic: "notify",
    nluKeywords: ["hatırlat", "haber ver", "bildir", "uyar", "bildirim"],
    riskLevel: "low",
    evidence: "apple_docs",
    // Önceki ikincil kaynak, Apple'ın Shortcuts kullanım kılavuzundaki
    // "Use the Show Notification action" sayfasıyla değiştirildi.
    source: "https://support.apple.com/guide/shortcuts/apd2175adcab/ios",
    verifiedAt: VERIFIED,
  },
  {
    id: "tesla.sentry_mode.toggle",
    platform: "ios",
    kind: "action",
    description: "Tesla'nın Sentry Mode (gözcü modu) özelliğini açar veya kapatır.",
    nativeSupport: true,
    availableInShortcuts: true,
    appIntentCapable: false,
    behaviors: [
      {
        minOSVersion: 15,
        canRunWithoutAsking: "unverified",
        source: TESLA_SHORTCUTS,
        verifiedAt: VERIFIED,
        evidence: "secondary",
        note: "Tesla'nın kendi eyleminin 'otomatik çalıştır' ayarını desteklediği doğrulanmadı.",
      },
    ],
    permissions: ["tesla_account"],
    installMethod: "user_assisted_import",
    requiresUserSetupStep: true,
    semantic: "vehicle_sentry_mode",
    nluKeywords: ["sentry", "gözcü"],
    riskLevel: "medium",
    evidence: "vendor_docs",
    source: TESLA_SHORTCUTS,
    verifiedAt: VERIFIED,
  },
  {
    id: "tesla.climate.start",
    platform: "ios",
    kind: "action",
    description: "Tesla'nın klimasını/ön ısıtmasını başlatır.",
    nativeSupport: true,
    availableInShortcuts: true,
    appIntentCapable: false,
    behaviors: [
      {
        minOSVersion: 15,
        canRunWithoutAsking: "unverified",
        source: TESLA_SHORTCUTS,
        verifiedAt: VERIFIED,
        evidence: "secondary",
        note: "Tesla eyleminin 'otomatik çalıştır' ayarını desteklediği doğrulanmadı.",
      },
    ],
    permissions: ["tesla_account"],
    installMethod: "user_assisted_import",
    requiresUserSetupStep: true,
    semantic: "vehicle_climate",
    nluKeywords: ["klima", "ısıt", "soğut", "ön ısıt"],
    riskLevel: "medium",
    evidence: "vendor_docs",
    source: TESLA_SHORTCUTS,
    verifiedAt: VERIFIED,
  },
  {
    id: "tesla.doors.lock",
    platform: "ios",
    kind: "action",
    description: "Tesla'nın kapılarını kilitler.",
    nativeSupport: true,
    availableInShortcuts: true,
    appIntentCapable: false,
    behaviors: [
      {
        minOSVersion: 15,
        canRunWithoutAsking: "unverified",
        source: TESLA_SHORTCUTS,
        verifiedAt: VERIFIED,
        evidence: "secondary",
        note: "Tesla eyleminin 'otomatik çalıştır' ayarını desteklediği doğrulanmadı. Kapı kilidi yüksek riskli: onaysız çalıştırma varsayılmamalı.",
      },
    ],
    permissions: ["tesla_account"],
    installMethod: "user_assisted_import",
    requiresUserSetupStep: true,
    semantic: "vehicle_lock",
    nluKeywords: ["kilitle", "kilit"],
    riskLevel: "high",
    evidence: "vendor_docs",
    source: TESLA_SHORTCUTS,
    verifiedAt: VERIFIED,
  },
  {
    id: "tesla.camera_action",
    platform: "ios",
    kind: "action",
    description: "Tesla'nın canlı kamera/Sentry görüntüsünü açar.",
    // Tesla'nın yayınlanan Shortcuts eylem listesinde canlı kamera YOK.
    nativeSupport: false,
    availableInShortcuts: false,
    appIntentCapable: false,
    behaviors: [],
    permissions: ["tesla_account"],
    installMethod: "guided_manual",
    requiresUserSetupStep: true,
    fallbackMethod: "Native Shortcuts aksiyonu yok; kullanıcı Tesla uygulamasından açar.",
    fallbackSteps: [
      "Tesla uygulamasını aç",
      "Aracını seç",
      "Kamera / Sentry sekmesine git",
      "Canlı görüntüyü başlat",
    ],
    semantic: "vehicle_camera",
    nluKeywords: ["kamera", "canlı görüntü"],
    riskLevel: "medium",
    evidence: "vendor_docs",
    source: TESLA_SHORTCUTS + " (desteklenen eylem listesinde kamera yok)",
    verifiedAt: VERIFIED,
  },
];

export function findCapability(id: string): Capability | undefined {
  return CAPABILITIES.find((c) => c.id === id);
}

export function capabilitiesForPlatform(platform: Capability["platform"]): Capability[] {
  return CAPABILITIES.filter((c) => c.platform === platform);
}

export function capabilitiesInGroup(group: string): Capability[] {
  return CAPABILITIES.filter((c) => c.triggerGroup === group).sort(
    (a, b) => (a.priority ?? 99) - (b.priority ?? 99)
  );
}

/** Semantik ada göre capability arar (NLU eşlemesi registry'de yaşar). */
export function findBySemantic(
  semantic: string,
  kind: Capability["kind"],
  platform: Capability["platform"] = "ios"
): Capability[] {
  return CAPABILITIES.filter(
    (c) => c.semantic === semantic && c.kind === kind && c.platform === platform
  ).sort((a, b) => (a.priority ?? 99) - (b.priority ?? 99));
}

/** Aynı semantik ailedeki desteklenen alternatifler. */
export function supportedAlternativesFor(capabilityId: string): Capability[] {
  const cap = findCapability(capabilityId);
  const namespace = capabilityId.split(".")[0];
  return CAPABILITIES.filter(
    (c) =>
      c.kind === (cap?.kind ?? "action") &&
      c.availableInShortcuts === true &&
      c.id !== capabilityId &&
      c.id.startsWith(namespace + ".")
  );
}
