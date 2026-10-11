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
            Text("Kurulumu tamamladığını bildirdin.")
                .font(.headline)
            Text("Kestirmeler'in gerçekten çalıştığını bu uygulama henüz doğrulayamaz. Tetikleyiciyi güvenli bir şekilde test etmeni öneririz.")
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
            Text("\(automation.name) otomasyonlarında görünüyor; çalıştığı henüz doğrulanmadı.")
                .accessibilityIdentifier("successMessage")

            Button("Bitir") {
                Task { await viewModel.close() }
            }
            .accessibilityIdentifier("successCloseButton")
        }
        .padding()
    }
}
