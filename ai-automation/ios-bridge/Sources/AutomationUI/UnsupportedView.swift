// Phase 4D-1 — desteklenmeyen eylem (docs/ux.md §7.3): akış durmaz,
// registry'den türeyen alternatifler gösterilir (hardcode değil).

import AutomationCore
import SwiftUI

struct UnsupportedView: View {
    @ObservedObject var viewModel: BuilderViewModel
    let draft: DraftAutomationPlan
    let message: String
    let alternatives: [UnsupportedAlternative]
    let manualSteps: [String]?

    var body: some View {
        VStack(spacing: 16) {
            Text(message)
                .accessibilityIdentifier("unsupportedMessage")

            if !alternatives.isEmpty {
                Text("Bunun yerine:")
                ForEach(alternatives) { alternative in
                    Button(alternative.description) {
                        viewModel.chooseAlternative(alternative.id)
                    }
                }
            }

            if let manualSteps, !manualSteps.isEmpty {
                VStack(alignment: .leading, spacing: 4) {
                    ForEach(manualSteps, id: \.self) { step in
                        Text("• \(step)")
                    }
                }
            }

            Button("✎ Değiştir") { viewModel.revise() }
                .accessibilityIdentifier("reviseButton")
        }
        .padding()
    }
}
