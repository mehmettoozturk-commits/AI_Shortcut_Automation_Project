// Port'lar (protocol'ler) — src/builder/ports.ts'in Swift karşılığı.
//
// UI mimarisi değişmeden gerçek NLU/native entegrasyonlar mock'ların
// yerine geçebilsin diye protocol olarak tanımlandı. Phase 3B'de
// `SetupService`'in gerçek implementasyonu Shortcuts handoff'unu
// yapacak (bkz. Platform/ShortcutsHandoff.swift).

import Foundation

public enum PlannerResult: Sendable {
    case plan(DraftAutomationPlan)
    /// docs/ux.md §7.2 — AI hiçbir niyet çıkaramadı
    case notUnderstood
}

public protocol Planner: Sendable {
    /// - Parameter existingDraft: Revizyon durumunda korunan mevcut
    ///   taslak (§7.1). Verilmişse planner planı SIFIRDAN üretmek
    ///   yerine revize etmelidir.
    func plan(text: String, existingDraft: DraftAutomationPlan?) async -> PlannerResult
}

public protocol PermissionService: Sendable {
    func grantedPermissions() async -> [String]
    /// İhtiyaç anında izin ister (docs/ux.md §3.5 / MASTER_SPEC §20)
    func request(_ permission: String) async -> Bool
}

/// Kurulum paketini HAZIRLAR; kurmaz. Gerçek kurulum kullanıcı
/// onayı gerektirir (bkz. BuilderMachine.handOffToShortcuts).
public protocol SetupService: Sendable {
    func prepare(_ plan: DraftAutomationPlan) async -> Bool
}

public protocol AutomationRepository: Sendable {
    func list() async -> [Automation]
    func save(_ automation: Automation) async
    func setActive(_ id: String, active: Bool) async
}
