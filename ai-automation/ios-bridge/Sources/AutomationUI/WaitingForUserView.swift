// Phase 5A İş 0 — `.waitingForUser`: kullanıcı Shortcuts'a aktarıldı,
// BURADAN OTOMATİK İLERLEME YOK (bkz. BuilderStep.swift yorumu) —
// uygulama kurulumun gerçekleştiğini bilemez, yalnızca kullanıcının
// kendi beyanına güvenebilir.

import AutomationCore
import SwiftUI

struct WaitingForUserView: View {
    @ObservedObject var viewModel: BuilderViewModel
    let draft: DraftAutomationPlan
    let setup: SetupKind

    var body: some View {
        VStack(spacing: 16) {
            Text("Kestirmeler'de şablonu ekledin mi?")
                .font(.headline)

            Button("Ekledim") {
                viewModel.confirmShortcutAdded()
            }
            .accessibilityIdentifier("confirmShortcutAddedButton")

            Button("Ekleyemedim") {
                Task { await viewModel.reportInstallFailed(reason: "Kestirme Shortcuts'a eklenemedi.") }
            }
            .accessibilityIdentifier("reportShortcutNotAddedButton")
        }
        .padding()
    }
}
