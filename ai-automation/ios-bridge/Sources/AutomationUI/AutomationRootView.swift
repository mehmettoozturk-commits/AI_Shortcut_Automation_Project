// Phase 4D-1 — kök View: `BuilderStep`'e göre doğru ekranı seçer.
//
// Kasıtlı olarak DAR kapsam: `.setup` ve sonrası (Shortcuts kurulumu,
// `installed`, `success`) bu fazda BAĞLANMADI — bkz. `ScopeBoundaryView`.

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
        case .setup, .userAssistedImport, .waitingForUser, .linkingTrigger, .installed, .success, .setupFailed:
            ScopeBoundaryView(viewModel: viewModel)
        }
    }
}

/// Phase 4D-1'in bilinçli sınırı: kurulum akışı (Phase 3C'de zaten
/// doğrulandı) bu fazda UI'ya BAĞLANMADI.
struct ScopeBoundaryView: View {
    @ObservedObject var viewModel: BuilderViewModel

    var body: some View {
        VStack(spacing: 16) {
            Text("Kurulum akışı bu sürümde henüz bağlı değil.")
                .accessibilityIdentifier("scopeBoundaryNote")
            Button("Baştan başla") { viewModel.close() }
        }
        .padding()
    }
}
