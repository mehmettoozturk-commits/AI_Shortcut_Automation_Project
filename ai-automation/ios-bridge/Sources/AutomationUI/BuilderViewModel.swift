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
    private let machine: BuilderMachine
    private let registry: CapabilityRegistry
    private var cancellable: AnyCancellable?

    public init(machine: BuilderMachine, registry: CapabilityRegistry) {
        self.machine = machine
        self.registry = registry
        self.step = machine.step
        self.cancellable = machine.$step.sink { [weak self] newStep in
            self?.step = newStep
        }
    }

    // MARK: - BuilderMachine'e yönlendirme

    public func start(prefillText: String = "") { machine.open(prefillText: prefillText) }
    public func close() { machine.close() }
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

    // MARK: - Semantik → insan dili (capability id ASLA dışarı sızmaz)

    /// "🚗 Arabadan uzaklaşınca" gibi bir tetikleyici özeti.
    public func triggerSummary(for draft: DraftAutomationPlan) -> String {
        guard let cap = registry.find(draft.trigger.type) else {
            return "Bir tetikleyici"
        }
        return trimTrailingDot(cap.description)
    }

    /// "🚨 Tesla Sentry Mode'u aç" gibi eylem özetleri — `ask_confirmation`/
    /// `conditional` sarmalayıcı adımlar hariç, yalnızca gerçek eylemler.
    public func actionSummaries(for draft: DraftAutomationPlan) -> [String] {
        flattenSteps(draft.steps).compactMap { step in
            guard case .action(let type, _) = step else { return nil }
            guard let cap = registry.find(type) else { return nil }
            return trimTrailingDot(cap.description)
        }
    }

    private func trimTrailingDot(_ s: String) -> String {
        s.hasSuffix(".") ? String(s.dropLast()) : s
    }
}
