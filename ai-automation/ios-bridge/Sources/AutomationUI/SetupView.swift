// Phase 5A İş 0 — `.setup`: kurulum türüne göre ikiye ayrılır.
//
// `guidedManual`: Shortcuts'ta native karşılığı yok, kullanıcı TÜM
// otomasyonu (tetikleyici dahil) registry'den gelen adımlarla elle
// kurar — tek onay yeterli (bkz. BuilderMachine.confirmGuidedSetupDone).
// `userAssistedImport`: önce bir şablon hazırlanmalı (prepareHandoff) —
// registry'de o eylem için henüz `template` yoksa bu adım GERÇEKTEN
// `setupFailed`'a düşer (bkz. TemplateBackedSetupService'in "İÇERİK
// BOŞLUĞU" notu) — bu sahte bir "hazır" göstermez.

import AutomationCore
import SwiftUI

struct SetupView: View {
    @ObservedObject var viewModel: BuilderViewModel
    let draft: DraftAutomationPlan
    let setup: SetupKind

    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            Text("Son adım: kurulum")
                .font(.headline)

            switch setup {
            case .guidedManual(let steps):
                Text("Bunu Kestirmeler'de kendin, şu adımlarla kurmalısın:")
                VStack(alignment: .leading, spacing: 4) {
                    ForEach(steps, id: \.self) { step in
                        Text("• \(step)")
                    }
                }
                Button("Kurdum") {
                    Task { await viewModel.confirmGuidedSetupDone() }
                }
                .accessibilityIdentifier("guidedSetupDoneButton")

            case .userAssistedImport:
                Text("Kestirmeler uygulamasına hazır bir şablon aktaracağız, sonra birkaç adımı sen tamamlayacaksın.")
                Button("Kestirmelere Aktar") {
                    Task { await viewModel.prepareHandoff() }
                }
                .accessibilityIdentifier("prepareHandoffButton")
            }
        }
        .padding()
    }
}
