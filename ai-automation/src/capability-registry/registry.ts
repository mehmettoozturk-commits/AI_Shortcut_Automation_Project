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
 * Phase 3B gerçek cihaz testleri (docs/phase3b-validation-plan.md).
 * Cihaz: iPhone 16 Pro, iOS 26. Bu satırlar Apple dokümanına DEĞİL,
 * bizzat gözlemlenen davranışa dayanır — `evidence: "device_verified"`.
 */
const PHASE3B_TEST3_BLUETOOTH_DEVICE = "docs/phase3b-validation-plan.md Test 3 SONUÇ (gerçek iPhone 16 Pro, iOS 26)";
const PHASE3B_TEST5_TESLA_DEVICE = "docs/phase3b-validation-plan.md Test 5 SONUÇ (gerçek Tesla + iPhone 16 Pro, iOS 26)";
const PHASE3B_TEST2_TRIGGER_LINKING = "docs/phase3b-validation-plan.md Test 2 SONUÇ (gerçek iPhone 16 Pro, iOS 26)";
const VERIFIED_PHASE3B = "2026-09-19";

/**
 * Üçüncü taraf uygulamaların kişisel otomasyon kurmasına dair bulgular.
 *
 * Phase 1.5'te bu İKİNCİL kanıta (geliştirici forumu) dayanıyordu.
 * Phase 3B'de (2026-09-18/19) gerçek cihazda doğrudan test edildi:
 *  - Test 1: sıfırdan/imzasız üretilmiş bir `.shortcut` dosyası HİÇBİR
 *    yoldan içe aktarılamadı ("Importing unsigned shortcut files is
 *    not supported").
 *  - Test 2: Apple-imzalı bir şablon içe aktarılabildi, ama Personal
 *    Automation tetikleyicisine bağlanması PROGRAMATİK değildi —
 *    kullanıcı bunu Otomasyon sekmesinde elle yapmak zorunda kaldı.
 * Bu artık "belki mümkündür ama doğrulanmadı" değil, gerçek cihazda
 * gözlemlenmiş bir "hayır" — `possible: false`, `evidence:
 * "device_verified"`.
 */
export const PROGRAMMATIC_AUTOMATION_INSTALL: {
  possible: Tristate;
  assumption: string;
  evidence: EvidenceLevel;
  source: string;
  verifiedAt: string;
} = {
  possible: false,
  assumption:
    "Kurulum iki elle-onay adımı gerektirir: içe aktarma (user_assisted_import) ve otomasyon tetikleyicisini bağlama (linking_trigger). İkisi de programatik değildir.",
  evidence: "device_verified",
  source: `${PHASE3B_TEST2_TRIGGER_LINKING}; ayrıca docs/phase3b-validation-plan.md Test 1/1b`,
  verifiedAt: VERIFIED_PHASE3B,
};

export const CAPABILITIES: Capability[] = [
  /* ---------------- Araç: tetikleyici grubu "vehicle_departure" ---------------- */
  {
    id: "ios.carplay.disconnected",
    platform: "ios",
    kind: "trigger",
    description: "Araçtan inildiğinde (CarPlay bağlantısı kesildiğinde) tetiklenir.",
    displayDescription: "Arabandan CarPlay bağlantın kesildiğinde",
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
    displayDescription: "Telefonunun Bluetooth bağlantısı kesildiğinde",
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
        source: PHASE3B_TEST3_BLUETOOTH_DEVICE,
        verifiedAt: VERIFIED_PHASE3B,
        evidence: "device_verified",
        note: "Gerçek iPhone 16 Pro'da (iOS 26) elle kurulan bir Bluetooth-disconnect otomasyonu, bağlantı gerçekten kesildiğinde onay istemeden çalıştı (Phase 3B Test 3). iOS 16/17/18 hâlâ doğrulanmadı.",
      },
    ],
    permissions: ["bluetooth"],
    installMethod: "user_assisted_import",
    requiresUserSetupStep: true,
    /**
     * Phase 3B Test 2'de kaydedilen GERÇEK Shortcuts akışı (uydurulmadı):
     * kullanıcı bu otomasyonu Otomasyon sekmesinde elle kurdu, ama var
     * olan kestirmeyi eylem olarak seçmek tek dokunuştu.
     */
    triggerLinkingSteps: [
      "Kestirmeler uygulamasını aç → Otomasyon sekmesine geç",
      "Sağ üstten + ile yeni otomasyon oluştur",
      "Tetikleyici olarak Bluetooth → bağlantı kesildiğinde'yi seç, aracının Bluetooth'unu seç",
      "Eylem olarak az önce eklediğin kestirmeyi seç — yeniden kurmana gerek yok, tek dokunuşla eklenir",
      "Bitir",
    ],
    triggerGroup: "vehicle_departure",
    priority: 2,
    userDisclosures: [
      "Eski iOS sürümlerinde bu otomasyon her çalıştığında iPhone sana ayrıca onay sorabilir.",
    ],
    semantic: "vehicle_departure",
    nluKeywords: ["arabadan in", "arabadan çık", "araçtan in", "arabadan ayrıl", "araçtan ayrıl", "arabadan uzaklaş", "bluetooth"],
    riskLevel: "low",
    evidence: "device_verified",
    source: PHASE3B_TEST3_BLUETOOTH_DEVICE,
    verifiedAt: VERIFIED_PHASE3B,
  },
  {
    id: "ios.location.leave",
    platform: "ios",
    kind: "trigger",
    description: "Belirlenen bir yerden (örneğin park alanından) ayrıldığında tetiklenir.",
    displayDescription: "Belirlediğin bir yerden ayrıldığında",
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
    displayDescription: "Her gün belirlediğin saatte",
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
    displayDescription: "Seçtiğin Wi-Fi ağına bağlandığında",
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
    displayDescription: "Belirlediğin kişiden mesaj geldiğinde",
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
    displayDescription: "Bir Odak modunu açtığında veya kapattığında",
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
    displayDescription: "Pilin belirlediğin seviyenin altına düştüğünde",
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
    displayDescription: "Belirlediğin uygulamayı açtığında",
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
    displayDescription: "Devam etmeden önce sana sorar",
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
    displayDescription: "Sana bir bildirim gönderir",
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
    // Phase 5A İş 0.5 (2026-09-19) — gerçek, Apple/iCloud tarafından
    // imzalanmış TEK şablon. Kullanıcının gerçek iPhone'unda Shortcuts
    // uygulamasında elle oluşturup "iCloud Bağlantısını Kopyala" ile
    // paylaştığı, tek eylemli ("Show Notification") bir kestirme.
    // Amaç bu capability'nin kendisini değil user_assisted_import →
    // installed zincirinin mekanizmasını kanıtlamak (bkz.
    // docs/phase5a-e2e-validation-plan.md "İş 0.5").
    template: {
      iCloudURL: "https://www.icloud.com/shortcuts/6cce8a476d664f34997734f87f95fc4b",
      suggestedName: "Bildirim Göster",
    },
  },
  {
    id: "tesla.sentry_mode.toggle",
    platform: "ios",
    kind: "action",
    description: "Tesla'nın Sentry Mode (gözcü modu) özelliğini açar veya kapatır.",
    displayDescription: "Tesla'nın Sentry Mode özelliğini açar veya kapatır",
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
      {
        minOSVersion: 26,
        canRunWithoutAsking: true,
        source: PHASE3B_TEST5_TESLA_DEVICE,
        verifiedAt: VERIFIED_PHASE3B,
        evidence: "device_verified",
        note: "Gerçek Tesla + iPhone 16 Pro'da (iOS 26) doğrulandı: eylem hem tek başına hem de bir Bluetooth-disconnect otomasyonu içinde onay istemeden çalıştı VE aracı gerçekten etkiledi (Tesla uygulamasından teyit edildi). ÖNEMLİ KOŞUL: bu yalnızca eylemin parametresi (Enable/Disable) SABİT bir değere ayarlandığında geçerli — 'Her Seferinde Sor' bırakılırsa otomasyon içinde bile interaktif soru çıkar. AI/compiler'ın ürettiği her çağrı bu parametreyi somut bir değerle doldurmalı.",
      },
    ],
    permissions: ["tesla_account"],
    installMethod: "user_assisted_import",
    requiresUserSetupStep: true,
    /**
     * Phase 3B Test 5, Phase 3C-1: eylemin gerçek Shortcuts eyleminde
     * bir Enable/Disable parametresi var; sabitlenmezse ("Her Seferinde
     * Sor") otomasyon içinde bile interaktif soru çıkıyor. Compiler bu
     * parametrenin somut bir değerle geldiğini zorunlu kılar (bkz.
     * capability-validator.ts).
     */
    parameters: [
      {
        name: "mode",
        type: "enum",
        required: true,
        allowed: ["enable", "disable"],
        // NLU henüz "aç"/"kapat" ayrımını semantik detay olarak
        // üretmiyor (yalnızca "aç" cümleleri test edildi); registry
        // bu boşluk için açık bir varsayılan sağlıyor.
        defaultValue: "enable",
      },
    ],
    semantic: "vehicle_sentry_mode",
    nluKeywords: ["sentry", "gözcü"],
    riskLevel: "medium",
    evidence: "device_verified",
    source: PHASE3B_TEST5_TESLA_DEVICE,
    verifiedAt: VERIFIED_PHASE3B,
  },
  {
    id: "tesla.climate.start",
    platform: "ios",
    kind: "action",
    description: "Tesla'nın klimasını/ön ısıtmasını başlatır.",
    displayDescription: "Tesla'nın klimasını çalıştırır",
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
    displayDescription: "Tesla'nın kapılarını kilitler",
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
    displayDescription: "Tesla'nın kameralarını açar",
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
