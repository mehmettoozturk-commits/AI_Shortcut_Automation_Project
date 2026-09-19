// Phase 5A İş 0 — `.installed` ve `.success`. İkisi ayrı ekran: birinden
// diğerine geçiş BuilderMachine'de otomatik değil (showSuccess() ayrı,
// açık bir çağrı) — akışın hiçbir adımı kendiliğinden ilerlemiyor
// prensibiyle tutarlı.

import AutomationCore
import SwiftUI

struct InstalledView: View {
    @ObservedObject var viewModel: BuilderViewModel
    let automation: Automation

    var body: some View {
        VStack(spacing: 16) {
            Text("🎉 Kuruldu!")
                .font(.headline)
            Text(automation.name)
                .accessibilityIdentifier("installedAutomationName")

            Button("Tamam") {
                viewModel.showSuccess()
            }
            .accessibilityIdentifier("installedDoneButton")
        }
        .padding()
    }
}

struct SuccessView: View {
    @ObservedObject var viewModel: BuilderViewModel
    let automation: Automation

    var body: some View {
        VStack(spacing: 16) {
            Text("\(automation.name) artık otomasyonlarında.")
                .accessibilityIdentifier("successMessage")

            Button("Bitir") {
                viewModel.close()
            }
            .accessibilityIdentifier("successCloseButton")
        }
        .padding()
    }
}
