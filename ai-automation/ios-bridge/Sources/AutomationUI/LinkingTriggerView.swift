// Phase 5A İş 0 — `.linkingTrigger`: kestirme eklendi ama tetikleyici
// HENÜZ bağlanmadı — bu programatik değil, kullanıcı Kestirmeler'in
// Otomasyon sekmesinde elle bağlamalı (Phase 3B Test 2, gerçek cihaz).
// `steps` registry'den gelir, burada UYDURULMAZ.

import AutomationCore
import SwiftUI

struct LinkingTriggerView: View {
    @ObservedObject var viewModel: BuilderViewModel
    let draft: DraftAutomationPlan
    let setup: SetupKind
    let steps: [String]

    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            Text("Son bir adım kaldı: tetikleyiciyi bağla")
                .font(.headline)

            VStack(alignment: .leading, spacing: 4) {
                ForEach(steps, id: \.self) { step in
                    Text("• \(step)")
                }
            }
            .accessibilityIdentifier("triggerLinkingSteps")

            Button("Bağladım") {
                Task { await viewModel.confirmTriggerLinked() }
            }
            .accessibilityIdentifier("confirmTriggerLinkedButton")

            Button("Bağlayamadım") {
                Task { await viewModel.reportInstallFailed(reason: "Tetikleyici bağlanamadı.") }
            }
            .accessibilityIdentifier("reportTriggerNotLinkedButton")
        }
        .padding()
    }
}
