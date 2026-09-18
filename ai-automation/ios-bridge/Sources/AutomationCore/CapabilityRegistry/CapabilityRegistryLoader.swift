// Registry yükleyici — src/capability-registry/registry.ts'in
// VERİSİNİ tekrar yazmaz; bundled JSON snapshot'ı decode eder.
//
// Phase 3B'de bu snapshot'ın nasıl güncel tutulacağı açık bir karardır
// (bkz. docs/ios-bridge.md "Açık işler" #1): build-time script mı,
// yoksa runtime'da backend'den mi çekilecek. Şimdilik statik JSON.

import Foundation

public enum CapabilityRegistryError: Error, Sendable {
    case snapshotNotFound
    case decodingFailed(String)
    case contractViolation(String)
}

// @unchecked Sendable: tüm depolanan alanlar `let` ve değer tipleri,
// ama Swift 5.9'un otomatik final-class Sendable sentezine güvenmek
// yerine bunu açıkça belirtiyoruz (Xcode'da doğrulanmadı).
public final class CapabilityRegistry: @unchecked Sendable {
    public let capabilities: [Capability]
    private let byId: [String: Capability]

    public init(capabilities: [Capability]) throws {
        self.capabilities = capabilities
        self.byId = Dictionary(uniqueKeysWithValues: capabilities.map { ($0.id, $0) })
        try Self.assertNoUnprovenAutomaticInstall(capabilities)
    }

    /// Bundle'daki JSON snapshot'tan yükler (contracts/capability-registry-snapshot.json
    /// buraya `Resources/capability-registry-snapshot.json` olarak kopyalanır).
    public static func loadFromBundle(_ bundle: Bundle) throws -> CapabilityRegistry {
        guard let url = bundle.url(forResource: "capability-registry-snapshot", withExtension: "json") else {
            throw CapabilityRegistryError.snapshotNotFound
        }
        let data = try Data(contentsOf: url)
        return try load(from: data)
    }

    /// `Bundle.module` SwiftPM tarafından üretilen erişimci `internal`
    /// olduğu için public bir fonksiyonun default argüman değeri olarak
    /// kullanılamaz (bkz. docs/ios-bridge.md §6.3) — bu yüzden ayrı,
    /// parametresiz bir overload olarak tanımlandı.
    public static func loadFromBundle() throws -> CapabilityRegistry {
        try loadFromBundle(.module)
    }

    public static func load(from data: Data) throws -> CapabilityRegistry {
        do {
            let capabilities = try JSONDecoder().decode([Capability].self, from: data)
            return try CapabilityRegistry(capabilities: capabilities)
        } catch let error as DecodingError {
            throw CapabilityRegistryError.decodingFailed(String(describing: error))
        }
    }

    /// docs/capabilities.md §1.2: programatik kurulum doğrulanmadı.
    /// Snapshot'ta `installMethod: "automatic"` olan bir satır varsa,
    /// bu registry'nin TS tarafındaki sözleşme ihlali anlamına gelir —
    /// Swift tarafı bunu sessizce kabul ETMEZ, fırlatır.
    private static func assertNoUnprovenAutomaticInstall(_ capabilities: [Capability]) throws {
        let offenders = capabilities.filter { $0.installMethod == .automatic }
        guard offenders.isEmpty else {
            let ids = offenders.map(\.id).joined(separator: ", ")
            throw CapabilityRegistryError.contractViolation(
                "Doğrulanmamış 'automatic' kurulum yöntemi bulundu: \(ids)"
            )
        }
    }

    public func find(_ id: String) -> Capability? { byId[id] }

    public func capabilities(platform: Platform) -> [Capability] {
        capabilities.filter { $0.platform == platform }
    }

    public func inGroup(_ group: String) -> [Capability] {
        capabilities
            .filter { $0.triggerGroup == group }
            .sorted { ($0.priority ?? 99) < ($1.priority ?? 99) }
    }

    public func bySemantic(_ semantic: String, kind: CapabilityKind, platform: Platform = .ios) -> [Capability] {
        capabilities
            .filter { $0.semantic == semantic && $0.kind == kind && $0.platform == platform }
            .sorted { ($0.priority ?? 99) < ($1.priority ?? 99) }
    }

    /// Aynı semantik aileden desteklenen alternatifler —
    /// src/capability-registry/registry.ts supportedAlternativesFor().
    public func supportedAlternatives(for capabilityId: String) -> [Capability] {
        guard let cap = find(capabilityId) else { return [] }
        let namespace = capabilityId.split(separator: ".").first.map(String.init) ?? ""
        return capabilities.filter {
            $0.kind == cap.kind
                && $0.availableInShortcuts == .yes
                && $0.id != capabilityId
                && $0.id.hasPrefix(namespace + ".")
        }
    }
}

// MARK: - Resolver (docs/capabilities.md §3 — üç seviyeli araç yaklaşımı)

public struct DeviceContext: Sendable {
    public var osVersion: Int
    public var hasCarPlay: Bool
    public var allowsAlwaysLocation: Bool
    public var prefersLocationTrigger: Bool

    public init(
        osVersion: Int, hasCarPlay: Bool,
        allowsAlwaysLocation: Bool = false, prefersLocationTrigger: Bool = false
    ) {
        self.osVersion = osVersion
        self.hasCarPlay = hasCarPlay
        self.allowsAlwaysLocation = allowsAlwaysLocation
        self.prefersLocationTrigger = prefersLocationTrigger
    }
}

public struct TriggerResolution: Sendable {
    public var capability: Capability
    public var disclosures: [String]
    public var rejected: [(id: String, reason: String)]
}

public enum CapabilityResolver {
    /// src/capability-registry/resolver.ts resolveTrigger() ile birebir
    /// aynı mantık: CarPlay -> Bluetooth -> Konum, sırayla elenir.
    public static func resolveTrigger(
        group: String, registry: CapabilityRegistry, device: DeviceContext
    ) -> TriggerResolution? {
        var rejected: [(id: String, reason: String)] = []
        for cap in registry.inGroup(group) {
            if let reason = eligibilityFailure(cap, device: device) {
                rejected.append((cap.id, reason))
                continue
            }
            return TriggerResolution(
                capability: cap,
                disclosures: disclosures(for: cap, device: device),
                rejected: rejected
            )
        }
        return nil
    }

    private static func eligibilityFailure(_ cap: Capability, device: DeviceContext) -> String? {
        if cap.id == "ios.carplay.disconnected" && !device.hasCarPlay {
            return "Cihazda CarPlay yok"
        }
        if cap.permissions.contains("location_always") && !device.allowsAlwaysLocation {
            return "Sürekli konum izni yok"
        }
        if cap.id == "ios.location.leave" && !device.prefersLocationTrigger {
            return "Konum tabanlı alternatif kullanıcı tarafından seçilmedi"
        }
        if !cap.nativeSupport { return "Native destek yok" }
        return nil
    }

    public static func disclosures(for cap: Capability, device: DeviceContext) -> [String] {
        var out = cap.userDisclosures ?? []
        let behavior = CapabilityBehavior.canRunWithoutAsking(cap, osVersion: device.osVersion)
        if behavior == .no {
            out.append(
                "Bu otomasyon her çalıştığında iPhone sana ayrıca onay soracak; bu iOS'un kendi davranışı ve kapatılamıyor."
            )
        }
        if behavior == .unverified {
            out.append(
                "Bu otomasyonun iPhone tarafından ek onay isteyip istemediğini henüz kesin olarak bilmiyoruz."
            )
        }
        if cap.requiresUserSetupStep {
            out.append("Kurulumun son adımını senin onaylaman gerekiyor.")
        }
        return out
    }
}
