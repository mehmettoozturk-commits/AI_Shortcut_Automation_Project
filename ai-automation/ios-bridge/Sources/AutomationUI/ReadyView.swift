// Phase 4D-1 — `.previewConfirm`: son önizleme. Kasıtlı olarak
// `create()`/kurulum akışına BAĞLANMADI (bkz. AutomationRootView'ın
// yorumu) — bu ekran yalnızca "otomasyon hazır, eksik izin şu" bilgisini
// gösterir.

import AutomationCore
import SwiftUI

struct ReadyView: View {
    @ObservedObject var viewModel: BuilderViewModel
    let draft: DraftAutomationPlan
    let missingPermissions: [String]
    let disclosures: [String]

    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            Text("Otomasyon hazır.")
                .font(.headline)

            if !missingPermissions.isEmpty {
                Text("Gereken izinler: \(missingPermissions.joined(separator: ", "))")
                    .accessibilityIdentifier("missingPermissionsNote")
            }

            ForEach(disclosures, id: \.self) { disclosure in
                Text("• \(disclosure)")
            }

            Text("Bu otomasyonu hazırlamak için Kestirmeler'de küçük bir adım gerekiyor — bu adım bu sürümde henüz bağlı değil.")
                .foregroundStyle(.secondary)
                .accessibilityIdentifier("setupNotConnectedNote")

            Button("✎ Değiştir") { viewModel.edit() }
                .accessibilityIdentifier("reviseButton")
        }
        .padding()
    }
}
