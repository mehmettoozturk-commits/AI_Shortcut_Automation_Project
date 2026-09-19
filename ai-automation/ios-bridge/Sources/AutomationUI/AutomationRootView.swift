// Phase 4D-1 — kök View: `BuilderStep`'e göre doğru ekranı seçer.
// Phase 5A İş 0 — `.setup` ve sonrası artık gerçek ekranlara bağlı
// (bkz. SetupView/UserAssistedImportView/WaitingForUserView/
// LinkingTriggerView/InstalledView/SetupFailedView).

import AutomationCore
import SwiftUI

public struct AutomationRootView: View {
    @StateObject private var viewModel: BuilderViewModel

    public init(viewModel: @autoclosure @escaping () -> BuilderViewModel) {
        _viewModel = StateObject(wrappedValue: viewModel())
    }

    public var body: some View {
        content
            .onAppear {
                if case .idle = viewModel.step { viewModel.start() }
            }
            .onChange(of: isIdle) { idle in
                if idle { viewModel.start() }
            }
    }

    /// `BuilderStep` `Equatable` değil (Codable eklemek yeterliydi, bkz.
    /// BuilderStep.swift) — `.onChange` için yalnızca "idle mi değil mi"
    /// karşılaştırılabilir basit bir izdüşüm yeterli.
    private var isIdle: Bool {
        if case .idle = viewModel.step { return true }
        return false
    }

    @ViewBuilder
    private var content: some View {
        switch viewModel.step {
        case .idle, .capturing:
            HomeView(viewModel: viewModel)
        case .understanding(let draft):
            UnderstandingView(viewModel: viewModel, draft: draft)
        case .unsupported(let draft, let message, let alternatives, let manualSteps):
            UnsupportedView(viewModel: viewModel, draft: draft, message: message, alternatives: alternatives, manualSteps: manualSteps)
        case .missingInfo(let draft, let question):
            MissingInfoView(viewModel: viewModel, draft: draft, question: question)
        case .previewConfirm(let draft, let missingPermissions, let disclosures):
            ReadyView(viewModel: viewModel, draft: draft, missingPermissions: missingPermissions, disclosures: disclosures)
        case .setup(let draft, let setup):
            SetupView(viewModel: viewModel, draft: draft, setup: setup)
        case .userAssistedImport(let draft, let setup):
            UserAssistedImportView(viewModel: viewModel, draft: draft, setup: setup)
        case .waitingForUser(let draft, let setup):
            WaitingForUserView(viewModel: viewModel, draft: draft, setup: setup)
        case .linkingTrigger(let draft, let setup, let steps):
            LinkingTriggerView(viewModel: viewModel, draft: draft, setup: setup, steps: steps)
        case .installed(let automation):
            InstalledView(viewModel: viewModel, automation: automation)
        case .success(let automation):
            SuccessView(viewModel: viewModel, automation: automation)
        case .setupFailed(let draft, let setup, let reason):
            SetupFailedView(viewModel: viewModel, draft: draft, setup: setup, reason: reason)
        }
    }
}
