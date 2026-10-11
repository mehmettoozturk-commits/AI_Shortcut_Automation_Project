import AutomationCore
import SwiftUI

/// HTTP 422: AI isteği anladı, fakat plan kuruluma geçecek kadar doğrulanmadı.
/// Bu ekranda oluşturma düğmesi yoktur; kullanıcı taslağı kaybetmeden
/// düzeltebilir veya akışı kapatabilir.
struct ValidationBlockedView: View {
    @ObservedObject var viewModel: BuilderViewModel
    let draft: DraftAutomationPlan
    let explanations: [String]

    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            Text("İsteğini anladım, ama henüz kuramıyorum.")
                .font(.headline)
                .accessibilityIdentifier("validationBlockedTitle")

            Text(viewModel.triggerSummary(for: draft))
            ForEach(viewModel.actionSummaries(for: draft), id: \.self) { action in
                Text(action)
            }

            ForEach(explanations, id: \.self) { explanation in
                Text(explanation)
            }

            Button("✎ Değiştir") { viewModel.revise() }
                .accessibilityIdentifier("reviseBlockedPlanButton")

            Button("Kapat") { Task { await viewModel.close() } }
                .accessibilityIdentifier("closeBlockedPlanButton")
        }
        .padding()
    }
}
