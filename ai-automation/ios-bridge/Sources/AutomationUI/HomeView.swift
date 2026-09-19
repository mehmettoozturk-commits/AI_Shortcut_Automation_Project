// Phase 4D-1 — ilk ekran (docs/ mockup: "Bugün neyi otomatikleştirelim?").
//
// Ses girişi (🎙️) bu fazın kapsamında değil — buton görsel olarak
// duruyor ama devre dışı; kapsam dışı olduğunu açıkça belirtiyoruz,
// sessizce "çalışıyormuş gibi" davranmıyoruz (CLAUDE.md ilkesi).

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
        }
        .padding()
    }

    private func send() {
        let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return }
        viewModel.updateText(trimmed)
        Task { await viewModel.submit() }
    }
}
