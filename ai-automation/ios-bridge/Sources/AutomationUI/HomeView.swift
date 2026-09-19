// Phase 4D-1 — ilk ekran (docs/ mockup: "Bugün neyi otomatikleştirelim?").
//
// Ses girişi (🎙️) bu fazın kapsamında değil — buton görsel olarak
// duruyor ama devre dışı; kapsam dışı olduğunu açıkça belirtiyoruz,
// sessizce "çalışıyormuş gibi" davranmıyoruz (CLAUDE.md ilkesi).
//
// Phase 5A İş 0 — "Otomasyonlarım" listesi eklendi. Kaynak
// `viewModel.automations` → `AutomationRepository.list()` — bu View
// kendi kopyasını TUTMAZ, her görünüşte `refreshAutomations()` ile
// yeniden okur (bkz. docs/phase5a-e2e-validation-plan.md Test 3:
// uygulama kapat/aç sonrası kalıcılığın GÖRÜNÜR kanıtı budur).

import AutomationCore
import SwiftUI

struct HomeView: View {
    @ObservedObject var viewModel: BuilderViewModel
    @State private var text: String = ""

    private static let chips: [(label: String, hint: String)] = [
        ("🚗 Arabam", "Arabadan inince "),
        ("💬 Mesajlar", "Mesaj gelince "),
        ("🔋 Telefon", "Pil yüzde "),
        ("📍 Konum", "Eve gelince "),
    ]

    var body: some View {
        VStack(spacing: 24) {
            Text("Bugün neyi\notomatikleştirelim?")
                .font(.title)
                .multilineTextAlignment(.center)

            HStack(spacing: 12) {
                TextField("Ne yapmak istediğini yaz…", text: $text, axis: .vertical)
                    .textFieldStyle(.roundedBorder)
                    .accessibilityIdentifier("promptField")
                    .onSubmit(send)

                Image(systemName: "mic.fill")
                    .foregroundStyle(.secondary)
                    .accessibilityIdentifier("micButtonDisabled")
            }

            HStack(spacing: 8) {
                ForEach(Self.chips, id: \.label) { chip in
                    Button(chip.label) { text = chip.hint }
                }
            }

            Button("Gönder", action: send)
                .accessibilityIdentifier("sendButton")
                .disabled(text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)

            if case .capturing(_, _, let notUnderstood) = viewModel.step, notUnderstood {
                Text("Anlayamadım, başka türlü ifade eder misin?")
                    .foregroundStyle(.red)
                    .accessibilityIdentifier("notUnderstoodNote")
            }

            if !viewModel.automations.isEmpty {
                automationsList
            }
        }
        .padding()
        .task { await viewModel.refreshAutomations() }
    }

    private var automationsList: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("Otomasyonlarım")
                .font(.headline)
                .accessibilityIdentifier("automationsListTitle")

            ForEach(viewModel.automations) { automation in
                HStack {
                    Text(automation.name)
                    Spacer()
                    Text(statusLabel(automation.installStatus))
                        .foregroundStyle(.secondary)
                }
                .accessibilityIdentifier("automationRow-\(automation.id)")
            }
        }
    }

    private func statusLabel(_ status: InstallStatus) -> String {
        switch status {
        case .installed: return "Kuruldu"
        case .pendingUser: return "Beklemede"
        case .failed: return "Başarısız"
        }
    }

    private func send() {
        let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return }
        viewModel.updateText(trimmed)
        Task { await viewModel.submit() }
    }
}
