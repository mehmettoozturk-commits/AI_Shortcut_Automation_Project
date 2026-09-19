// Phase 4D-1 — `.previewConfirm`: son önizleme.
// Phase 5A İş 0 — "Otomasyonu Oluştur" artık gerçekten `create()`'e
// bağlı (kurulum akışının geri kalanı da bağlandı, bkz. AutomationRootView).

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

            Button("Otomasyonu Oluştur") {
                Task { await viewModel.createAutomation() }
            }
            .accessibilityIdentifier("createAutomationButton")

            Button("✎ Değiştir") { viewModel.edit() }
                .accessibilityIdentifier("reviseButton")
        }
        .padding()
    }
}
