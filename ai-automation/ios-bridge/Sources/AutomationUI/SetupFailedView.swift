// Phase 5A İş 0 — `.setupFailed`: GERÇEKTEN bilinen bir başarısızlık
// (örn. registry'de şablon yok, Shortcuts açılamadı, kullanıcı
// kuramadığını/bağlayamadığını bildirdi) — "Apple'dan cevap gelmedi"
// gibi belirsiz bir durumla KARIŞTIRILMAZ (bkz. Ports.swift PrepareResult
// yorumu).

import AutomationCore
import SwiftUI

struct SetupFailedView: View {
    @ObservedObject var viewModel: BuilderViewModel
    let draft: DraftAutomationPlan
    let setup: SetupKind
    let reason: String

    var body: some View {
        VStack(spacing: 16) {
            Text("Kurulum tamamlanamadı")
                .font(.headline)
            Text(reason)
                .accessibilityIdentifier("setupFailedReason")

            Button("Tekrar Dene") {
                Task { await viewModel.retrySetup() }
            }
            .accessibilityIdentifier("retrySetupButton")

            Button("Baştan Başla") {
                viewModel.close()
            }
            .accessibilityIdentifier("setupFailedCloseButton")
        }
        .padding()
    }
}
