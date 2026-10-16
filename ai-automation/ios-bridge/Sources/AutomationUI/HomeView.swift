// Phase 4D-1 — ilk ekran (docs/ mockup: "Bugün neyi otomatikleştirelim?").
//
// Ses dökümü mevcut yazılı planner akışına girer; otomatik gönderilmez.
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
    @State private var showingDeletionConfirmation = false
    #if os(iOS)
    @StateObject private var voice = VoiceInputController()
    #endif

    private static let chips: [(label: String, hint: String)] = [
        ("🚗 Arabam", "Arabadan inince "),
        ("💬 Mesajlar", "Mesaj gelince "),
        ("🔋 Telefon", "Pil yüzde "),
        ("📍 Konum", "Eve gelince "),
    ]

    var body: some View {
        ScrollView {
        VStack(spacing: 24) {
            HStack {
                Spacer()
                Button("Hesap") { showingAccount = true }
                    .accessibilityIdentifier("accountButton")
            }
            Text("Bugün neyi\notomatikleştirelim?")
                .font(.title)
                .multilineTextAlignment(.center)

            if case .capturing(_, let existingDraft, _) = viewModel.step, existingDraft != nil {
                Text("Yeni kurulum için neyi değiştirmek istediğini yaz. Eski kurulum olduğu gibi kalır.")
                    .foregroundStyle(.secondary)
                    .accessibilityIdentifier("revisionHint")
            }

            HStack(spacing: 12) {
                TextField("Ne yapmak istediğini yaz…", text: $text, axis: .vertical)
                    .textFieldStyle(.roundedBorder)
                    .accessibilityIdentifier("promptField")
                    .onSubmit(send)

                #if os(iOS)
                Button {
                    if voice.isRecording {
                        voice.stop()
                    } else {
                        Task { await voice.start() }
                    }
                } label: {
                    Image(systemName: voice.isRecording ? "stop.circle.fill" : "mic.fill")
                }
                .accessibilityLabel(voice.isRecording ? "Ses kaydını durdur" : "Sesle yaz")
                .accessibilityIdentifier("micButton")
                #else
                Image(systemName: "mic.fill").foregroundStyle(.secondary)
                #endif
            }

            #if os(iOS)
            if voice.isRecording {
                Text("Dinliyorum… Metni kontrol edip Gönder'e bas.")
                    .foregroundStyle(.secondary)
                    .accessibilityIdentifier("voiceListeningStatus")
            }
            if let message = voice.message {
                Text(message).foregroundStyle(.secondary)
                    .accessibilityIdentifier("voiceMessage")
            }
            #endif

            HStack(spacing: 8) {
                ForEach(Self.chips, id: \.label) { chip in
                    Button(chip.label) { text = chip.hint }
                }
            }

            if viewModel.notificationStarterAvailable {
                VStack(alignment: .leading, spacing: 8) {
                    Text("Hazır eylem şablonu").font(.headline)
                    Button("Pil %20 → bildirim") {
                        text = "Pil yüzde 20'ye düşünce bana haber ver"
                    }
                    .accessibilityIdentifier("batteryNotificationTemplateButton")
                    Text("Bildirim kestirmesi için paylaşılmış bir şablon var. Pil tetikleyicisini Kestirmeler'de ayrıca sen bağlayacaksın; bu seçim otomasyon kurmaz.")
                        .foregroundStyle(.secondary)
                }
                .frame(maxWidth: .infinity, alignment: .leading)
            }

            Button("Gönder", action: send)
                .accessibilityIdentifier("sendButton")
                .disabled(viewModel.isSubmitting || text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)

            if viewModel.isSubmitting {
                ProgressView("Plan hazırlanıyor…")
                    .accessibilityIdentifier("planningProgress")
            }

            if case .capturing(_, _, let notUnderstood) = viewModel.step, notUnderstood {
                Text(plannerFailureMessage)
                    .foregroundStyle(.red)
                    .accessibilityIdentifier("notUnderstoodNote")
            }

            if !viewModel.automations.isEmpty {
                automationsList
            }
        }
        .padding()
        }
        .task { await viewModel.refreshAutomations() }
        #if os(iOS)
        .onReceive(voice.$transcript) { transcript in
            if !transcript.isEmpty { text = transcript }
        }
        .onDisappear { voice.stop() }
        #endif
        .sheet(isPresented: $showingAccount) {
            accountSheet
        }
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
                    Button("Hesabımı Sil", role: .destructive) { showingDeletionConfirmation = true }
                        .disabled(viewModel.accountBusy)
                        .accessibilityIdentifier("deleteAccountButton")
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
                if viewModel.accountBusy {
                    ProgressView("Hesap işlemi sürüyor…")
                        .accessibilityIdentifier("accountOperationProgress")
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
            .confirmationDialog("AI Kestirme hesabını silmek üzeresin", isPresented: $showingDeletionConfirmation, titleVisibility: .visible) {
                Button("Hesabımı Sil", role: .destructive) { Task { await viewModel.deleteAccount() } }
                    .accessibilityIdentifier("confirmDeleteAccountButton")
                Button("Vazgeç", role: .cancel) {}
                    .accessibilityIdentifier("cancelDeleteAccountButton")
            } message: {
                Text("Hesabın ve sunucudaki tüm oturumların silinecek. Bu iPhone'daki otomasyonların ve iOS Kestirmeler'deki kestirmelerin silinmeyecek. Devam etmek için Apple hesabınla yeniden doğrulama gerekir.")
            }
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
                Button {
                    viewModel.showAutomation(automation)
                } label: {
                    VStack(alignment: .leading, spacing: 3) {
                        HStack {
                            Text(automation.name)
                            Spacer()
                            Text(statusLabel(automation.installStatus))
                                .foregroundStyle(.secondary)
                        }
                        Text(triggerLabel(for: automation.trigger))
                            .font(.caption)
                            .foregroundStyle(.secondary)
                    }
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

    private func triggerLabel(for trigger: TriggerDTO) -> String {
        return viewModel.triggerSummary(for: DraftAutomationPlan(name: "", trigger: trigger, steps: []))
    }

    private func send() {
        let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return }
        viewModel.updateText(trimmed)
        Task { await viewModel.submit() }
    }

    private var plannerFailureMessage: String {
        switch viewModel.plannerFailure {
        case .invalidRequest:
            return "Plan isteği geçersiz. Lütfen uygulamayı güncelle."
        case .validationFailed:
            return "Bu plan doğrulanamadı. Lütfen isteği gözden geçir."
        case .providerUnavailable:
            return "Planlama servisi şu anda kullanılamıyor. Biraz sonra tekrar dene."
        case .plannerUnreachable:
            return "Plan sunucusuna bağlanılamadı. İnternet bağlantını kontrol edip tekrar dene. Yerel geliştirme sunucusu kullanıyorsan ağ ve sertifika ayarını da kontrol et."
        case .requestTimedOut:
            return "Plan isteği zaman aşımına uğradı. Otomatik tekrar gönderilmedi; yeniden denemek için Gönder'e bas."
        case .serverUnavailable(let status):
            return PlanHTTPStatusMessage.localized(status)
        case nil:
            return "Anlayamadım, başka türlü ifade eder misin?"
        }
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
