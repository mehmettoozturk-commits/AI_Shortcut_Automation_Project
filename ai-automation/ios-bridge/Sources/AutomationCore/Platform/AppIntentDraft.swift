// App Intent protokol taslağı.
//
// Bu dosya gerçek `AppIntents` framework'ünü İÇE AKTARMAZ (import
// AppIntents), çünkü bu framework'e karşı derleme yapılamayan bir
// ortamdayız ve yanlış bir API yüzeyi varsaymak istemiyoruz. Bunun
// yerine, Apple'ın resmi AppIntents dokümantasyonundan DOĞRULANMIŞ
// şekli burada bir "taslak protokol" olarak yansıtıyoruz — Phase 3B'de
// Xcode'da gerçek `import AppIntents` ile değiştirilecek, aşağıdaki
// yorumlar o zaman silinecek.
//
// Doğrulanan gerçek Apple sözleşmesi (developer.apple.com/documentation/
// AppIntents, 2026-09-18 erişildi):
//   protocol AppIntent: PersistentlyIdentifiable, Sendable { ... }
//   - static var title: LocalizedStringResource
//   - @Parameter property wrapper ile girdi parametreleri
//   - func perform() async throws -> some IntentResult
//   - Siri/Shortcuts'a görünürlük için AppShortcutsProvider +
//     @AppShortcutsBuilder ayrı bir adım (uygulamanın kendi App
//     Shortcuts'ları için; bizim ürünümüzdeki gibi TESLA'nın kendi
//     App Intent'lerini KULLANMAK farklı bir şey — biz kendi intent'imizi
//     tanımlamıyoruz, Tesla'nınkini çağırıyoruz. Bu ayrım Phase 3B'de
//     netleştirilmeli, bkz. docs/ios-bridge.md.)

import Foundation

/// Gerçek `AppIntents.AppIntent` protokolünün taslak yansıması.
/// Phase 3B'de bu protokolü SİLİP yerine gerçek framework'ü
/// kullanacağız; şimdilik yalnızca şekli belgelemek için var.
public protocol AppIntentDraft: Sendable {
    associatedtype PerformResult

    /// Kullanıcıya gösterilecek başlık.
    static var titleKey: String { get }

    /// Gerçek framework'te `async throws -> some IntentResult`.
    /// Burada tip parametreli tutuluyor çünkü `some IntentResult`
    /// framework olmadan ifade edilemez.
    func perform() async throws -> PerformResult
}

/// Bizim senaryomuzda (Tesla Sentry Mode açma) kendi App Intent'imizi
/// TANIMLAMIYORUZ — Tesla'nın kendi resmi App Intent'ini/Shortcuts
/// eylemini ÇAĞIRIYORUZ. Bu protokol, "bir capability'nin arkasında
/// çağrılabilir bir App Intent var mı" sorusunu (Capability.appIntentCapable)
/// somutlaştırır; gerçek çağrı mekanizması Phase 3B'de netleşecek
/// (muhtemelen INIntent tabanlı Siri eylemleri ya da Shortcuts URL şeması).
public protocol ExternalAppIntentInvoker: Sendable {
    /// Bir capability id'si için, o eylemi tetikleyecek harici App
    /// Intent'i (varsa) çağırır. Capability.appIntentCapable != .yes
    /// olan id'ler için bu metod ÇAĞRILMAMALIDIR — çağıran taraf
    /// önce registry'yi kontrol etmelidir.
    func invoke(capabilityId: String, parameters: [String: AnyCodable]) async throws
}

/// MOCK — gerçek hiçbir App Intent çağırmaz, yalnızca çağrıldığını
/// kaydeder. Phase 3B'de gerçek implementasyon Tesla'nın App
/// Intent'ini (doğrulanırsa) ya da Shortcuts URL şemasını kullanacak.
public actor MockAppIntentInvoker: ExternalAppIntentInvoker {
    public private(set) var invocations: [(capabilityId: String, parameters: [String: AnyCodable])] = []

    public init() {}

    public func invoke(capabilityId: String, parameters: [String: AnyCodable]) async throws {
        invocations.append((capabilityId, parameters))
    }
}
