// Builder Flow tipleri — src/builder/types.ts'in Swift karşılığı.
// docs/ux.md §1.2'deki state machine ve kurulum modeli (docs/capabilities.md
// §1.2 sonrası eklenen user_assisted_import/waiting_for_user/installed
// zinciri) burada birebir tekrarlanır.

import Foundation

public struct MissingInfoField: Sendable, Equatable, Identifiable {
    public var id: String
    public var kind: MissingInfoKind
    public var question: String
    public var options: [String]
    public var optional: Bool

    public init(id: String, kind: MissingInfoKind, question: String, options: [String], optional: Bool = false) {
        self.id = id
        self.kind = kind
        self.question = question
        self.options = options
        self.optional = optional
    }
}

/// docs/ux.md §7.4 öncelik sırası: dizideki case sırası = öncelik.
public enum MissingInfoKind: String, Sendable, CaseIterable {
    case trigger
    case deviceOrPerson = "device_or_person"
    case actionDetail = "action_detail"
    case optionalPreference = "optional_preference"
}

/// AI'nin ürettiği taslak plan — henüz doğrulanmamış, eksik alanlar
/// içerebilir. Doğrulanmış hali AutomationPlanDTO.
public struct DraftAutomationPlan: Sendable, Equatable {
    public var name: String
    public var trigger: TriggerDTO
    public var steps: [WorkflowStepDTO]
    public var missing: [MissingInfoField]
    public var answers: [String: String]

    public init(
        name: String, trigger: TriggerDTO, steps: [WorkflowStepDTO],
        missing: [MissingInfoField] = [], answers: [String: String] = [:]
    ) {
        self.name = name
        self.trigger = trigger
        self.steps = steps
        self.missing = missing
        self.answers = answers
    }
}

public enum SetupKind: Sendable, Equatable {
    case userAssistedImport
    case guidedManual(steps: [String])
}

public struct UnsupportedAlternative: Sendable, Equatable, Identifiable {
    public var id: String
    public var description: String
}

/// Builder Flow state machine — docs/ux.md §1.2 ve kurulum modeli.
/// Kurulum akışı (Phase 3B Test 2 sonrası güncellendi, 2026-09-19):
///   setup -> userAssistedImport -> waitingForUser ("Ekledim")
///          -> linkingTrigger ("Bağladım") -> installed -> success
///   guided_manual akışı ayrıdır: setup -> installed (tek onay, bkz.
///   BuilderMachine.confirmGuidedSetupDone). Her adımdan setupFailed'a
///   düşebilir.
public indirect enum BuilderStep: Sendable {
    case idle
    case capturing(text: String, draft: DraftAutomationPlan?, notUnderstood: Bool)
    case understanding(draft: DraftAutomationPlan)
    /// docs/ux.md §7.3: istenen eylem desteklenmiyor; akış durmaz.
    case unsupported(
        draft: DraftAutomationPlan, message: String,
        alternatives: [UnsupportedAlternative], manualSteps: [String]?
    )
    case missingInfo(draft: DraftAutomationPlan, question: MissingInfoField)
    case previewConfirm(draft: DraftAutomationPlan, missingPermissions: [String], disclosures: [String])
    case setup(draft: DraftAutomationPlan, setup: SetupKind)
    /// Hazır; kullanıcının Kestirmeler'de onaylaması bekleniyor.
    case userAssistedImport(draft: DraftAutomationPlan, setup: SetupKind)
    /// Kullanıcı Kestirmeler'e aktarıldı. BURADAN OTOMATİK İLERLEME YOK
    /// — uygulama kurulumun gerçekleştiğini bilemez.
    case waitingForUser(draft: DraftAutomationPlan, setup: SetupKind)
    /// Kullanıcı "Ekledim" dedi. Phase 3B Test 2 (gerçek cihaz): Personal
    /// Automation tetikleyicisi HENÜZ bağlanmadı — bu programatik değil,
    /// kullanıcı Otomasyon sekmesinde elle bağlamalı. `steps` registry'den
    /// türer (uydurulmaz). BURADAN DA OTOMATİK İLERLEME YOK.
    case linkingTrigger(draft: DraftAutomationPlan, setup: SetupKind, steps: [String])
    case installed(automation: Automation)
    case success(automation: Automation)
    case setupFailed(draft: DraftAutomationPlan, setup: SetupKind, reason: String)
}

extension BuilderStep {
    /// docs/ux.md'deki adım göstergesi (dots) için kaba ilerleme indeksi.
    public var progressIndex: Int {
        switch self {
        case .idle: return -1
        case .capturing: return 0
        case .understanding, .unsupported: return 1
        case .missingInfo: return 2
        case .previewConfirm: return 3
        case .setup, .userAssistedImport, .waitingForUser, .linkingTrigger, .setupFailed, .installed, .success: return 4
        }
    }
}
