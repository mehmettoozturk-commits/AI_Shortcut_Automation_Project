// Capability Matrix tipleri — src/capability-registry/types.ts'in
// Swift karşılığı.
//
// KRİTİK MİMARİ KARAR: capability VERİSİ burada tekrar yazılmaz.
// CapabilityRegistry.swift, contracts/capability-registry-snapshot.json
// dosyasını (TS registry'sinin gerçek çıktısı) decode eder. Registry
// tek doğruluk kaynağı olmaya devam eder — iki dilde iki ayrı liste
// TUTMAK, Phase 1.5'in bütün amacını (tek yerden güncellenebilirlik)
// bozar.

import Foundation

public enum RiskLevel: String, Codable, Sendable {
    case low, medium, high
}

public enum CapabilityKind: String, Codable, Sendable {
    case trigger, action
}

public enum EvidenceLevel: String, Codable, Sendable {
    case appleDocs = "apple_docs"
    case vendorDocs = "vendor_docs"
    case secondary
    case unverified
    /// Phase 3B: gerçek cihazda bizzat test edilip gözlemlendi.
    /// `appleDocs`'tan güçlü — doküman VAR OLDUĞUNU söyler, bu ise
    /// gerçekten ÇALIŞTIĞINI kanıtlar (bkz. docs/capabilities.md §1.2).
    case deviceVerified = "device_verified"
}

/// TS tarafındaki `Tristate` (true | false | "unverified") — Swift'te
/// birebir üç durumlu enum olarak modellenir; JSON'da bool ya da string
/// olarak gelebildiği için özel decode gerekir.
public enum Tristate: Sendable, Equatable {
    case yes
    case no
    case unverified
}

extension Tristate: Codable {
    public init(from decoder: Decoder) throws {
        let c = try decoder.singleValueContainer()
        if let b = try? c.decode(Bool.self) {
            self = b ? .yes : .no
            return
        }
        if let s = try? c.decode(String.self), s == "unverified" {
            self = .unverified
            return
        }
        throw DecodingError.dataCorruptedError(in: c, debugDescription: "Geçersiz Tristate değeri")
    }

    public func encode(to encoder: Encoder) throws {
        var c = encoder.singleValueContainer()
        switch self {
        case .yes: try c.encode(true)
        case .no: try c.encode(false)
        case .unverified: try c.encode("unverified")
        }
    }
}

public enum InstallMethod: String, Codable, Sendable {
    /// HİÇBİR satırda kanıtlanmadı (docs/capabilities.md §1.2). Bu
    /// değer registry'de bulunursa CapabilityRegistry.swift
    /// yükleme sırasında reddeder — bkz. `assertNoUnprovenAutomaticInstall()`.
    case automatic
    case userAssistedImport = "user_assisted_import"
    case guidedManual = "guided_manual"
    case appIntentExposure = "app_intent_exposure"
}

public struct OSBehavior: Codable, Sendable, Equatable {
    public var minOSVersion: Int
    public var canRunWithoutAsking: Tristate
    public var source: String
    public var verifiedAt: String
    public var evidence: EvidenceLevel
    public var note: String?
}

public struct Capability: Codable, Sendable, Identifiable, Equatable {
    public var id: String
    public var platform: Platform
    public var kind: CapabilityKind
    public var description: String

    public var nativeSupport: Bool
    public var availableInShortcuts: Tristate
    public var appIntentCapable: Tristate

    public var behaviors: [OSBehavior]

    public var permissions: [String]
    public var installMethod: InstallMethod
    public var requiresUserSetupStep: Bool
    public var fallbackSteps: [String]?
    public var fallbackMethod: String?
    /// Yalnızca `kind: .trigger` için anlamlı. Phase 3B Test 2 (gerçek
    /// cihaz): Personal Automation tetikleyicisi programatik olarak
    /// BAĞLANAMIYOR — kullanıcı bunu Otomasyon sekmesinde elle yapmalı.
    /// Yalnızca gerçek cihazda doğrulanmış tetikleyiciler için doldurulur.
    public var triggerLinkingSteps: [String]?

    public var triggerGroup: String?
    public var priority: Int?
    public var userDisclosures: [String]?

    public var semantic: String?
    public var nluKeywords: [String]?
    public var supportedApps: [String]?

    public var riskLevel: RiskLevel
    public var evidence: EvidenceLevel
    public var source: String
    public var verifiedAt: String
}

/// OS sürümüne göre davranış çözümleme — src/capability-registry/behavior.ts
/// ile birebir aynı mantık.
public enum CapabilityBehavior {
    public static func behavior(for capability: Capability, osVersion: Int) -> OSBehavior? {
        capability.behaviors
            .filter { $0.minOSVersion <= osVersion }
            .max { $0.minOSVersion < $1.minOSVersion }
    }

    public static func canRunWithoutAsking(_ capability: Capability, osVersion: Int) -> Tristate {
        behavior(for: capability, osVersion: osVersion)?.canRunWithoutAsking ?? .unverified
    }
}
