// Phase 4D-1 — "Seni şöyle anladım" ekranı.
//
// ⚠️ Bu ekran capability id GÖSTERMEZ — yalnızca
// `BuilderViewModel.triggerSummary`/`actionSummaries`'in ürettiği,
// registry'den türetilmiş insan dilini gösterir. Bu, kaynak taramasıyla
// kilitli (bkz. AutomationUITests / UITest'te "capability id ekranda
// görünmüyor" kontrolü).

import AutomationCore
import SwiftUI

struct UnderstandingView: View {
    @ObservedObject var viewModel: BuilderViewModel
    let draft: DraftAutomationPlan

    var body: some View {
        VStack(spacing: 20) {
            Text("Seni şöyle anladım:")
                .font(.headline)

            VStack(spacing: 8) {
                Text(viewModel.triggerSummary(for: draft))
                    .font(.title3)
                    .accessibilityIdentifier("triggerSummary")

                Image(systemName: "arrow.down")
                    .foregroundStyle(.secondary)

                ForEach(viewModel.actionSummaries(for: draft), id: \.self) { summary in
                    Text(summary)
                        .font(.title3)
                        .accessibilityIdentifier("actionSummary")
                }
            }
            .padding()

            HStack(spacing: 16) {
                Button("✓ Doğru") {
                    Task { await viewModel.confirmUnderstanding() }
                }
                .accessibilityIdentifier("confirmButton")

                Button("✎ Değiştir") {
                    viewModel.revise()
                }
                .accessibilityIdentifier("reviseButton")
            }
        }
        .padding()
    }
}
