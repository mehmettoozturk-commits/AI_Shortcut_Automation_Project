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
#if os(iOS)
import AuthenticationServices
#endif

struct HomeView: View {
    @ObservedObject var viewModel: BuilderViewModel
    @State private var text: String = ""
    @State private var showingAccount = false

    private static let chips: [(label: String, hint: String)] = [
        ("🚗 Arabam", "Arabadan inince "),
        ("💬 Mesajlar", "Mesaj gelince "),
        ("🔋 Telefon", "Pil yüzde "),
        ("📍 Konum", "Eve gelince "),
    ]

    var body: some View {
        VStack(spacing: 24) {
            HStack {
                Spacer()
                Button("Hesap") { showingAccount = true }
                    .accessibilityIdentifier("accountButton")
            }
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
        .sheet(isPresented: $showingAccount) { accountSheet }
    }

    private var accountSheet: some View {
        NavigationStack {
            VStack(alignment: .leading, spacing: 16) {
                switch viewModel.accountState {
                case .guest:
                    if viewModel.accountCreationPending {
                        Text("Yeni Hesap Oluştur").font(.headline)
                        Text("Bu Apple hesabıyla ilişkili bir AI Kestirme hesabı bulunamadı. Devam etmek için yeni bir hesap oluşturabilirsin.")
                        Button("Yeni Hesap Oluştur") { Task { await viewModel.confirmAccountCreation() } }
                            .disabled(viewModel.accountBusy)
                            .accessibilityIdentifier("confirmAccountCreation")
                        Button("Vazgeç") { Task { await viewModel.cancelAccountCreation() } }
                            .disabled(viewModel.accountBusy)
                            .accessibilityIdentifier("cancelAccountCreation")
                    } else {
                    Text("Hesapsız kullanıyorsun")
                        .font(.headline)
                    Text(viewModel.accountLinkAvailable
                         ? "Otomasyonların bu iPhone'da kalır. İstersen Apple hesabını bağlayabilirsin."
                         : "Otomasyonların bu iPhone'da kalır. Apple ile hesap bağlama için güvenli sunucu bağlantısı henüz ayarlanmadı.")
                    #if os(iOS)
                    if viewModel.accountLinkAvailable {
                        AppleAccountButton {
                            Task { await viewModel.linkAccount() }
                        }
                        .frame(height: 50)
                        .disabled(viewModel.accountBusy)
                        .accessibilityIdentifier("appleSignInButton")
                    }
                    #endif
                    }
                case .linked:
                    Text("Apple hesabı bağlı")
                        .font(.headline)
                    Text("Bu bağlantı otomasyonlarını buluta taşımaz.")
                    Button("Hesap bağlantısını kaldır") {
                        Task { await viewModel.unlinkAccount() }
                    }
                case .expired:
                    Text("Hesap bağlantısı doğrulanamadı")
                        .font(.headline)
                    Text("Otomasyonların bu iPhone'da kalır ve hesapsız kullanmaya devam edebilirsin.")
                    Button("Hesap bağlantısını kaldır") {
                        Task { await viewModel.unlinkAccount() }
                    }
                case .validationUnavailable:
                    Text("Hesap şu an doğrulanamıyor")
                        .font(.headline)
                    Text("Bağlantın veya sunucu geçici olarak kullanılamıyor. Otomasyonların bu iPhone'da kalır; hesabın kapatılmış sayılmaz.")
                    Button("Yeniden dene") { Task { await viewModel.restoreAccount() } }
                case .migrationRequired:
                    Text("Apple hesabı aktarım gerektiriyor")
                        .font(.headline)
                    Text("Bu hesap geçişini henüz desteklemiyoruz. Otomasyonların bu iPhone'da kalır.")
                }
                if let message = viewModel.accountMessage {
                    Text(message)
                        .foregroundStyle(.red)
                        .accessibilityIdentifier("accountMessage")
                }
                Spacer()
            }
            .padding()
            .navigationTitle("Hesap")
            .toolbar {
                ToolbarItem(placement: .confirmationAction) {
                    Button("Bitti") { showingAccount = false }
                }
            }
        }
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
        case .installed: return "Kurulum bildirildi"
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

#if os(iOS)
private struct AppleAccountButton: UIViewRepresentable {
    let action: () -> Void

    func makeUIView(context: Context) -> ASAuthorizationAppleIDButton {
        let button = ASAuthorizationAppleIDButton(type: .signIn, style: .black)
        button.addTarget(context.coordinator, action: #selector(Coordinator.tap), for: .touchUpInside)
        return button
    }

    func updateUIView(_ uiView: ASAuthorizationAppleIDButton, context: Context) {
        context.coordinator.action = action
    }

    func makeCoordinator() -> Coordinator { Coordinator(action: action) }

    final class Coordinator: NSObject {
        var action: () -> Void
        init(action: @escaping () -> Void) { self.action = action }
        @objc func tap() { action() }
    }
}
#endif
