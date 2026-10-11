// İzin abstraction'ı — yalnızca BU uygulamanın doğrudan kullandığı
// OS API'leri için Capability.runtimePermissions alanına karşılık gelir.
// Shortcuts/Tesla setupRequirements bununla doğrulanamaz.
//
// İleride app'in kendisi bu framework'leri kullanırsa:
//   - "bluetooth"        -> CoreBluetooth CBCentralManager.authorization
//   - "notifications"    -> UNUserNotificationCenter
//   - "location_always"  -> CoreLocation CLLocationManager (Always yetkisi)
//   - "tesla_account"    -> Tesla OAuth durumu (üçüncü taraf, Apple API'si değil)
// Bu dosya yalnızca protokolü tanımlar; framework'lere karşı DERLENMEDİ.

import Foundation

public enum PermissionState: String, Sendable {
    case notDetermined = "not_determined"
    case granted
    case denied
    /// Kullanıcı ayarlardan manuel açmalı (ör. konum "Always").
    case requiresSettings = "requires_settings"
}

public protocol SystemPermissionAdapter: Sendable {
    /// Capability.runtimePermissions'daki app-owned OS izin kimliği.
    func currentState(_ permission: String) async -> PermissionState
    /// OS'un kendi izin dialogunu tetikler. `tesla_account` gibi
    /// üçüncü taraf izinler için bu OAuth akışını başlatmak anlamına
    /// gelebilir; implementasyon türe göre değişir.
    func requestSystemPermission(_ permission: String) async -> PermissionState
}

/// Production fail-closed service while the app itself declares no runtime
/// OS permissions. Shortcuts/Tesla setup requirements are handled separately
/// by the guided import flow; any future app-owned permission added without
/// a native adapter remains denied rather than silently auto-granted.
public actor NoAppRuntimePermissionService: PermissionService {
    public init() {}

    public func grantedPermissions() async -> [String] { [] }

    public func request(_ permission: String) async -> Bool { false }
}

/// MOCK — gerçek OS izin dialogunu açmaz.
public actor MockSystemPermissionAdapter: SystemPermissionAdapter {
    private var states: [String: PermissionState]

    public init(initial: [String: PermissionState] = [:]) {
        self.states = initial
    }

    public func currentState(_ permission: String) async -> PermissionState {
        states[permission] ?? .notDetermined
    }

    public func requestSystemPermission(_ permission: String) async -> PermissionState {
        let granted: PermissionState = .granted
        states[permission] = granted
        return granted
    }
}

/// `Ports.swift`'teki `PermissionService`'i `SystemPermissionAdapter`
/// üzerine kurar — BuilderMachine'in bildiği tek arayüz PermissionService
/// olarak kalır, gerçek OS entegrasyonu bu köprünün arkasında saklanır.
public actor SystemBackedPermissionService: PermissionService {
    private let adapter: SystemPermissionAdapter
    private let allPermissions: [String]

    public init(adapter: SystemPermissionAdapter, allPermissions: [String]) {
        self.adapter = adapter
        self.allPermissions = allPermissions
    }

    public func grantedPermissions() async -> [String] {
        var out: [String] = []
        for p in allPermissions where await adapter.currentState(p) == .granted {
            out.append(p)
        }
        return out
    }

    public func request(_ permission: String) async -> Bool {
        await adapter.requestSystemPermission(permission) == .granted
    }
}
