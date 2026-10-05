// Builder Flow state machine — src/builder/machine.ts'in Swift portu.
//
// TS tarafındaki testlerin karşılığı burada da geçerli olmalı;
// AutomationCoreTests/BuilderMachineTests.swift bu davranışları XCTest
// ile ifade eder (Mac'te swift build/swift test ile doğrulandı, bkz.
// docs/ios-bridge.md §0). Kritik değişmez (Phase 3B Test 2 sonrası
// güncellendi, 2026-09-19):
//
//   `userAssistedImport` akışında installed/success durumlarına
//   yalnızca İKİ GERÇEK kullanıcı doğrulamasıyla girilebilir —
//   confirmShortcutAdded() ("Ekledim") VE confirmTriggerLinked()
//   ("Bağladım"), bu sırayla. Hiçbir ara adım (create/prepareHandoff/
//   handOffToShortcuts) otomasyonu kendiliğinden kaydetmez.
//   `guided_manual` akışında tek onay yeterlidir (confirmGuidedSetupDone).

import Foundation
import Combine

@MainActor
public final class BuilderMachine: ObservableObject {
    @Published public private(set) var step: BuilderStep = .idle

    private let registry: CapabilityRegistry
    private let planner: Planner
    private let permissions: PermissionService
    private let setup: SetupService
    private let shortcutsHandoff: ShortcutsHandoff
    private let repository: AutomationRepository
    private let platform: Platform
    private let device: DeviceContext
    private let now: () -> Date
    private let idGenerator: () -> String

    /// `prepareHandoff()`'ta çözülen, `handOffToShortcuts()`'ta açılacak
    /// URL. `BuilderStep`'in PUBLIC şeklini değiştirmemek için (TS ile
    /// yapısal paralelliği bozmamak — TS'de gerçek bir handoff URL'i
    /// kavramı yok) bilerek private tutuluyor.
    private var pendingHandoff: (url: URL, suggestedName: String)?

    /// Phase 3C-3: `create()`'te bir kez üretilir, akış boyunca AYNI
    /// kayda güncelleme (upsert) yapmak için taşınır — `pendingHandoff`
    /// ile aynı patern, `BuilderStep`'in şeklini bozmamak için private.
    private var currentAutomationId: String?

    public init(
        registry: CapabilityRegistry,
        planner: Planner,
        permissions: PermissionService,
        setup: SetupService,
        shortcutsHandoff: ShortcutsHandoff,
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
        self.shortcutsHandoff = shortcutsHandoff
        self.repository = repository
        self.platform = platform
        self.device = device
        self.now = now
        self.idGenerator = idGenerator
    }

    // MARK: - idle <-> capturing

    public func open(prefillText: String = "") async {
        await planner.resetConversation()
        step = .capturing(text: prefillText, draft: nil, notUnderstood: false)
    }

    /// ✕ — akıştan tamamen çıkış. `create()`'ten beri bir `pendingUser`
    /// kaydı oluştuysa SİLİNMEZ (kullanıcı yarım kalan girişimini
    /// Otomasyonlarım listesinde dürüstçe görebilmeli) — yalnızca akışın
    /// kendi bağlantısı (`currentAutomationId`) sıfırlanır ki bir
    /// sonraki `create()` YENİ bir kayıt üretsin.
    public func close() async {
        currentAutomationId = nil
        pendingHandoff = nil
        await planner.resetConversation()
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
    ///
    /// Phase 3C-3: burada `installStatus: .pendingUser` ile ERKEN bir
    /// kayıt oluşturulur — yarım kalan/başarısız bir girişim de
    /// Otomasyonlarım listesinde dürüstçe görünsün diye (Test 8). Bu
    /// kaydın id'si (`currentAutomationId`) akış boyunca taşınır;
    /// sonraki her geçiş AYNI kaydı GÜNCELLER (upsert).
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
        let setupKind = resolveSetupKind(draft)
        let id = idGenerator()
        currentAutomationId = id
        let pending = buildAutomation(draft, setup: setupKind, installStatus: .pendingUser, id: id)
        await repository.save(pending)
        step = .setup(draft: draft, setup: setupKind)
    }

    /// Phase 3C-3: `.noTemplateAvailable` durumunda kayıt `failed`
    /// OLARAK GÜNCELLENMEZ, `pendingUser` kalır (create()'te zaten öyle
    /// kaydedilmişti) — bu bir veri/içerik eksikliği, kesin bir
    /// başarısızlık değil (bkz. docs/capabilities.md açık iş #7).
    public func prepareHandoff() async {
        guard case .setup(let draft, let setupKind) = step else { return }
        switch await setup.prepare(draft) {
        case .noTemplateAvailable(let reason):
            pendingHandoff = nil
            step = .setupFailed(draft: draft, setup: setupKind, reason: reason)
        case .ready(let url, let suggestedName):
            pendingHandoff = (url, suggestedName)
            step = .userAssistedImport(draft: draft, setup: setupKind)
        }
    }

    /// "Kestirmelere Ekle" — Phase 3C-2: artık GERÇEKTEN bir URL açar
    /// (`shortcutsHandoff.open`). Apple bize sonucu bildirmez (Phase 3B
    /// Test 7) — `open()`'ın dönüşü yalnızca "OS bu URL'i işleyebildi
    /// mi" sorusuna cevaptır. `false` GERÇEKTEN bildiğimiz bir hata
    /// (örn. Shortcuts kurulu değil) olduğu için `setup_failed`
    /// meşrudur; `true` ise kullanıcının ne yaptığını HÂLÂ bilmiyoruz —
    /// bu yüzden BURADAN İTİBAREN DE OTOMATİK İLERLEME YOKTUR,
    /// `waiting_for_user` yine kullanıcıya sormak zorunda.
    public func handOffToShortcuts() async {
        guard case .userAssistedImport(let draft, let setupKind) = step,
              let handoff = pendingHandoff
        else { return }
        let opened = await shortcutsHandoff.open(handoff.url)
        guard opened else {
            // OS'un URL'i açamaması GERÇEKTEN bilinen bir hata (örn.
            // Shortcuts kurulu değil) — kayıt `.failed` olarak güncellenir.
            if let id = currentAutomationId {
                let failed = buildAutomation(draft, setup: setupKind, installStatus: .failed, id: id)
                await repository.save(failed)
            }
            step = .setupFailed(draft: draft, setup: setupKind, reason: "Kestirmeler uygulaması açılamadı.")
            return
        }
        step = .waitingForUser(draft: draft, setup: setupKind)
    }

    /// Kullanıcı "Ekledim" dedi — kestirme Shortcuts kütüphanesinde.
    /// Phase 3B Test 2 (gerçek cihaz): bu, otomasyon tetikleyicisinin
    /// BAĞLANDIĞI anlamına GELMEZ — o programatik değil. Bu yüzden
    /// `installed`'a değil `linkingTrigger`'a geçilir.
    public func confirmShortcutAdded() {
        guard case .waitingForUser(let draft, let setupKind) = step else { return }
        step = .linkingTrigger(draft: draft, setup: setupKind, steps: triggerLinkingSteps(draft))
    }

    /// Kullanıcı "Bağladım" dedi — otomasyon tetikleyicisini Shortcuts'ın
    /// Otomasyon sekmesinde elle bağladığını doğruladı.
    /// `userAssistedImport` akışında `installed`'a girmenin TEK yolu
    /// budur (bkz. `confirmGuidedSetupDone` — guided_manual için ayrı,
    /// tek adımlı yol).
    public func confirmTriggerLinked() async {
        guard case .linkingTrigger(let draft, let setupKind, _) = step else { return }
        let id = currentAutomationId ?? idGenerator()
        let automation = buildAutomation(draft, setup: setupKind, installStatus: .installed, id: id)
        await repository.save(automation)
        step = .installed(automation: automation)
    }

    /// guided_manual akışı: Shortcuts'ta native karşılığı yok, kullanıcı
    /// otomasyonun TAMAMINI (tetikleyici dahil) zaten elle kurdu — ayrı
    /// bir `linkingTrigger` adımına gerek yok, tek onay yeterli.
    public func confirmGuidedSetupDone() async {
        guard case .setup(let draft, let setupKind) = step, isGuidedManual(setupKind) else { return }
        let id = currentAutomationId ?? idGenerator()
        let automation = buildAutomation(draft, setup: setupKind, installStatus: .installed, id: id)
        await repository.save(automation)
        step = .installed(automation: automation)
    }

    /// Kullanıcı kurulamadığını/bağlayamadığını bildirdi (GERÇEKTEN
    /// BİLİNEN bir başarısızlık — "Apple'dan cevap gelmedi" ile
    /// KARIŞTIRILMAMALI). Phase 3C-3: `create()`'teki `pendingUser`
    /// kaydı burada `failed` olarak güncellenir — sahte başarı
    /// üretilmez, ama girişim de sessizce kaybolmaz (Test 8).
    public func reportInstallFailed(reason: String = "Kestirme kurulamadı.") async {
        let draft: DraftAutomationPlan
        let setupKind: SetupKind
        switch step {
        case .waitingForUser(let d, let s), .userAssistedImport(let d, let s):
            draft = d; setupKind = s
        case .linkingTrigger(let d, let s, _):
            draft = d; setupKind = s
        default: return
        }
        if let id = currentAutomationId {
            let failed = buildAutomation(draft, setup: setupKind, installStatus: .failed, id: id)
            await repository.save(failed)
        }
        step = .setupFailed(draft: draft, setup: setupKind, reason: reason)
    }

    /// setup_failed -> tekrar dene (hazırlık aşamasına döner). Kayıt
    /// varsa yeniden denendiği için `pendingUser`'a döner (bir önceki
    /// `failed` durum kalıcı değil, yeniden deneme aktif bir girişimdir).
    public func retrySetup() async {
        guard case .setupFailed(let draft, let setupKind, _) = step else { return }
        if let id = currentAutomationId {
            let pending = buildAutomation(draft, setup: setupKind, installStatus: .pendingUser, id: id)
            await repository.save(pending)
        }
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

    /// Otomasyon tetikleyicisini Shortcuts'ın Otomasyon sekmesinde elle
    /// bağlamak için adımlar. Registry'den (Phase 3B'de gerçek cihazda
    /// kaydedilen akış) türetilir. Doğrulanmış adım yoksa genel/
    /// doğrulanmamış bir patern kullanılır — tek doğrulanmış örnek şu an
    /// `ios.bluetooth.disconnected` (Test 2).
    private func triggerLinkingSteps(_ draft: DraftAutomationPlan) -> [String] {
        registry.find(draft.trigger.type)?.triggerLinkingSteps ?? [
            "Kestirmeler uygulamasını aç, Otomasyon sekmesine geç",
            "Sağ üstten + ile yeni otomasyon oluştur, uygun tetikleyiciyi seç",
            "Eylem olarak az önce eklediğin kestirmeyi seç (yeniden kurmana gerek yok)",
        ]
    }

    /// Phase 3C-3: `id` artık parametre — akış boyunca aynı otomasyon
    /// kaydını GÜNCELLEMEK (upsert) için, her çağrıda yeni bir id
    /// üretilmiyor.
    private func buildAutomation(
        _ draft: DraftAutomationPlan, setup: SetupKind, installStatus: InstallStatus, id: String
    ) -> Automation {
        let timestamp = now()
        return Automation(
            id: id,
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
