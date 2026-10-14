// Phase 4D-1 — SwiftUI katmanının BuilderMachine'e bağlandığı tek nokta.
//
// KRİTİK KURAL (bu projenin tamamında tekrarlanan değişmez, şimdi UI
// katmanında da geçerli): capability id'leri ("tesla.sentry_mode.toggle"
// gibi) HİÇBİR View'da doğrudan gösterilmez. Bu dosyadaki
// `triggerSummary`/`actionSummaries`, id'leri registry üzerinden İNSAN
// DİLİNE çevirir — View'lar yalnızca bu çevrilmiş metni görür.

import AutomationCore
import Combine
import Foundation

@MainActor
public final class BuilderViewModel: ObservableObject {
    @Published public private(set) var step: BuilderStep
    @Published public private(set) var plannerFailure: PlannerError?
    @Published public private(set) var persistenceMessage: String?
    @Published public private(set) var storageMessage: String?
    @Published public private(set) var isSubmitting = false
    /// Phase 5A İş 0 — "Otomasyonlarım" listesinin TEK kaynağı. `machine`
    /// içindeki repository ile AYNI örnek (constructor'dan enjekte
    /// edilir) — ikinci bir kaynak/kopya oluşturulmaz, aksi halde
    /// `installed` kaydı listede görünüp görünmediği testi bir şey
    /// KANITLAMAZ (bkz. docs/phase5a-e2e-validation-plan.md Test 3).
    @Published public private(set) var automations: [Automation] = []
    @Published public private(set) var accountState: AccountState = .guest
    @Published public private(set) var accountMessage: String?
    @Published public private(set) var accountBusy = false
    @Published public private(set) var accountCreationPending = false
    @Published public private(set) var selectedAutomation: Automation?
    @Published public private(set) var lifecycleMessage: String?
    @Published public private(set) var activities: [AutomationActivity] = []
    @Published public private(set) var testInProgress = false
    @Published public private(set) var activityMessage: String?
    public let accountLinkAvailable: Bool
    public var notificationStarterAvailable: Bool {
        registry.find("ios.notification.show")?.template != nil
    }
    private let machine: BuilderMachine
    private let registry: CapabilityRegistry
    private let repository: AutomationRepository
    private let accountService: AccountService?
    private let activityStore: AutomationActivityStore?
    private var currentTestRequestID: String?
    private var activityBusy = false
    private var cancellable: AnyCancellable?
    private var plannerFailureCancellable: AnyCancellable?
    private var persistenceCancellable: AnyCancellable?

    public init(machine: BuilderMachine, registry: CapabilityRegistry, repository: AutomationRepository, accountService: AccountService? = nil, accountLinkAvailable: Bool = false, activityStore: AutomationActivityStore? = nil) {
        self.machine = machine
        self.registry = registry
        self.repository = repository
        self.accountService = accountService
        self.activityStore = activityStore
        self.accountLinkAvailable = accountLinkAvailable
        self.step = machine.step
        self.cancellable = machine.$step.sink { [weak self] newStep in
            self?.step = newStep
        }
        self.plannerFailureCancellable = machine.$plannerFailure.sink { [weak self] error in
            self?.plannerFailure = error
        }
        self.persistenceCancellable = machine.$persistenceMessage.sink { [weak self] message in
            self?.persistenceMessage = message
        }
    }

    // MARK: - BuilderMachine'e yönlendirme

    public func start(prefillText: String = "") async { await machine.open(prefillText: prefillText) }
    public func close() async { await machine.close() }
    public func updateText(_ text: String) { machine.setText(text) }
    public func submit() async {
        guard !isSubmitting else { return }
        isSubmitting = true
        defer { isSubmitting = false }
        await machine.submit()
    }
    public func confirmUnderstanding() async { await machine.confirmUnderstanding() }
    public func revise() { machine.revise() }
    /// `.previewConfirm`'den geri dönüş — `revise()`'dan farklı olarak
    /// son cevaplanmış soruya (yoksa `.understanding`'e) döner
    /// (bkz. BuilderMachine.edit()).
    public func edit() { machine.edit() }
    public func answerMissingInfo(_ answer: String) async { await machine.answerMissingInfo(answer) }
    public func skipMissingInfo() async { await machine.skipMissingInfo() }
    public func chooseAlternative(_ capabilityId: String) { machine.chooseAlternative(capabilityId) }

    // MARK: - Kurulum akışı (Phase 5A İş 0 — daha önce ScopeBoundaryView'e düşen durumlar)

    public func createAutomation() async { await machine.create() }
    public func prepareHandoff() async { await machine.prepareHandoff() }
    public func handOffToShortcuts() async { await machine.handOffToShortcuts() }
    public func confirmShortcutAdded() async { await machine.confirmShortcutAdded() }
    public func confirmTriggerLinked() async { await machine.confirmTriggerLinked() }
    public func confirmGuidedSetupDone() async { await machine.confirmGuidedSetupDone() }
    public func reportInstallFailed(reason: String) async { await machine.reportInstallFailed(reason: reason) }
    public func retrySetup() async { await machine.retrySetup() }
    public func showSuccess() { machine.showSuccess() }

    /// `HomeView` her göründüğünde çağrılır — "Otomasyonlarım"'ın
    /// kaynağı gerçekten `repository.list()`'tir, ViewModel'in kendi
    /// belleğinde tuttuğu ayrı bir liste DEĞİL (bkz. Test 3: uygulama
    /// kapat/aç sonrası bu çağrı, dosyadan YENİDEN okur).
    public func refreshAutomations() async {
        automations = await repository.list()
        storageMessage = await repository.storageState() == .ready ? nil
            : "Otomasyon kayıtları okunamıyor. Mevcut veri korunuyor; kurtarma gerekiyor."
    }

    public func showAutomation(_ automation: Automation) {
        selectedAutomation = automation
        lifecycleMessage = nil
        activityMessage = nil
        testInProgress = false
        currentTestRequestID = nil
        Task { await refreshActivities() }
    }

    public func dismissAutomation() {
        selectedAutomation = nil
        lifecycleMessage = nil
        activities = []
        activityMessage = nil
        testInProgress = false
        currentTestRequestID = nil
    }

    public func resumeSelectedAutomation() async {
        guard let selectedAutomation, selectedAutomation.status == .active else { return }
        let id = selectedAutomation.id
        if await machine.resumePending(id) {
            self.selectedAutomation = nil
        }
    }

    public func toggleLocalPause() async {
        guard let selectedAutomation else { return }
        let shouldActivate = selectedAutomation.status == .paused
        guard await repository.setActive(selectedAutomation.id, active: shouldActivate) else {
            lifecycleMessage = "Bu değişiklik kaydedilemedi. Tekrar dene."
            return
        }
        automations = await repository.list()
        self.selectedAutomation = automations.first { $0.id == selectedAutomation.id }
        await appendActivity(.lifecycleChanged, source: .appObserved, for: selectedAutomation)
        lifecycleMessage = nil
    }

    public func deleteSelectedLocalRecord() async {
        guard let selectedAutomation else { return }
        guard await repository.deleteLocalRecord(selectedAutomation.id) else {
            lifecycleMessage = "Kayıt silinemedi. Tekrar dene."
            return
        }
        automations = await repository.list()
        await appendActivity(.lifecycleChanged, source: .appObserved, for: selectedAutomation)
        self.selectedAutomation = nil
        lifecycleMessage = nil
    }

    public func editSelectedAsNewSetup() async {
        guard let selectedAutomation else { return }
        if await machine.openRevision(of: selectedAutomation.id) {
            self.selectedAutomation = nil
            lifecycleMessage = nil
        } else {
            lifecycleMessage = "Bu kayıt yeni kurulum taslağına açılamadı."
        }
    }

    public func beginUserTest() async {
        guard let selectedAutomation, !testInProgress, !activityBusy else { return }
        activityBusy = true
        defer { activityBusy = false }
        let requestID = UUID().uuidString
        guard await appendActivity(.testRequested, source: .appObserved, for: selectedAutomation, eventId: requestID) else {
            activityMessage = "Test isteği kaydedilemedi. Tekrar dene."
            return
        }
        currentTestRequestID = requestID
        testInProgress = true
        activityMessage = nil
    }

    public func cancelUserTest() {
        testInProgress = false
        currentTestRequestID = nil
    }

    public func reportUserTest(worked: Bool) async {
        guard let selectedAutomation, testInProgress, let requestID = currentTestRequestID,
              !activityBusy else { return }
        activityBusy = true
        defer { activityBusy = false }
        let type: ActivityEventType = worked ? .testUserPassed : .testUserFailed
        guard await appendActivity(type, source: .userReported, for: selectedAutomation, eventId: "result-\(requestID)") else {
            activityMessage = "Test bildirimi kaydedilemedi. Tekrar dene."
            return
        }
        testInProgress = false
        currentTestRequestID = nil
        activityMessage = worked
            ? "Kullanıcı testin başarılı olduğunu bildirdi. Uygulama bunu doğrulayamadı."
            : "Kullanıcı testin başarısız olduğunu bildirdi."
    }

    private func refreshActivities() async {
        guard let selectedAutomation, let activityStore else {
            activities = []
            return
        }
        activities = await activityStore.list().filter { $0.revisionId == selectedAutomation.id }
    }

    @discardableResult
    private func appendActivity(
        _ type: ActivityEventType, source: ActivitySource, for automation: Automation,
        eventId: String = UUID().uuidString
    ) async -> Bool {
        guard let activityStore else { return false }
        let event = AutomationActivity(
            eventId: eventId,
            automationId: automation.sourceAutomationId ?? automation.id,
            revisionId: automation.id,
            eventType: type,
            source: source,
            timestamp: Date()
        )
        let saved = await activityStore.append(event)
        if saved { await refreshActivities() }
        return saved
    }

    public func restoreAccount() async {
        guard !accountBusy else { return }
        accountBusy = true
        defer { accountBusy = false }
        accountState = await accountService?.restore() ?? .guest
    }

    public func unlinkAccount() async {
        guard !accountBusy else { return }
        accountBusy = true
        defer { accountBusy = false }
        accountState = await accountService?.unlink() ?? .guest
        if case .guest = accountState {
            accountMessage = nil
        } else {
            accountMessage = "Çıkış doğrulanamadı. Bağlantını kontrol edip tekrar dene."
        }
    }

    public func linkAccount() async {
        guard accountLinkAvailable, let accountService, !accountBusy else { return }
        accountBusy = true
        accountCreationPending = false
        defer { accountBusy = false }
        let result = await accountService.linkWithResult()
        accountState = await accountService.state()
        switch result {
        case .creationRequired: accountCreationPending = true; accountMessage = nil
        case .failedWithMessage(let message): accountMessage = message
        case .linked, .cancelled: accountMessage = nil
        case .failed: accountMessage = "Apple hesabı bağlanamadı. Güvenli bağlantıyı kontrol edip tekrar dene."
        }
    }

    public func cancelAccountCreation() async {
        guard !accountBusy else { return }
        await accountService?.cancelAccountCreation()
        accountCreationPending = false
        accountMessage = nil
    }

    public func confirmAccountCreation() async {
        guard let accountService, accountCreationPending, !accountBusy else { return }
        accountBusy = true
        defer { accountBusy = false }
        accountCreationPending = false
        let result = await accountService.createAccountWithResult()
        accountState = await accountService.state()
        switch result {
        case .linked, .cancelled: accountMessage = nil
        case .creationRequired: accountCreationPending = true
        case .failedWithMessage(let message): accountMessage = message
        case .failed: accountMessage = "İşlem sonucu doğrulanamadı. Lütfen yeniden giriş yap."
        }
    }

    public func deleteAccount() async {
        guard let accountService, !accountBusy else { return }
        accountBusy = true
        defer { accountBusy = false }
        accountCreationPending = false
        let result = await accountService.deleteAccountWithResult()
        accountState = await accountService.state()
        switch result {
        case .deleted(let revocation, let cleared):
            accountMessage = "Sunucudaki hesabın silindi. Bu iPhone'daki otomasyonların ve Kestirmeler'in korundu."
            if revocation == "not_configured" { accountMessage! += " Apple yetkilendirmesini otomatik kaldırma henüz yapılandırılmadı." }
            else if revocation != "succeeded" { accountMessage! += " Apple yetkilendirmesini kaldırma henüz doğrulanmadı." }
            if !cleared { accountMessage! += " Yerel oturum temizliği tamamlanamadı; eski oturum geçerli sayılmıyor." }
        case .cancelled: accountMessage = "Hesap silme iptal edildi."
        case .unknown: accountMessage = "İşlemin tamamlanıp tamamlanmadığı doğrulanamadı. Hesap durumunu yeniden kontrol et."
        case .failed(let message): accountMessage = message
        }
    }

    // MARK: - Semantik → insan dili (capability id ASLA dışarı sızmaz)

    /// "🚗 Arabadan uzaklaşınca" gibi bir tetikleyici özeti. Phase 4E-2:
    /// `cap.description` (mekanizma odaklı, resmi dil) DEĞİL,
    /// `cap.displayDescription` (doğal/günlük dil) kullanılır — bu
    /// dosyadaki İKİ ÇAĞRI, `displayDescription`'ın gerçekten UI'a
    /// ulaştığı TEK yer.
    public func triggerSummary(for draft: DraftAutomationPlan) -> String {
        guard let cap = registry.find(draft.trigger.type) else {
            return "Bir tetikleyici"
        }
        return trimTrailingDot(cap.displayDescription)
    }

    /// "🚨 Tesla Sentry Mode'u aç" gibi eylem özetleri — `ask_confirmation`/
    /// `conditional` sarmalayıcı adımlar hariç, yalnızca gerçek eylemler.
    public func actionSummaries(for draft: DraftAutomationPlan) -> [String] {
        flattenSteps(draft.steps).compactMap { step in
            guard case .action(let type, _) = step else { return nil }
            guard let cap = registry.find(type) else { return nil }
            return trimTrailingDot(cap.displayDescription)
        }
    }

    private func trimTrailingDot(_ s: String) -> String {
        s.hasSuffix(".") ? String(s.dropLast()) : s
    }
}
