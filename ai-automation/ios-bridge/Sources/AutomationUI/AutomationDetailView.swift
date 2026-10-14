import AutomationCore
import SwiftUI

/// A local record is not evidence that the corresponding Shortcuts artifact
/// exists or is enabled. Keep those states visibly separate.
struct AutomationDetailView: View {
    @ObservedObject var viewModel: BuilderViewModel
    let automation: Automation
    @State private var confirmLocalDelete = false

    private var draft: DraftAutomationPlan {
        DraftAutomationPlan(name: automation.name, trigger: automation.trigger, steps: automation.workflow)
    }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 18) {
                Button("Geri") { viewModel.dismissAutomation() }
                    .accessibilityIdentifier("detailBackButton")

                Text(automation.name)
                    .font(.title2.bold())
                Text(statusText)
                    .font(.headline)
                    .accessibilityIdentifier("detailStatus")
                Text(localStatusText)
                    .accessibilityIdentifier("detailLocalLifecycle")

                Text("Tetik: \(viewModel.triggerSummary(for: draft))")
                ForEach(viewModel.actionSummaries(for: draft), id: \.self) { action in
                    Text("Eylem: \(action)")
                }

                Text("Bu kayıt uygulamada saklanır. Kestirmeler'deki otomasyonun gerçekten çalıştığını buradan doğrulayamıyoruz.")
                    .foregroundStyle(.secondary)
                if automation.sourceAutomationId != nil {
                    Text("Bu, önceki kayıttan ayrı bir kurulum denemesidir. Önceki Kestirmeler otomasyonu otomatik değiştirilmedi.")
                        .foregroundStyle(.secondary)
                }

                if automation.installStatus == .pendingUser && automation.status == .active {
                    Button("Kuruluma devam et") {
                        Task { await viewModel.resumeSelectedAutomation() }
                    }
                    .accessibilityIdentifier("resumeSetupButton")
                }

                if automation.installStatus == .installed {
                    Button("Yeni kurulum olarak düzenle") {
                        Task { await viewModel.editSelectedAsNewSetup() }
                    }
                    .accessibilityIdentifier("editAsNewSetupButton")
                    Text("Bu işlem eski otomasyonu Kestirmeler'de değiştirmez. Değişiklikleri onaylarsan ayrı bir kurulum kaydı oluşturulur.")
                        .foregroundStyle(.secondary)
                }

                if automation.status == .active || automation.status == .paused {
                    Button(automation.status == .paused ? "Uygulamada yeniden etkinleştir" : "Uygulamada duraklat") {
                        Task { await viewModel.toggleLocalPause() }
                    }
                    .accessibilityIdentifier("toggleLocalPauseButton")
                }

                Text("Bu düğme yalnız uygulamadaki kaydı değiştirir. Kestirmeler'de kurulu otomasyon varsa, onu kapatmak veya silmek için Kestirmeler > Otomasyon bölümünde ayrıca işlem yapmalısın.")
                    .foregroundStyle(.secondary)

                if automation.installStatus == .installed {
                    Button("Test sonucunu bildir") {
                        Task { await viewModel.beginUserTest() }
                    }
                    .accessibilityIdentifier("beginUserTestButton")
                    Text("Kestirmeler'deki otomasyonun çalışmasını uygulama doğrudan doğrulayamıyor. Test sonucunu sen bildirebilirsin.")
                        .foregroundStyle(.secondary)
                }

                if viewModel.testInProgress {
                    Text("Sonucu sen mi gözledin?").font(.headline)
                    Button("Çalıştı") {
                        Task { await viewModel.reportUserTest(worked: true) }
                    }
                    .accessibilityIdentifier("reportTestWorkedButton")
                    Button("Çalışmadı") {
                        Task { await viewModel.reportUserTest(worked: false) }
                    }
                    .accessibilityIdentifier("reportTestFailedButton")
                    Button("Sonuç bildirmeden çık") { viewModel.cancelUserTest() }
                }
                if let message = viewModel.activityMessage {
                    Text(message).foregroundStyle(.secondary)
                }

                Text("Etkinlik geçmişi").font(.headline)
                if viewModel.activities.isEmpty {
                    Text("Bu kayıt için henüz etkinlik yok.").foregroundStyle(.secondary)
                } else {
                    ForEach(viewModel.activities) { event in
                        VStack(alignment: .leading, spacing: 4) {
                            Text(activityTitle(event))
                            Text(event.source == .userReported ? "Kaynak: kullanıcı bildirimi" : "Kaynak: uygulama işlemi")
                                .foregroundStyle(.secondary)
                            Text(event.timestamp.formatted(date: .abbreviated, time: .shortened))
                                .foregroundStyle(.secondary)
                        }
                        .accessibilityElement(children: .combine)
                    }
                }

                Button("Bu kaydı uygulamadan sil", role: .destructive) {
                    confirmLocalDelete = true
                }
                .accessibilityIdentifier("deleteLocalRecordButton")

                if let message = viewModel.lifecycleMessage {
                    Text(message).foregroundStyle(.red)
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding()
        }
        .accessibilityIdentifier("automationDetail")
        .alert("Yalnız uygulama kaydı silinsin mi?", isPresented: $confirmLocalDelete) {
            Button("Vazgeç", role: .cancel) {}
            Button("Kaydı sil", role: .destructive) {
                Task { await viewModel.deleteSelectedLocalRecord() }
            }
        } message: {
            Text("Kestirmeler'deki otomasyon veya kestirme silinmez. Varsa, onu Kestirmeler uygulamasından ayrıca silmelisin. Bekleyen kurulumun devam kaydı kaldırılır; işlem kimliği etkinlik geçmişinde kalabilir.")
        }
    }

    private var statusText: String {
        switch automation.installStatus {
        case .pendingUser: "Kurulum bekliyor"
        case .installed: "Kurulum kullanıcı tarafından bildirildi"
        case .failed: "Kurulum başarısız bildirildi"
        }
    }

    private var localStatusText: String {
        switch automation.status {
        case .active: "Uygulama kaydı etkin"
        case .paused: "Uygulamada duraklatıldı"
        case .draft: "Uygulama taslağı"
        case .archived: "Uygulamada arşivlendi"
        }
    }

    private func activityTitle(_ event: AutomationActivity) -> String {
        switch event.eventType {
        case .automationCreated: "Otomasyon kaydı oluşturuldu"
        case .setupHandoffOpened: "Kestirmeler açıldı"
        case .setupUserConfirmed: "Kurulum kullanıcı tarafından bildirildi"
        case .testRequested: "Test başlatma isteği kaydedildi"
        case .testUserPassed: "Kullanıcı testin başarılı olduğunu bildirdi"
        case .testUserFailed: "Kullanıcı testin başarısız olduğunu bildirdi"
        case .lifecycleChanged: "Uygulama içi durum değiştirildi"
        case .revisionCreated: "Yeni düzenleme sürümü oluşturuldu"
        }
    }
}
