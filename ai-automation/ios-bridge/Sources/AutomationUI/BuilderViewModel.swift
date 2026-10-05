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
    /// Phase 5A İş 0 — "Otomasyonlarım" listesinin TEK kaynağı. `machine`
    /// içindeki repository ile AYNI örnek (constructor'dan enjekte
    /// edilir) — ikinci bir kaynak/kopya oluşturulmaz, aksi halde
    /// `installed` kaydı listede görünüp görünmediği testi bir şey
    /// KANITLAMAZ (bkz. docs/phase5a-e2e-validation-plan.md Test 3).
    @Published public private(set) var automations: [Automation] = []
    private let machine: BuilderMachine
    private let registry: CapabilityRegistry
    private let repository: AutomationRepository
    private var cancellable: AnyCancellable?

    public init(machine: BuilderMachine, registry: CapabilityRegistry, repository: AutomationRepository) {
        self.machine = machine
        self.registry = registry
        self.repository = repository
        self.step = machine.step
        self.cancellable = machine.$step.sink { [weak self] newStep in
            self?.step = newStep
        }
    }

    // MARK: - BuilderMachine'e yönlendirme

    public func start(prefillText: String = "") async { await machine.open(prefillText: prefillText) }
    public func close() async { await machine.close() }
    public func updateText(_ text: String) { machine.setText(text) }
    public func submit() async { await machine.submit() }
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
    public func confirmShortcutAdded() { machine.confirmShortcutAdded() }
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
