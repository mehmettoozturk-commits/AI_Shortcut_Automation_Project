// Builder Flow state machine — src/builder/machine.ts'in Swift portu.
//
// TS tarafındaki 101 testin karşılığı burada da geçerli olmalı;
// AutomationCoreTests/BuilderMachineTests.swift bu davranışları
// XCTest ile ifade eder (Xcode'da ÇALIŞTIRILMADI, bkz. Package.swift
// üst notu). Kritik değişmez aynen korunmuştur:
//
//   installed/success durumlarına yalnızca GERÇEK kullanıcı
//   doğrulamasıyla (confirmInstalledByUser) girilebilir; hiçbir ara
//   adım (create/prepareHandoff/handOffToShortcuts) otomasyonu
//   kendiliğinden kaydetmez.

import Foundation
import Combine

@MainActor
public final class BuilderMachine: ObservableObject {
    @Published public private(set) var step: BuilderStep = .idle

    private let registry: CapabilityRegistry
    private let planner: Planner
    private let permissions: PermissionService
    private let setup: SetupService
    private let repository: AutomationRepository
    private let platform: Platform
    private let device: DeviceContext
    private let now: () -> Date
    private let idGenerator: () -> String

    public init(
        registry: CapabilityRegistry,
        planner: Planner,
        permissions: PermissionService,
        setup: SetupService,
        repository: AutomationRepository,
        platform: Platform = .ios,
        device: DeviceContext,
        now: @escaping () -> Date = Date.init,
        idGenerator: @escaping () -> String = { "auto-" + UUID().uuidString.prefix(8) }
    ) {
        self.registry = registry
        self.planner = planner
        self.permissions = permissions
        self.setup = setup
        self.repository = repository
        self.platform = platform
        self.device = device
        self.now = now
        self.idGenerator = idGenerator
    }

    // MARK: - idle <-> capturing

    public func open(prefillText: String = "") {
        step = .capturing(text: prefillText, draft: nil, notUnderstood: false)
    }

    /// ✕ — akıştan tamamen çıkış, hiçbir şey kaydedilmez.
    public func close() {
        step = .idle
    }

    public func setText(_ text: String) {
        guard case .capturing(_, let draft, _) = step else { return }
        step = .capturing(text: text, draft: draft, notUnderstood: false)
    }

    // MARK: - capturing -> understanding | unsupported

    public func submit() async {
        guard case .capturing(let text, let existingDraft, _) = step,
              !text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
        else { return }

        let result = await planner.plan(text: text, existingDraft: existingDraft)

        guard case .plan(let draft) = result else {
            step = .capturing(text: text, draft: existingDraft, notUnderstood: true)
            return
        }

        if findUnknownCapability(draft) != nil {
            step = .unsupported(
                draft: draft, message: "Bunu şu anda otomatik olarak yapamıyorum.",
                alternatives: [], manualSteps: nil
            )
            return
        }

        if let unavailable = findUnavailableCapability(draft) {
            step = .unsupported(
                draft: draft,
                message: "Bunu doğrudan otomatik olarak kuramıyorum: \(trimTrailingDot(unavailable.description)) iPhone Shortcuts entegrasyonunda bulunmuyor.",
                alternatives: alternatives(for: unavailable),
                manualSteps: unavailable.fallbackSteps
            )
            return
        }

        step = .understanding(draft: draft)
    }

    /// ✎ Değiştir — taslak korunarak capturing'e döner (§7.1).
    public func revise() {
        let draft: DraftAutomationPlan?
        switch step {
        case .understanding(let d): draft = d
        case .unsupported(let d, _, _, _): draft = d
        default: return
        }
        step = .capturing(text: "", draft: draft, notUnderstood: false)
    }

    // MARK: - understanding -> missing_info | preview

    public func confirmUnderstanding() async {
        guard case .understanding(let draft) = step else { return }
        await advance(after: draft)
    }

    public func answerMissingInfo(_ answer: String) async {
        guard case .missingInfo(let draft, let question) = step else { return }
        var updated = draft
        updated.answers[question.id] = answer
        if question.kind == .deviceOrPerson {
            updated.trigger.device = answer
        }
        await advance(after: updated)
    }

    /// "Şimdilik geç" — yalnızca opsiyonel sorularda (§7.4).
    public func skipMissingInfo() async {
        guard case .missingInfo(let draft, let question) = step, question.optional else { return }
        var updated = draft
        updated.answers[question.id] = ""
        await advance(after: updated)
    }

    private func advance(after draft: DraftAutomationPlan) async {
        if let question = Self.nextMissingInfoQuestion(draft) {
            step = .missingInfo(draft: draft, question: question)
            return
        }
        let missingPermissions = await computeMissingPermissions(draft)
        step = .previewConfirm(draft: draft, missingPermissions: missingPermissions, disclosures: disclosures(for: draft))
    }

    /// docs/ux.md §7.4 öncelik sırası: tetikleyici -> cihaz/kişi ->
    /// eylem detayı -> opsiyonel; her seferinde tek soru.
    static func nextMissingInfoQuestion(_ draft: DraftAutomationPlan) -> MissingInfoField? {
        let unanswered = draft.missing.filter { draft.answers[$0.id] == nil }
        let ordered = unanswered.sorted { a, b in
            let pa = MissingInfoKind.allCases.firstIndex(of: a.kind) ?? 99
            let pb = MissingInfoKind.allCases.firstIndex(of: b.kind) ?? 99
            return pa < pb
        }
        return ordered.first
    }

    // MARK: - preview -> setup

    /// Düzenle — son eksik bilgi sorusuna, yoksa understanding'e döner.
    public func edit() {
        guard case .previewConfirm(let draft, _, _) = step else { return }
        let answered = draft.missing.filter { draft.answers[$0.id] != nil }
        if let last = answered.last {
            var reopened = draft
            reopened.answers.removeValue(forKey: last.id)
            step = .missingInfo(draft: reopened, question: last)
            return
        }
        step = .understanding(draft: draft)
    }

    /// "Otomasyonu Oluştur" — docs/ux.md §2: bu tıklama, DSL'deki
    /// ask_confirmation adımının ve Safety Validator'ın aradığı
    /// kullanıcı onayının gerçek dünya karşılığıdır. Kurulum YAPMAZ;
    /// yalnızca kurulum paketini hazırlar.
    public func create() async {
        guard case .previewConfirm(let draft, let missingPermissions, _) = step else { return }
        for permission in missingPermissions {
            let granted = await permissions.request(permission)
            if !granted {
                let stillMissing = await computeMissingPermissions(draft)
                step = .previewConfirm(draft: draft, missingPermissions: stillMissing, disclosures: disclosures(for: draft))
                return
            }
        }
        step = .setup(draft: draft, setup: resolveSetupKind(draft))
    }

    public func prepareHandoff() async {
        guard case .setup(let draft, let setupKind) = step else { return }
        let prepared = await setup.prepare(draft)
        guard prepared else {
            step = .setupFailed(draft: draft, setup: setupKind, reason: "Kurulum paketi hazırlanamadı.")
            return
        }
        step = .userAssistedImport(draft: draft, setup: setupKind)
    }

    /// "Kestirmelere Ekle" — kullanıcı Apple'ın kendi ekranına
    /// aktarılır. BURADAN İTİBAREN OTOMATİK İLERLEME YOKTUR.
    public func handOffToShortcuts() {
        guard case .userAssistedImport(let draft, let setupKind) = step else { return }
        step = .waitingForUser(draft: draft, setup: setupKind)
    }

    /// Kullanıcı "kuruldu" dedi. `installed`'a girmenin TEK yolu budur.
    public func confirmInstalledByUser() async {
        let draft: DraftAutomationPlan
        let setupKind: SetupKind
        switch step {
        case .waitingForUser(let d, let s): draft = d; setupKind = s
        case .setup(let d, let s) where isGuidedManual(s): draft = d; setupKind = s
        default: return
        }
        let automation = buildAutomation(draft, setup: setupKind, installStatus: .installed)
        await repository.save(automation)
        step = .installed(automation: automation)
    }

    public func reportInstallFailed(reason: String = "Kestirme kurulamadı.") {
        switch step {
        case .waitingForUser(let d, let s), .userAssistedImport(let d, let s):
            step = .setupFailed(draft: d, setup: s, reason: reason)
        default: break
        }
    }

    public func retrySetup() {
        guard case .setupFailed(let draft, let setupKind, _) = step else { return }
        step = .setup(draft: draft, setup: setupKind)
    }

    public func showSuccess() {
        guard case .installed(let automation) = step else { return }
        step = .success(automation: automation)
    }

    /// Desteklenmeyen eylem yerine önerilen alternatifi seçer; plan
    /// revize edilir, understanding'e döner (§7.3).
    public func chooseAlternative(_ capabilityId: String) {
        guard case .unsupported(let draft, _, _, _) = step,
              let cap = registry.find(capabilityId), cap.availableInShortcuts == .yes
        else { return }
        let updated = replaceActions(draft, with: capabilityId)
        step = .understanding(draft: updated)
    }

    // MARK: - helpers

    private func isGuidedManual(_ s: SetupKind) -> Bool {
        if case .guidedManual = s { return true }
        return false
    }

    private func actionCapabilityIds(_ draft: DraftAutomationPlan) -> [String] {
        flattenSteps(draft.steps).compactMap { step in
            switch step {
            case .askConfirmation, .conditional: return nil
            case .action(let type, _): return type
            }
        }
    }

    private func findUnknownCapability(_ draft: DraftAutomationPlan) -> String? {
        if registry.find(draft.trigger.type) == nil { return draft.trigger.type }
        for id in actionCapabilityIds(draft) where registry.find(id) == nil { return id }
        return nil
    }

    private func findUnavailableCapability(_ draft: DraftAutomationPlan) -> Capability? {
        actionCapabilityIds(draft)
            .compactMap { registry.find($0) }
            .first { $0.availableInShortcuts != .yes }
    }

    private func alternatives(for unavailable: Capability) -> [UnsupportedAlternative] {
        registry.supportedAlternatives(for: unavailable.id)
            .map { UnsupportedAlternative(id: $0.id, description: $0.description) }
    }

    private func replaceActions(_ draft: DraftAutomationPlan, with capabilityId: String) -> DraftAutomationPlan {
        func swap(_ steps: [WorkflowStepDTO]) -> [WorkflowStepDTO] {
            steps.map { step in
                switch step {
                case .askConfirmation: return step
                case .conditional(let cond, let then, let elseSteps):
                    return .conditional(condition: cond, then: swap(then), else: swap(elseSteps))
                case .action: return .action(type: capabilityId, params: nil)
                }
            }
        }
        var updated = draft
        updated.steps = swap(draft.steps)
        if let cap = registry.find(capabilityId) {
            updated.name = trimTrailingDot(cap.description)
        }
        return updated
    }

    private func requiredPermissions(_ draft: DraftAutomationPlan) -> [String] {
        var perms = Set<String>()
        for id in [draft.trigger.type] + actionCapabilityIds(draft) {
            if let cap = registry.find(id) { perms.formUnion(cap.permissions) }
        }
        return Array(perms)
    }

    private func computeMissingPermissions(_ draft: DraftAutomationPlan) async -> [String] {
        let granted = Set(await permissions.grantedPermissions())
        return requiredPermissions(draft).filter { !granted.contains($0) }
    }

    private func disclosures(for draft: DraftAutomationPlan) -> [String] {
        var out: [String] = []
        if let cap = registry.find(draft.trigger.type) {
            out += CapabilityResolver.disclosures(for: cap, device: device)
        }
        // docs/capabilities.md §1.2: programatik kurulum doğrulanmadı.
        out.append("iPhone güvenlik nedeniyle son kurulumu senin onaylamanı istiyor.")
        // Sırayı koruyarak tekilleştir (NSOrderedSet yerine elle, daha
        // az riskli bir yol).
        var seen = Set<String>()
        return out.filter { seen.insert($0).inserted }
    }

    /// Kurulum yöntemi YALNIZCA registry'den okunur. "automatic" asla
    /// üretilmez (CapabilityRegistry zaten böyle bir satırı reddeder).
    private func resolveSetupKind(_ draft: DraftAutomationPlan) -> SetupKind {
        for id in actionCapabilityIds(draft) {
            if let cap = registry.find(id), cap.installMethod == .guidedManual {
                return .guidedManual(steps: cap.fallbackSteps ?? [cap.fallbackMethod ?? ""])
            }
        }
        return .userAssistedImport
    }

    private func buildAutomation(_ draft: DraftAutomationPlan, setup: SetupKind, installStatus: InstallStatus) -> Automation {
        let timestamp = now()
        return Automation(
            id: idGenerator(),
            userId: "local",
            name: draft.name,
            platform: platform,
            status: .active,
            trigger: draft.trigger,
            workflow: draft.steps,
            version: 1,
            createdAt: timestamp,
            updatedAt: timestamp,
            requiresGuidedSetup: isGuidedManual(setup),
            installStatus: installStatus
        )
    }
}

private func trimTrailingDot(_ s: String) -> String {
    s.hasSuffix(".") ? String(s.dropLast()) : s
}
