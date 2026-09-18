// Shortcuts handoff abstraction.
//
// Doğrulanan gerçek (support.apple.com/guide/shortcuts/apdcd7f20a6f/,
// 2026-09-18 erişildi): Shortcuts, `x-callback-url` standardını
// destekler. `shortcuts://x-callback-url/run-shortcut?...&x-success=
// &x-cancel=&x-error=` bir shortcut'ı ÇALIŞTIRIR ve sonucu geri
// bildirir.
//
// ⚠️ DOĞRULANMAMIŞ (ikincil kaynak, Phase 3B'de resmi Apple
// dokümanıyla teyit edilmeli): `shortcuts://import-shortcut?url=...`
// şemasının bir .shortcut dosyasını İÇE AKTARDIĞI iddia ediliyor. Bunu
// kullanan bir kaynak buldum ama Apple'ın kendi guide sayfasında
// açıkça göremedim.
//
// ⚠️ AÇIK SORU (docs/capabilities.md §1.2'nin devamı): import-shortcut
// bir .shortcut dosyasını (eylem dizisini) aktarabilse bile, bunun bir
// TETİKLEYİCİYLE (Personal Automation — "Bluetooth bağlantısı
// kesildiğinde") birlikte içe aktarılabildiğine dair HİÇBİR kanıt yok.
// Muhtemel gerçek: uygulama yalnızca EYLEM kısmını aktarabilir;
// kullanıcı otomasyonun tetikleyicisini Shortcuts uygulamasının
// Otomasyon sekmesinde kendisi oluşturmak zorunda kalabilir. Bu,
// "Kestirmelere Ekle" tek dokunuşunun aslında "eylem hazır, tetikleyici
// için Otomasyon sekmesine git" şeklinde iki adıma çıkabileceği
// anlamına gelir. BU FARK docs/ux.md'nin §3.6.b metnini etkiler ve
// Phase 3B'nin İLK doğrulama maddesidir.

import Foundation

public struct ShortcutHandoffRequest: Sendable, Equatable {
    /// Kestirmeler'e aktarılacak eylem dizisinin adı.
    public var suggestedName: String
    /// Aktarılacak .shortcut içeriğinin nasıl üretileceği Phase 3B'de
    /// netleşecek (muhtemelen bir .plist/binary property list
    /// serileştirmesi). Şimdilik yalnızca planı taşıyoruz.
    public var plan: DraftAutomationPlan
}

public enum ShortcutHandoffOutcome: Sendable, Equatable {
    case userCompletedImport
    case userCancelled
    case failed(reason: String)
}

/// Kurulumun kullanıcıya aktarılması. Gerçek implementasyon Phase 3B'de
/// `UIApplication.shared.open(_:)` ile `shortcuts://` URL'i açacak ve
/// x-callback-url ile geri dönüşü dinleyecek — ama bu protokol
/// `SetupService`'ten (Ports.swift) bilerek AYRI tutuldu, çünkü
/// `SetupService.prepare` yalnızca PAKETİ hazırlar; bu protokol
/// kullanıcıyı Apple'ın arayüzüne AKTARIR. BuilderMachine ikisini
/// birbirine bağımlı kılmaz — bu da `waiting_for_user`'dan otomatik
/// ilerleme olmaması gerçeğiyle tutarlıdır: uygulama, x-success
/// callback'ini alsa bile bunu "kuruldu" olarak YORUMLAMAMALIDIR, çünkü
/// yukarıdaki açık soru netleşmeden x-success'in tam olarak neyi
/// doğruladığı belirsizdir. Kullanıcı onayı (confirmInstalledByUser)
/// birincil kaynak olmaya devam eder.
public protocol ShortcutsHandoff: Sendable {
    func present(_ request: ShortcutHandoffRequest) async -> ShortcutHandoffOutcome
}

/// MOCK — hiçbir URL açmaz, gerçek Shortcuts uygulamasıyla konuşmaz.
public actor MockShortcutsHandoff: ShortcutsHandoff {
    private let outcome: ShortcutHandoffOutcome
    public private(set) var presented: [ShortcutHandoffRequest] = []

    public init(outcome: ShortcutHandoffOutcome = .userCompletedImport) {
        self.outcome = outcome
    }

    public func present(_ request: ShortcutHandoffRequest) async -> ShortcutHandoffOutcome {
        presented.append(request)
        return outcome
    }
}
