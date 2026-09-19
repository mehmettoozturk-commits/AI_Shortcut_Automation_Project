// Phase 5A İş 0 — `.userAssistedImport`: şablon hazır, sıra kullanıcıyı
// gerçekten Shortcuts'a aktarmakta (bkz. BuilderMachine.handOffToShortcuts
// — dönüş değeri yalnızca "OS URL'i açabildi mi" sorusuna cevaptır,
// kullanıcının Shortcuts içinde ne yaptığını BİLEMEYİZ).

import AutomationCore
import SwiftUI

struct UserAssistedImportView: View {
    @ObservedObject var viewModel: BuilderViewModel
    let draft: DraftAutomationPlan
    let setup: SetupKind

    var body: some View {
        VStack(spacing: 16) {
            Text("Şablon hazır.")
                .font(.headline)
            Text("Kestirmeler uygulaması açılacak — orada şablonu ekle, sonra buraya dön.")

            Button("Kestirmeler'e Aktar") {
                Task { await viewModel.handOffToShortcuts() }
            }
            .accessibilityIdentifier("handOffButton")
        }
        .padding()
    }
}
