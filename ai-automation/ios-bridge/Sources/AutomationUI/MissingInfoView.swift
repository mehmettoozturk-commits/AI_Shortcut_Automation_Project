// Phase 4D-1 — eksik bilgi sorusu (docs/ux.md §7.4: her seferinde TEK soru).

import AutomationCore
import SwiftUI

struct MissingInfoView: View {
    @ObservedObject var viewModel: BuilderViewModel
    let draft: DraftAutomationPlan
    let question: MissingInfoField
    @State private var freeText: String = ""

    var body: some View {
        VStack(spacing: 16) {
            Text(question.question)
                .font(.headline)
                .accessibilityIdentifier("missingInfoQuestion")

            if question.options.isEmpty {
                TextField("Cevabın", text: $freeText)
                    .textFieldStyle(.roundedBorder)
                    .accessibilityIdentifier("missingInfoFreeText")
                Button("Gönder") {
                    Task { await viewModel.answerMissingInfo(freeText) }
                }
                .accessibilityIdentifier("missingInfoFreeTextSubmit")
            } else {
                ForEach(question.options, id: \.self) { option in
                    Button(option) {
                        Task { await viewModel.answerMissingInfo(option) }
                    }
                }
            }

            if question.optional {
                Button("Şimdilik geç") {
                    Task { await viewModel.skipMissingInfo() }
                }
                .accessibilityIdentifier("missingInfoSkip")
            }
        }
        .padding()
    }
}
